import { EyeFlowIntelligence } from './intelligence.js';
import { EyeFlowOverlay } from './overlay.js';
import { clampNumber, GENTLE_REMINDER_DUPLICATE_GUARD_MS } from './utils.js';

// ============================================================
// CONTENT.JS — EyeFlow Doom-Scroll Detection
// ============================================================
// This script runs on EVERY webpage the user visits.
// Its job is to:
//   1. Track scroll events and detect doom scrolling
//   2. Track how long the user has been on this site
//   3. Communicate with background.js when doom scrolling is detected
//   4. Show/hide the nudge and warning UI elements
//   5. Listen for messages from background.js (settings updates, etc.)
//
// It works closely with intelligence.js (which is loaded first)
// to determine thresholds and interruption stages.
// ============================================================

// -------------------------------------------------------
// EYEFLOW CONTENT — Main content script controller
// -------------------------------------------------------

const EyeFlowContent = (() => {
  const DOOM_SCROLL_SITES = new Set([
    'instagram.com',
    'tiktok.com',
    'reddit.com',
    'facebook.com',
    'twitter.com',
    'x.com',
  ]);
  const SENSITIVE_HOST_KEYWORDS = [
    'bank',
    'pay',
    'billing',
    'checkout',
    'wallet',
    'stripe',
    'paypal',
    'razorpay',
    'exam',
    'quiz',
    'test',
    'assessment',
    'proctor',
    'auth',
    'login',
    'signin',
    'verify',
    'otp',
    'docs',
    'sheets',
    'slides',
    'notion',
    'figma',
    'miro',
    'canva',
    'zoom',
    'meet',
    'teams',
  ];
  const SENSITIVE_PATH_KEYWORDS = [
    'login',
    'signin',
    'signup',
    'verify',
    'checkout',
    'billing',
    'payment',
    'wallet',
    'otp',
    'auth',
    'exam',
    'quiz',
    'test',
    'assessment',
    'proctor',
  ];
  const COMMUNICATION_HOST_KEYWORDS = [
    'instagram',
    'facebook',
    'messenger',
    'x.com',
    'twitter',
    'discord',
    'snapchat',
  ];
  const SITE_TIME_REPORT_INTERVAL_MS = 60 * 1000;
  const HYDRATION_JITTER_MINUTES = 3;
  const PRESENCE_WINDOW_MS = 35 * 1000;
  const REGULAR_PAGE_INACTIVITY_WINDOW_MS = 2 * 60 * 1000;
  const HYDRATION_EYE_MERGE_WINDOW_MS = 3 * 60 * 1000;
  const HYDRATION_REMIND_SOON_WINDOW_MS = 5 * 60 * 1000;
  const HYDRATION_GENTLE_DELAY_MS = 3 * 60 * 1000;
  const SINGLE_POST_GRACE_MS = 60 * 1000;
  const BREAK_DUPLICATE_GUARD_MS = 10 * 1000; // min gap between two break overlay showings
  const SESSION_RESET_INACTIVITY_MS = 15 * 60 * 1000;
  const SCROLL_CHECK_INTERVAL_MS = 2000;

  // --- Scroll tracking variables ---
  let scrollEvents = []; // Array of timestamps when scroll events happened
  let lastDoomScrollTime = 0; // When doom scroll was last detected
  let scrollCheckInterval = null; // Interval ID for periodic scroll checking
  let siteEntryTime = Date.now(); // When the user entered this page
  let timeTrackingInterval = null; // Interval for tracking time on site
  let isActive = true; // Whether the extension is currently active
  let currentSettings = null; // Cached extension settings
  let lastScrollSignalAt = 0; // Deduplicates scroll-like signals across listeners
  let lastActivityAt = Date.now(); // Tracks recent feed activity for strict sites
  let lastMeaningfulInputAt = Date.now();
  let lastKnownUrl = window.location.href;
  let pendingHydrationPopup = false;
  let activeSiteMs = 0; // Counts DS time while this tab is actively visible and present
  let activeSessionStartedAt = 0;
  let lastReportedActiveSiteMs = 0;
  let hydrationTargetMs = 0;
  let lastContextKey = '';
  let isSystemIdle = false;
  let totalActiveUsageMs = 0; // Counts active usage beyond DS so hydration can follow normal browsing too
  let totalUsageStartedAt = 0;
  let hydrationMergedIntoNextBreak = false;
  let hydrationGentleReminderAt = 0;
  let lastBreakOverlayShownAt = 0;
  let lastGentleReminderFallbackAt = 0;
  let lastGentleReminderShownAt = 0;
  let singlePostGraceContextKey = '';
  let singlePostGraceStartedAt = 0;

  // --- UI elements (nudge and warning) ---
  let nudgeElement = null; // The small floating nudge pill
  let warningElement = null; // The larger warning banner
  let subtleReminderElement = null; // The gentle side reminder during normal work

  let sharedDsSyncInFlight = false;
  let sharedDsState = {
    activeMs: 0,
    nextBreakTargetMs: 0,
    isActive: false,
    contextKey: '',
    activeTabId: 0,
    lastSyncedAt: 0,
  };

  function runtimeCallbackFailed() {
    return Boolean(chrome.runtime?.lastError);
  }

  // -------------------------------------------------------
  // GET HOSTNAME — Extract clean domain name from URL
  // -------------------------------------------------------
  // Returns "instagram.com" from "https://www.instagram.com/reels/"
  function getHostname() {
    // Treat mobile and www variants as the same site so timers do not fork.
    return window.location.hostname.replace(/^(www|m)\./, '');
  }

  function getStatsSiteLabel() {
    const hostname = getHostname();
    const contextKey = getDoomScrollContextKey();

    if (contextKey === 'youtube.com/shorts' || contextKey === 'youtube.com/channel-shorts') {
      return 'YouTube Shorts';
    }

    if (hostname === 'instagram.com') {
      if (contextKey === 'instagram.com/direct') {
        return 'Instagram Chat';
      }
      return 'Instagram Reels';
    }

    if (hostname === 'snapchat.com') {
      if (contextKey === 'snapchat.com/chat') {
        return 'Snapchat Chat';
      }
      return 'Snapchat Stories';
    }

    const siteLabels = {
      'reddit.com': 'Reddit',
      'facebook.com': 'Facebook',
      'x.com': 'X',
      'twitter.com': 'X',
      'linkedin.com': 'LinkedIn',
      'twitch.tv': 'Twitch',
      'tiktok.com': 'TikTok',
      'youtube.com': 'YouTube',
    };

    return siteLabels[hostname] || hostname;
  }

  function getDoomScrollContextKey() {
    const hostname = getHostname();

    if (isAuthOrVerificationSurface()) {
      return '';
    }

    if (hostname === 'instagram.com') {
      return getInstagramDoomSurfaceKey();
    }

    if (hostname === 'youtube.com') {
      return getYouTubeDoomSurfaceKey();
    }

    if (hostname === 'reddit.com') {
      return getRedditDoomSurfaceKey();
    }

    if (hostname === 'facebook.com') {
      return getFacebookDoomSurfaceKey();
    }

    if (hostname === 'x.com' || hostname === 'twitter.com') {
      return getXDoomSurfaceKey();
    }

    if (hostname === 'snapchat.com') {
      return getSnapchatDoomSurfaceKey();
    }

    if (hostname === 'linkedin.com') {
      return getLinkedInDoomSurfaceKey();
    }

    if (hostname === 'twitch.tv') {
      return getTwitchDoomSurfaceKey();
    }

    if (DOOM_SCROLL_SITES.has(hostname)) {
      return hostname;
    }

    return '';
  }

  function isDoomScrollContext() {
    const contextKey = getDoomScrollContextKey();
    if (!contextKey) {
      return false;
    }

    if (isSinglePostGraceContextKey(contextKey) && isWithinSinglePostGraceWindow(contextKey)) {
      return false;
    }

    return true;
  }

  function isSinglePostGraceContextKey(contextKey) {
    return typeof contextKey === 'string' && contextKey.endsWith('/detail');
  }

  function isWithinSinglePostGraceWindow(contextKey = getDoomScrollContextKey()) {
    if (!isSinglePostGraceContextKey(contextKey)) {
      return false;
    }

    if (singlePostGraceContextKey !== contextKey || !singlePostGraceStartedAt) {
      return false;
    }

    return Date.now() - singlePostGraceStartedAt < SINGLE_POST_GRACE_MS;
  }

  function getSinglePostGraceRemainingMs(contextKey = getDoomScrollContextKey()) {
    if (!isWithinSinglePostGraceWindow(contextKey)) {
      return 0;
    }

    return Math.max(0, SINGLE_POST_GRACE_MS - (Date.now() - singlePostGraceStartedAt));
  }

  function isPassiveViewerDoomContext() {
    const contextKey = getDoomScrollContextKey();
    return (
      contextKey === 'tiktok.com' ||
      contextKey === 'youtube.com/shorts' ||
      contextKey === 'instagram.com/reels' ||
      contextKey === 'facebook.com/video'
    );
  }

  function isStrictBreakSite() {
    const contextKey = getDoomScrollContextKey();
    if (!contextKey) {
      return false;
    }

    const hostname = getHostname();
    if (DOOM_SCROLL_SITES.has(hostname)) {
      return true;
    }

    return contextKey === 'youtube.com/shorts';
  }

  function recordActivity() {
    const now = Date.now();
    lastActivityAt = now;
    lastMeaningfulInputAt = now;
  }

  function hasRecentMeaningfulInput() {
    return Date.now() - lastMeaningfulInputAt <= PRESENCE_WINDOW_MS;
  }

  function hasRecentRegularPageInput() {
    return Date.now() - lastMeaningfulInputAt <= REGULAR_PAGE_INACTIVITY_WINDOW_MS;
  }

  function getInstagramDoomSurfaceKey() {
    const path = window.location.pathname || '/';

    if (path.startsWith('/reels')) {
      return 'instagram.com/reels';
    }

    if (path.startsWith('/reel/')) {
      return 'instagram.com/reels';
    }

    if (path.startsWith('/direct')) {
      return 'instagram.com/direct';
    }

    if (path.startsWith('/p/')) {
      const modalReelVisible = Boolean(
        document.querySelector(
          '[role="dialog"] video, [role="dialog"] article video, main [role="presentation"] video'
        )
      );
      if (modalReelVisible) {
        return 'instagram.com/reels';
      }
      return 'instagram.com/detail';
    }

    if (path.startsWith('/explore')) {
      const gridVisible = Boolean(
        document.querySelector('main img, main video, main article, main [role="link"]')
      );
      return gridVisible ? 'instagram.com/explore' : '';
    }

    if (path === '/' || path === '') {
      const feedVisible = Boolean(
        document.querySelector('main article, main [role="main"] article, main video')
      );
      return feedVisible ? 'instagram.com/home' : '';
    }

    return '';
  }

  function getRedditDoomSurfaceKey() {
    let path = (window.location.pathname || '/').toLowerCase();
    if (path.length > 1 && path.endsWith('/')) {
      path = path.slice(0, -1);
    }

    // Explore is just the chooser surface; actual community feeds entered from there can be strong later.
    if (path.startsWith('/explore')) {
      return '';
    }

    if (path.includes('/comments/')) {
      return 'reddit.com/detail';
    }

    if (path === '/' || path === '/best' || path === '/hot') {
      return 'reddit.com/home';
    }

    if (path === '/popular' || path.startsWith('/r/popular')) {
      return 'reddit.com/popular';
    }

    if (path === '/news' || path.startsWith('/r/news')) {
      return '';
    }

    // A plain subreddit path behaves like a feed and should stay in the strong DS bucket.
    if (/^\/r\/[^/]+\/?$/.test(path)) {
      return 'reddit.com/community';
    }

    return '';
  }

  function getFacebookDoomSurfaceKey() {
    const path = (window.location.pathname || '/').toLowerCase();
    const search = (window.location.search || '').toLowerCase();

    if (path.startsWith('/messages') || path.startsWith('/messenger')) {
      return '';
    }

    if (path.includes('/posts/') || path.includes('/permalink/')) {
      return 'facebook.com/detail';
    }

    if (path.startsWith('/watch') || path.startsWith('/videos') || path.startsWith('/reel')) {
      return 'facebook.com/video';
    }

    if (path.startsWith('/groups')) {
      return 'facebook.com/groups';
    }

    if (search.includes('filter=all')) {
      return 'facebook.com/feeds-all';
    }

    if (search.includes('filter=groups')) {
      return 'facebook.com/feeds-groups';
    }

    if (search.includes('filter=pages')) {
      return 'facebook.com/feeds-pages';
    }

    if (
      search.includes('filter=favourites') ||
      search.includes('filter=favorites') ||
      search.includes('filter=friends')
    ) {
      return '';
    }

    if (path === '/' || path === '') {
      // Classify Facebook home as a DS surface immediately — don't wait for
      // the feed to render in the DOM, which can cause the gentle reminder
      // timer to fire first on a slow page load.
      return 'facebook.com/home';
    }

    return '';
  }

  function getXDoomSurfaceKey() {
    const path = (window.location.pathname || '/').toLowerCase();
    const reservedOffPaths = [
      '/messages',
      '/notifications',
      '/i/connect_people',
      '/i/premium_sign_up',
      '/premium',
      '/i/premium',
      '/settings',
      '/compose',
      '/i/grok',
      '/grok',
      '/i/verified-orgs-signup',
      '/i/spaces/start',
      '/i/spaces',
      '/i/creators/studio',
      '/i/business',
    ];

    if (reservedOffPaths.some((prefix) => path.startsWith(prefix))) {
      return '';
    }

    if (path.startsWith('/home')) {
      return 'x.com/home';
    }

    if (path.startsWith('/explore')) {
      return 'x.com/explore';
    }

    if (
      path.startsWith('/i/communities') ||
      /^\/[^/]+\/communities(\/|$)/.test(path) ||
      path.startsWith('/communities')
    ) {
      return 'x.com/communities';
    }

    if (path.includes('/status/')) {
      return 'x.com/detail';
    }

    if (path === '/i/following' || path.startsWith('/i/connect_tab')) {
      return '';
    }

    // Profile pages with likes or media tabs are strong DS surfaces (user browses liked/saved reels)
    if (/^\/[^/]+\/likes\/?$/.test(path) || /^\/[^/]+\/media\/?$/.test(path)) {
      return 'x.com/profile-feed';
    }

    // Plain profile pages (followers, following, highlights, articles, with_replies) are non-DS
    if (/^\/[^/]+(?:\/(with_replies|highlights|articles|followers|following))?\/?$/.test(path)) {
      return '';
    }

    return '';
  }

  function getYouTubeDoomSurfaceKey() {
    const path = window.location.pathname || '/';

    if (path.startsWith('/shorts')) {
      return 'youtube.com/shorts';
    }

    const shortsTabSelected = Boolean(
      document.querySelector(
        'yt-tab-shape[tab-title="Shorts"][selected], [role="tab"][aria-label*="Shorts" i][aria-selected="true"], [aria-label*="Shorts" i][tab-identifier="shorts"]'
      )
    );
    const shortsGridVisible = Boolean(
      document.querySelector(
        'ytd-rich-grid-renderer ytd-reel-item-renderer, ytd-reel-shelf-renderer, ytd-reel-video-renderer'
      )
    );

    if (shortsTabSelected && shortsGridVisible) {
      return 'youtube.com/channel-shorts';
    }

    return '';
  }

  function getSnapchatDoomSurfaceKey() {
    const path = (window.location.pathname || '/').toLowerCase();

    if (path.startsWith('/chat')) {
      return 'snapchat.com/chat';
    }

    if (
      path.startsWith('/accounts') ||
      path.startsWith('/settings') ||
      path.startsWith('/lenses') ||
      path.startsWith('/plus') ||
      path.startsWith('/snapchat-plus') ||
      /^\/@[^/]+\/?$/.test(path)
    ) {
      return '';
    }

    if (path.includes('/spotlight/')) {
      // A single spotlight clip URL - treat as strong DS feed (like Instagram Reels)
      // because Snapchat Spotlight auto-plays the next clip just like a reel feed.
      return 'snapchat.com/spotlight';
    }

    if (path.startsWith('/spotlight')) {
      return 'snapchat.com/spotlight';
    }

    if (path.startsWith('/stories') || path.startsWith('/discover') || path === '/') {
      return 'snapchat.com/feed';
    }

    return '';
  }

  function getLinkedInDoomSurfaceKey() {
    const path = (window.location.pathname || '/').toLowerCase();

    if (
      path.startsWith('/messaging') ||
      path.startsWith('/notifications') ||
      path.startsWith('/jobs') ||
      path.startsWith('/my-items') ||
      path.startsWith('/mynetwork') ||
      path.startsWith('/search') ||
      path.startsWith('/learning') ||
      path.startsWith('/sales') ||
      path.startsWith('/in/') ||
      path.startsWith('/company/') ||
      path.startsWith('/school/')
    ) {
      return '';
    }

    if (path.startsWith('/posts/') || path.startsWith('/feed/update/')) {
      return 'linkedin.com/detail';
    }

    if (path === '/feed' || path.startsWith('/feed/') || path.startsWith('/video/')) {
      return 'linkedin.com/feed';
    }

    return '';
  }

  function getTwitchDoomSurfaceKey() {
    const path = (window.location.pathname || '/').toLowerCase();

    if (
      path.startsWith('/settings') ||
      path.startsWith('/subscriptions') ||
      path.startsWith('/wallet') ||
      path.startsWith('/inventory') ||
      path.startsWith('/messages') ||
      path.startsWith('/friends')
    ) {
      return '';
    }

    if (path.startsWith('/clip/')) {
      return 'twitch.tv/detail';
    }

    if (
      path.startsWith('/clips') ||
      (path.startsWith('/directory/game/') && path.includes('/clips')) ||
      (path.startsWith('/directory/all/tags/') && path.includes('/clips'))
    ) {
      return 'twitch.tv/feed';
    }

    if (/^\/[^/]+\/?$/.test(path)) {
      return '';
    }

    return '';
  }

  function isAuthOrVerificationSurface() {
    const path = `${window.location.pathname || ''} ${window.location.search || ''}`.toLowerCase();
    const hasAuthPath = [
      'login',
      'signin',
      'signup',
      'auth',
      'verify',
      'verification',
      'checkpoint',
      'forgot',
      'reset',
    ].some((token) => path.includes(token));
    const authFieldsVisible = Boolean(
      document.querySelector(
        'input[type="password"], input[autocomplete="current-password"], input[autocomplete="username"], input[autocomplete="one-time-code"], input[name*="otp" i], input[name*="password" i], input[id*="password" i]'
      )
    );

    return hasAuthPath || authFieldsVisible;
  }

  function handleInteraction(event) {
    if (!isActive) return;

    if (event.type === 'keydown') {
      const activeKeys = new Set([
        'ArrowDown',
        'ArrowUp',
        'ArrowLeft',
        'ArrowRight',
        'PageDown',
        'PageUp',
        ' ',
        'Enter',
        'j',
        'k',
      ]);

      if (activeKeys.has(event.key)) {
        recordActivity();
      }
      return;
    }

    if (event.type === 'click' || event.type === 'pointerup') {
      recordActivity();
      return;
    }
  }

  function getHydrationTargetMs() {
    const baseMinutes = currentSettings?.hydrationReminderMin ?? 80;
    return baseMinutes * 60 * 1000;
  }

  function getLocalGentleDelayMs() {
    const minMinutes = Math.max(1, Number(currentSettings?.subtleReminderMin) || 25);
    const maxMinutes = Math.max(
      minMinutes,
      Number(currentSettings?.subtleReminderMax) || minMinutes
    );
    const randomMinutes = Math.floor(Math.random() * (maxMinutes - minMinutes + 1)) + minMinutes;
    return randomMinutes * 60 * 1000;
  }

  function applySharedDsState(snapshot) {
    if (!snapshot) return;

    sharedDsState = {
      activeMs: snapshot.activeMs || 0,
      nextBreakTargetMs: snapshot.nextBreakTargetMs || 0,
      isActive: Boolean(snapshot.isActive),
      contextKey: snapshot.contextKey || '',
      activeTabId: snapshot.activeTabId || 0,
      lastSyncedAt: Date.now(),
    };
  }

  function resetTrackedSession({ resetTotalTime = true } = {}) {
    scrollEvents = [];
    lastDoomScrollTime = 0;
    lastActivityAt = Date.now();
    pendingHydrationPopup = false;
    lastReportedActiveSiteMs = 0;
    const jitterMs = Math.floor(Math.random() * (HYDRATION_JITTER_MINUTES + 1)) * 60 * 1000;
    hydrationTargetMs = (currentSettings?.hydrationReminderMin ?? 80) * 60 * 1000 + jitterMs;

    if (resetTotalTime) {
      activeSiteMs = 0;
      totalActiveUsageMs = 0;
      totalUsageStartedAt = 0;
    }

    activeSessionStartedAt = 0;
    hydrationMergedIntoNextBreak = false;
    hydrationGentleReminderAt = 0;

    if (typeof EyeFlowIntelligence !== 'undefined') {
      EyeFlowIntelligence.resetStages();
    }
  }

  function flushDsSiteTime() {
    const activeMinutesDelta = Math.floor((getActiveSiteMs() - lastReportedActiveSiteMs) / 60000);
    if (activeMinutesDelta <= 0) return;

    lastReportedActiveSiteMs += activeMinutesDelta * 60000;

    try {
      const site = getStatsSiteLabel();
      chrome.storage.local.get(['stats'], (result) => {
        const stats = result?.stats || {};
        const siteTimeSpent = { ...(stats.siteTimeSpent || {}) };
        const todayDsSiteTimeSpent = { ...(stats.todayDsSiteTimeSpent || {}) };
        const weekDsSiteTimeSpent = { ...(stats.weekDsSiteTimeSpent || {}) };

        siteTimeSpent[site] = (siteTimeSpent[site] || 0) + activeMinutesDelta;
        todayDsSiteTimeSpent[site] = (todayDsSiteTimeSpent[site] || 0) + activeMinutesDelta;
        weekDsSiteTimeSpent[site] = (weekDsSiteTimeSpent[site] || 0) + activeMinutesDelta;

        chrome.storage.local.set({
          stats: {
            ...stats,
            siteTimeSpent,
            todayDsSiteTimeSpent,
            weekDsSiteTimeSpent,
          },
        });
      });
    } catch (e) {
      // Ignore if extension context is invalid
    }
  }

  function resetSessionTimersFromBackground(snapshot) {
    resetTrackedSession();
    applySharedDsState(snapshot);
    lastGentleReminderFallbackAt = 0;
    lastGentleReminderShownAt = 0;
    removeGentleReminder();
    removeNudge();
    removeWarning();
  }

  function syncRouteState() {
    const currentUrl = window.location.href;
    const contextKey = getDoomScrollContextKey();
    const urlChanged = currentUrl !== lastKnownUrl;
    const contextChanged = contextKey !== lastContextKey;

    if (!urlChanged && !contextChanged) return;

    syncActiveSession();

    lastKnownUrl = currentUrl;

    const shouldResetForRoute = contextChanged && !lastContextKey && !contextKey;

    if (shouldResetForRoute) {
      flushDsSiteTime();
      siteEntryTime = Date.now();
      resetTrackedSession();
      removeGentleReminder();
      removeNudge();
      removeWarning();
    }

    if (contextChanged && lastContextKey && lastContextKey !== contextKey) {
      flushDsSiteTime();

      // When navigating BACK into a DS context from a non-DS page, refresh
      // lastMeaningfulInputAt so the new DS session isn't immediately treated
      // as inactive, and re-anchor the shared DS state so the stale elapsed
      // estimation doesn't push the timer past the break target immediately.
      if (contextKey && !lastContextKey) {
        lastMeaningfulInputAt = Date.now();
        lastActivityAt = Date.now();
        // Re-anchor the sync timestamp so we don't accumulate phantom elapsed time
        sharedDsState.lastSyncedAt = Date.now();
      }
    }

    if (isSinglePostGraceContextKey(contextKey)) {
      if (singlePostGraceContextKey !== contextKey) {
        singlePostGraceContextKey = contextKey;
        singlePostGraceStartedAt = Date.now();
      }
    } else {
      singlePostGraceContextKey = '';
      singlePostGraceStartedAt = 0;
    }

    lastContextKey = contextKey;
  }

  function isTabActivelyVisible() {
    return !document.hidden && document.hasFocus();
  }

  function isSensitiveReminderContext() {
    const hostname = getHostname();
    const path = `${window.location.pathname || ''} ${window.location.search || ''}`.toLowerCase();
    const overlayShowing = typeof EyeFlowOverlay !== 'undefined' && EyeFlowOverlay.isShowing();
    const activeElement = document.activeElement;
    const focusedEditable = Boolean(
      activeElement &&
      (activeElement.isContentEditable ||
        activeElement.tagName === 'TEXTAREA' ||
        (activeElement.tagName === 'INPUT' &&
          !['checkbox', 'radio', 'range', 'button', 'submit'].includes(
            (activeElement.type || '').toLowerCase()
          )))
    );
    const passwordOrOtpField = Boolean(
      document.querySelector(
        'input[type="password"], input[autocomplete="one-time-code"], input[name*="otp" i], input[id*="otp" i]'
      )
    );
    const largeForm = document.querySelectorAll('input, textarea, select').length >= 6;
    const videoMeetingSignals = Boolean(
      document.querySelector(
        '[data-meeting-title], [aria-label*="meeting" i], [class*="meeting" i], [class*="conference" i]'
      )
    );

    if (overlayShowing || document.fullscreenElement) return true;
    if (focusedEditable) return true;
    if (EyeFlowIntelligence.isUserTyping() && !isDoomScrollContext()) return true;
    if (passwordOrOtpField) return true;
    if (largeForm && path.includes('form')) return true;
    if (videoMeetingSignals) return true;
    if (SENSITIVE_HOST_KEYWORDS.some((keyword) => hostname.includes(keyword))) return true;
    if (SENSITIVE_PATH_KEYWORDS.some((keyword) => path.includes(keyword))) return true;

    return false;
  }

  function isCommunicationContext() {
    const hostname = getHostname();
    const path = `${window.location.pathname || ''} ${window.location.search || ''}`.toLowerCase();
    if (hostname === 'instagram.com' && getDoomScrollContextKey()) return false;
    const activeElement = document.activeElement;
    const chatFocused = Boolean(
      activeElement &&
      (activeElement.isContentEditable ||
        activeElement.tagName === 'TEXTAREA' ||
        (activeElement.tagName === 'INPUT' &&
          ['text', 'search'].includes((activeElement.type || '').toLowerCase())))
    );
    const chatUiSignals = Boolean(
      document.querySelector(
        '[aria-label*="message" i], [aria-label*="chat" i], [data-testid*="message" i], [data-testid*="thread" i], [class*="message" i], [class*="thread" i], [class*="dm" i]'
      )
    );
    const communicationHost = COMMUNICATION_HOST_KEYWORDS.some((value) => hostname.includes(value));
    const callUiSignals = Boolean(
      document.querySelector(
        '[aria-label*="call" i], [aria-label*="mute" i], [aria-label*="camera" i], [aria-label*="hang up" i], [class*="call" i], [class*="voice" i], [class*="videocall" i], [class*="video-call" i], [data-testid*="call" i]'
      )
    );
    const liveOrSharedWatchSignals = Boolean(
      document.querySelector(
        '[aria-label*="live" i], [class*="live" i], [class*="watch-together" i], [class*="watchtogether" i], [data-testid*="live" i]'
      )
    );

    if (chatFocused) return true;
    if (chatUiSignals && communicationHost) {
      return true;
    }
    // Keep call/live suppression scoped to communication-heavy products so video sites like
    // YouTube Shorts are not mistaken for an active call just because they contain "video" UI.
    if (communicationHost && (callUiSignals || liveOrSharedWatchSignals)) return true;
    if (path.includes('/direct/') || path.includes('/messages/') || path.includes('/inbox'))
      return true;

    return false;
  }

  function canShowGentleReminder() {
    if (isEffectivelySystemIdle() || !isActive || !isTabActivelyVisible()) return false;
    if (isDoomScrollContext() || isWithinSinglePostGraceWindow() || warningElement) return false;
    if (isSensitiveReminderContext()) return false;
    if (isCommunicationContext()) return false;
    if (isWatchingLongVideoPassively() || isWatchingPassiveDsVideo()) return false;
    return true;
  }

  function canShowGentleReminderWithPassiveVideoSupport() {
    if (!isActive) return false;
    if (isDoomScrollContext() || isWithinSinglePostGraceWindow() || warningElement) return false;
    if (isSensitiveReminderContext()) return false;
    if (isCommunicationContext()) return false;
    return canShowGentleReminder();
  }

  function isEffectivelySystemIdle() {
    return isSystemIdle && !isWatchingLongVideoPassively() && !isWatchingPassiveDsVideo();
  }

  function isWatchingLongVideoPassively() {
    if (getHostname() !== 'youtube.com') return false;
    if ((window.location.pathname || '') !== '/watch') return false;
    if (isDoomScrollContext()) return false;

    return Boolean(findPassiveVideoCandidate({ requireLongDuration: true }));
  }

  function findPassiveVideoCandidate({ requireLongDuration = false } = {}) {
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    const minimumVisibleArea = Math.max(
      160 * 160,
      Math.round(viewportWidth * viewportHeight * 0.06)
    );
    const minimumVideoArea = Math.max(220 * 160, Math.round(viewportWidth * viewportHeight * 0.08));

    const videos = Array.from(document.querySelectorAll('video'));
    let bestVideo = null;
    let bestScore = 0;

    videos.forEach((video) => {
      if (!video || video.paused || video.ended) return;
      if (video.readyState < 2) return;

      const rect = video.getBoundingClientRect();
      if (rect.width < 180 || rect.height < 120) return;

      const visibleWidth = Math.max(
        0,
        Math.min(rect.right, viewportWidth) - Math.max(rect.left, 0)
      );
      const visibleHeight = Math.max(
        0,
        Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0)
      );
      const visibleArea = visibleWidth * visibleHeight;
      const videoArea = rect.width * rect.height;

      if (visibleArea < minimumVisibleArea) return;
      if (videoArea < minimumVideoArea) return;

      const duration = Number(video.duration);
      if (requireLongDuration && (!Number.isFinite(duration) || duration <= 60)) return;

      // Prefer videos that are actually prominent in the viewport, not tiny ambient media.
      const prominenceScore = visibleArea + Math.min(videoArea, visibleArea);
      if (prominenceScore <= bestScore) return;

      bestScore = prominenceScore;
      bestVideo = video;
    });

    return bestVideo;
  }

  function isWatchingPassiveDsVideo() {
    if (!isDoomScrollContext()) return false;
    if (isWithinSinglePostGraceWindow()) return false;

    // Strong short-form viewers are already covered elsewhere. This helper is for
    // mixed DS feeds where the user may stop touching the page while clearly
    // watching a larger in-feed or opened video.
    return Boolean(findPassiveVideoCandidate({ requireLongDuration: true }));
  }

  function shouldCountUsageTime() {
    const overlayShowing = typeof EyeFlowOverlay !== 'undefined' && EyeFlowOverlay.isShowing();
    if (!isActive || isEffectivelySystemIdle() || !isTabActivelyVisible() || overlayShowing) {
      return false;
    }

    // Full-screen-ish reels/shorts viewers are often watched passively, so they should
    // survive a tab-return without forcing an immediate fresh click or scroll.
    if (isPassiveViewerDoomContext()) {
      return true;
    }

    // Long-form YouTube watching should still count as present while the video is actively playing.
    if (isWatchingLongVideoPassively()) {
      return true;
    }

    // Mixed DS feeds across sites can also contain longer videos where the user
    // is clearly still watching without constant mouse or keyboard input.
    if (isWatchingPassiveDsVideo()) {
      return true;
    }

    if (!isDoomScrollContext()) {
      return hasRecentRegularPageInput();
    }

    return hasRecentMeaningfulInput();
  }

  function shouldCountActiveTime() {
    const overlayShowing = typeof EyeFlowOverlay !== 'undefined' && EyeFlowOverlay.isShowing();
    return (
      isActive &&
      !isEffectivelySystemIdle() &&
      isDoomScrollContext() &&
      isTabActivelyVisible() &&
      !overlayShowing &&
      (hasRecentMeaningfulInput() || isPassiveViewerDoomContext() || isWatchingPassiveDsVideo())
    );
  }

  function isUsageActiveNow() {
    return shouldCountUsageTime();
  }

  function syncActiveSession() {
    const now = Date.now();
    const isUsageActiveNow = shouldCountUsageTime();
    const isDsActiveNow = shouldCountActiveTime();

    if (isUsageActiveNow && !totalUsageStartedAt) {
      totalUsageStartedAt = now;
    } else if (!isUsageActiveNow && totalUsageStartedAt) {
      totalActiveUsageMs += now - totalUsageStartedAt;
      totalUsageStartedAt = 0;
    }

    if (isDsActiveNow && !activeSessionStartedAt) {
      activeSessionStartedAt = now;
      return;
    }

    if (!isDsActiveNow && activeSessionStartedAt) {
      const elapsed = now - activeSessionStartedAt;
      activeSiteMs += elapsed;
      activeSessionStartedAt = 0;

      if (typeof EyeFlowIntelligence !== 'undefined') {
        EyeFlowIntelligence.pauseForInactivity(elapsed);
      }
    }
  }

  function getActiveSiteMs() {
    syncActiveSession();

    if (!activeSessionStartedAt) {
      return activeSiteMs;
    }

    return activeSiteMs + (Date.now() - activeSessionStartedAt);
  }

  function getEstimatedSharedDsActiveMs(now = Date.now()) {
    const baseActiveMs = sharedDsState.activeMs || 0;
    if (!shouldCountActiveTime()) {
      return baseActiveMs;
    }

    if (!sharedDsState.lastSyncedAt) {
      return baseActiveMs;
    }

    return baseActiveMs + Math.max(0, now - sharedDsState.lastSyncedAt);
  }

  function getBreakCycleMs() {
    return getEstimatedSharedDsActiveMs();
  }

  function getTotalActiveUsageMs() {
    syncActiveSession();

    if (!totalUsageStartedAt) {
      return totalActiveUsageMs;
    }

    return totalActiveUsageMs + (Date.now() - totalUsageStartedAt);
  }

  function resetBreakCycle() {
    scrollEvents = [];
    sharedDsState.activeMs = 0;
    sharedDsState.nextBreakTargetMs = EyeFlowIntelligence.getNextBreakTargetMs();
    sharedDsState.isActive = false;
    sharedDsState.lastSyncedAt = Date.now();
    activeSessionStartedAt = 0;
    lastDoomScrollTime = Date.now();
  }

  function maybeResetSessionAfterLongGap() {
    const now = Date.now();
    const lastPresenceAt = Math.max(
      lastActivityAt || 0,
      lastMeaningfulInputAt || 0,
      activeSessionStartedAt || 0,
      totalUsageStartedAt || 0
    );

    if (!lastPresenceAt) return;
    if (now - lastPresenceAt < SESSION_RESET_INACTIVITY_MS) return;

    resetTrackedSession();
    sharedDsState.activeMs = 0;
    sharedDsState.nextBreakTargetMs = EyeFlowIntelligence.getNextBreakTargetMs();
    sharedDsState.isActive = false;
    sharedDsState.contextKey = '';
    sharedDsState.activeTabId = 0;
    sharedDsState.lastSyncedAt = now;
    lastDoomScrollTime = now;
  }

  function resetHydrationTimer() {
    hydrationMergedIntoNextBreak = false;
    hydrationGentleReminderAt = 0;
    pendingHydrationPopup = false;

    try {
      chrome.runtime.sendMessage({ type: 'HYDRATION_COMPLETED' });
    } catch (e) {
      // Ignore temporary extension-context issues.
    }
  }

  function getMsUntilEyeBreak() {
    if (!sharedDsState.nextBreakTargetMs) {
      return Infinity;
    }

    return Math.max(0, sharedDsState.nextBreakTargetMs - getBreakCycleMs());
  }

  function canShowBreakOverlay() {
    const overlayShowing = typeof EyeFlowOverlay !== 'undefined' && EyeFlowOverlay.isShowing();
    if (overlayShowing) return false;
    return Date.now() - lastBreakOverlayShownAt > BREAK_DUPLICATE_GUARD_MS;
  }

  function syncSharedDsTimer() {
    if (sharedDsSyncInFlight) return;

    try {
      const now = Date.now();
      const isActiveNow = shouldCountActiveTime();
      const estimatedActiveMs = getEstimatedSharedDsActiveMs(now);

      sharedDsState.activeMs = estimatedActiveMs;
      sharedDsState.isActive = isActiveNow;
      sharedDsState.contextKey = isActiveNow ? getDoomScrollContextKey() : '';
      sharedDsState.lastSyncedAt = now;

      sharedDsSyncInFlight = true;
      chrome.runtime.sendMessage(
        {
          type: 'SYNC_SHARED_DS_STATE',
          isActive: isActiveNow,
          contextKey: isActiveNow ? sharedDsState.contextKey : '',
        },
        (response) => {
          sharedDsSyncInFlight = false;
          applySharedDsState(response);
        }
      );
    } catch (e) {
      sharedDsSyncInFlight = false;
    }
  }

  function syncSessionAndSharedTimer() {
    maybeResetSessionAfterLongGap();
    syncActiveSession();
    syncSharedDsTimer();
  }

  function formatCountdown(ms) {
    const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  }

  function formatReadableTimer(ms) {
    const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }

    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  }

  function shouldMergeHydrationIntoBreak() {
    return isHydrationDue() && getMsUntilEyeBreak() <= HYDRATION_EYE_MERGE_WINDOW_MS;
  }

  // Stamps the local dedup timestamps after a gentle reminder is shown.
  // Called both from the SHOW_GENTLE_REMINDER message handler and from
  // any local show path so we never show two reminders within the guard window.
  function acknowledgeLocalGentleReminder(now = Date.now()) {
    lastGentleReminderShownAt = now;
    lastGentleReminderFallbackAt = now;
  }

  function isHydrationDue() {
    if (!hydrationTargetMs) return false;
    return getTotalActiveUsageMs() >= hydrationTargetMs;
  }

  function tryShowHydrationPopup() {
    if (warningElement || (typeof EyeFlowOverlay !== 'undefined' && EyeFlowOverlay.isShowing())) {
      pendingHydrationPopup = true;
      return;
    }

    pendingHydrationPopup = false;
    removeGentleReminder();

    if (typeof EyeFlowOverlay !== 'undefined') {
      const timeOnSite = Math.round(getActiveSiteMs() / 60000);
      EyeFlowOverlay.showHydration(currentSettings, getHostname(), timeOnSite);
    }
  }

  function scheduleHydrationGentleReminder(delayMs = HYDRATION_GENTLE_DELAY_MS) {
    hydrationGentleReminderAt = Date.now() + delayMs;
  }

  function maybeShowHydrationGentleReminder() {
    if (!hydrationGentleReminderAt || hydrationGentleReminderAt === 0) return false;
    if (Date.now() >= hydrationGentleReminderAt) {
      if (canShowGentleReminder()) {
        showGentleReminder({
          title: 'Stay Hydrated',
          text: 'Just a gentle nudge to take a sip of water!',
        });
        hydrationGentleReminderAt = 0;
        return true;
      }
    }
    return false;
  }

  function showStageInterruption(stage, hostname) {
    const duration = Math.round(getActiveSiteMs() / 1000);
    let handled = false;

    if (stage === 'break' && !canShowBreakOverlay()) {
      return;
    }

    try {
      chrome.runtime.sendMessage(
        {
          type: 'DOOM_SCROLL_DETECTED',
          site: hostname,
          stage: stage,
          duration: duration,
          scrollCount: scrollEvents.length,
        },
        (response) => {
          handled = true;
          if (response && response.action === 'INTERVENE') {
            if (stage === 'break' && !canShowBreakOverlay()) {
              return;
            }
            if (typeof EyeFlowIntelligence !== 'undefined') {
              EyeFlowIntelligence.markReminderShown();
            }
            showInterruption(response.stage, response.settings);
          }
        }
      );

      // Keep the stats/reporting round-trip, but do not let a missed callback block the
      // actual eye-break UI on fast-moving reels/shorts surfaces during testing.
      setTimeout(() => {
        if (handled) return;
        if (stage === 'break' && !canShowBreakOverlay()) {
          return;
        }
        if (typeof EyeFlowIntelligence !== 'undefined') {
          EyeFlowIntelligence.markReminderShown();
        }
        showInterruption(stage, currentSettings || {});
      }, 800);
    } catch (e) {
      // Extension context may be invalidated - ignore
      if (typeof EyeFlowIntelligence !== 'undefined') {
        EyeFlowIntelligence.markReminderShown();
      }
      showInterruption(stage, currentSettings || {});
    }
  }

  // -------------------------------------------------------
  // HANDLE SCROLL EVENT — Called on every scroll
  // -------------------------------------------------------
  // We record the timestamp of each scroll event. Later, we
  // check how many scrolls happened within the detection window.
  function handleScroll(event) {
    // Don't track if extension is not active
    if (!isActive) return;

    const now = Date.now();

    // Instagram/Reels/Shorts often fire multiple overlapping events
    // for a single gesture; keep one signal every 120ms.
    if (now - lastScrollSignalAt < 120) return;
    lastScrollSignalAt = now;

    if (!isMeaningfulScrollSignal(event)) return;

    // Record this scroll event's timestamp
    scrollEvents.push(now);
    recordActivity();

    // Clean up old scroll events (outside the detection window)
    const timeWindow = EyeFlowIntelligence.getTimeWindow(getHostname());
    scrollEvents = scrollEvents.filter((t) => now - t < timeWindow);

    // Hard cap to prevent memory leaks from infinite micro-scrolls
    if (scrollEvents.length > 250) {
      scrollEvents = scrollEvents.slice(-250);
    }
  }

  function isMeaningfulScrollSignal(event) {
    if (!event) return true;

    if (event.type === 'wheel') {
      return Math.abs(event.deltaY || 0) > 6;
    }

    if (event.type === 'touchmove') {
      return true;
    }

    if (event.type === 'scroll') {
      return true;
    }

    return false;
  }

  // -------------------------------------------------------
  // CHECK FOR DOOM SCROLL — Periodic check (runs every 2 sec)
  // -------------------------------------------------------
  // This function runs on an interval and checks if the user
  // is doom scrolling based on scroll count vs threshold.
  function checkForDoomScroll() {
    syncRouteState();
    syncSessionAndSharedTimer();

    // Don't check if extension is not active
    if (!isActive) return;
    if (!isTabActivelyVisible()) return;

    const hostname = getHostname();
    const now = Date.now();

    if (EyeFlowIntelligence.isSingleVideoPage()) return;

    // A shared DS break that is already due should not be blocked by older
    // page heuristics like "single video page", temporary chat detection, or
    // typing checks. Once the timer reaches zero on a real DS surface, fire the
    // break flow instead of letting the chip sit at 00:00 forever.
    if (isDoomScrollContext()) {
      const isBreakDue =
        Boolean(sharedDsState.nextBreakTargetMs) &&
        getBreakCycleMs() >= sharedDsState.nextBreakTargetMs;
      if (isBreakDue) {
        if (
          pendingHydrationPopup &&
          !warningElement &&
          !(typeof EyeFlowOverlay !== 'undefined' && EyeFlowOverlay.isShowing())
        ) {
          tryShowHydrationPopup();
          return;
        }

        if (now - lastDoomScrollTime < 5000) return;
        lastDoomScrollTime = now;
        showStageInterruption('break', hostname);
        return;
      }
    }

    // Don't check if user is typing (they're working)
    if (EyeFlowIntelligence.isUserTyping()) return;

    // Pause the stronger feed reminder while the user is chatting,
    // on a call, or in a live/shared-watch flow.
    if (isCommunicationContext()) return;

    if (maybeShowHydrationGentleReminder()) {
      return;
    }

    if (
      pendingHydrationPopup &&
      !warningElement &&
      !(typeof EyeFlowOverlay !== 'undefined' && EyeFlowOverlay.isShowing())
    ) {
      tryShowHydrationPopup();
      return;
    }

    if (isHydrationDue()) {
      if (isDoomScrollContext()) {
        if (shouldMergeHydrationIntoBreak()) {
          hydrationMergedIntoNextBreak = true;
        } else {
          tryShowHydrationPopup();
          return;
        }
      } else if (canShowGentleReminder()) {
        showGentleReminder({
          title: 'Water check-in',
          text: 'Take a few sips if you have not had water in a while.',
        });
        resetHydrationTimer();
        return;
      }
    }

    if (isDoomScrollContext()) {
      const scrollThreshold = EyeFlowIntelligence.getScrollThreshold(hostname);
      const timeWindow = EyeFlowIntelligence.getTimeWindow(hostname);
      const recentScrollCount = scrollEvents.filter((t) => now - t < timeWindow).length;
      if (recentScrollCount >= scrollThreshold && now - lastDoomScrollTime > 5000) {
        lastDoomScrollTime = now;
        scrollEvents = [];
        resetBreakCycle();
        showStageInterruption('break', hostname);
        return;
      }

      if (!sharedDsState.nextBreakTargetMs || getBreakCycleMs() < sharedDsState.nextBreakTargetMs)
        return;
      const stage = 'break';
      if (now - lastDoomScrollTime < 5000) return;

      lastDoomScrollTime = now;
      showStageInterruption(stage, hostname);
      return;
    }

    // Non-DS pages now use only the gentle reminder system.
    // Keep a hard stop here so legacy generic warning logic cannot
    // accidentally fire on normal browsing surfaces like long YouTube videos.
    return;
  }
  // -------------------------------------------------------
  // SHOW INTERRUPTION — Display nudge, warning, or full break
  // -------------------------------------------------------
  // Based on the stage from the intelligence layer, show the
  // appropriate level of interruption.
  function showInterruption(stage, settings) {
    const hostname = getHostname();
    const timeOnSite = Math.round(getActiveSiteMs() / 60000); // minutes
    const hydrationPrompt = hydrationMergedIntoNextBreak || shouldMergeHydrationIntoBreak();

    switch (stage) {
      case 'nudge':
        break;

      case 'warning':
        removeGentleReminder();
        removeNudge();
        showWarning(timeOnSite);
        break;

      case 'break':
        if (!canShowBreakOverlay()) {
          return;
        }
        lastBreakOverlayShownAt = Date.now();
        removeGentleReminder();
        removeNudge();
        removeWarning();
        // Tell overlay.js to show the full eye-break overlay
        if (typeof EyeFlowOverlay !== 'undefined') {
          EyeFlowOverlay.show(settings, hostname, timeOnSite, { hydrationPrompt });
        }
        break;
    }
  }

  // -------------------------------------------------------
  // SHOW NUDGE — Small floating pill at the bottom of screen
  // -------------------------------------------------------
  // This is the gentlest interruption. A small message that says
  // something like "👁️ You've been scrolling for 5 min".
  function showNudge(timeOnSite) {
    // Don't show if already visible
    if (nudgeElement) return;

    nudgeElement = document.createElement('div');
    nudgeElement.id = 'eyeflow-nudge';
    nudgeElement.innerHTML = `
      <div class="eyeflow-nudge-content">
        <span class="eyeflow-nudge-icon">◉</span>
        <span class="eyeflow-nudge-text">Still here? ${timeOnSite} min already. Move your eyes for 15 seconds now.</span>
        <button class="eyeflow-nudge-dismiss" title="Dismiss">✕</button>
      </div>
    `;

    // Style the nudge (inline styles so they work on any site)
    nudgeElement.style.cssText = `
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 2147483645;
      font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
      animation: eyeflow-slide-up 0.4s ease-out;
    `;

    // Add CSS animation
    const style = document.createElement('style');
    style.id = 'eyeflow-nudge-style';
    style.textContent = `
      @keyframes eyeflow-slide-up {
        from { transform: translateX(-50%) translateY(100px); opacity: 0; }
        to { transform: translateX(-50%) translateY(0); opacity: 1; }
      }
      #eyeflow-nudge .eyeflow-nudge-content {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 13px 18px;
        max-width: min(92vw, 460px);
        background: rgba(255, 248, 239, 0.96);
        backdrop-filter: blur(20px);
        border: 1px solid rgba(118, 92, 64, 0.12);
        border-radius: 22px;
        box-shadow: 0 18px 40px rgba(42, 29, 18, 0.15);
        color: #3f2f24;
        font-size: 14px;
      }
      #eyeflow-nudge .eyeflow-nudge-icon {
        width: 30px;
        height: 30px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        background: linear-gradient(135deg, #d89c60, #9f6b43);
        color: #fff8ef;
        font-size: 13px;
        flex-shrink: 0;
      }
      #eyeflow-nudge .eyeflow-nudge-text {
        line-height: 1.45;
      }
      #eyeflow-nudge .eyeflow-nudge-dismiss {
        background: none;
        border: none;
        color: rgba(63,47,36,0.42);
        cursor: pointer;
        font-size: 14px;
        padding: 0 0 0 6px;
        transition: color 0.2s;
      }
      #eyeflow-nudge .eyeflow-nudge-dismiss:hover { color: #3f2f24; }
    `;

    document.head.appendChild(style);
    document.body.appendChild(nudgeElement);
    nudgeElement.querySelector('.eyeflow-nudge-icon').textContent = 'O';
    nudgeElement.querySelector('.eyeflow-nudge-dismiss').textContent = 'x';

    // Dismiss button handler
    nudgeElement.querySelector('.eyeflow-nudge-dismiss').addEventListener('click', removeNudge);

    // Auto-dismiss after 15 seconds
    setTimeout(removeNudge, 15000);
  }

  // -------------------------------------------------------
  // REMOVE NUDGE — Hide the nudge pill
  // -------------------------------------------------------
  function removeNudge() {
    if (nudgeElement) {
      nudgeElement.remove();
      nudgeElement = null;
    }
    const style = document.getElementById('eyeflow-nudge-style');
    if (style) style.remove();
  }

  // -------------------------------------------------------
  // SHOW WARNING — Larger banner at the top of screen
  // -------------------------------------------------------
  // This is the second stage. A bigger, harder-to-ignore message
  // with an option to start an eye exercise.
  function showWarning(timeOnSite) {
    // Don't show if already visible
    if (warningElement) return;

    warningElement = document.createElement('div');
    warningElement.id = 'eyeflow-warning';
    if (isStrictBreakSite()) {
      warningElement.classList.add('eyeflow-warning-strict');
    }
    warningElement.innerHTML = `
      <div class="eyeflow-warning-content">
        <div class="eyeflow-warning-left">
          <span class="eyeflow-warning-icon">◌</span>
          <div>
            <div class="eyeflow-warning-title">Your eyes may need a pause.</div>
            <div class="eyeflow-warning-subtitle">${timeOnSite} minutes on ${getHostname()}. Take a short guided break so your eyes can move and reset.</div>
          </div>
        </div>
        <div class="eyeflow-warning-actions">
          <button class="eyeflow-warning-btn eyeflow-warning-break">30 seconds - that's all</button>
          <button class="eyeflow-warning-btn eyeflow-warning-dismiss">Maybe later</button>
        </div>
      </div>
    `;

    // Style the warning
    warningElement.style.cssText = `
      position: fixed;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      z-index: 2147483646;
      font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
      background: rgba(28, 20, 14, 0.46);
      backdrop-filter: blur(10px);
      animation: eyeflow-fade-in 0.25s ease-out;
    `;

    // Add styles
    const style = document.createElement('style');
    style.id = 'eyeflow-warning-style';
    style.textContent = `
      @keyframes eyeflow-fade-in {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      #eyeflow-warning .eyeflow-warning-content {
        display: flex;
        flex-direction: column;
        justify-content: center;
        width: min(80vw, 1080px);
        min-height: min(66vh, 560px);
        aspect-ratio: 2 / 1;
        padding: 42px 46px;
        background: rgba(255, 248, 239, 0.97);
        backdrop-filter: blur(20px);
        box-shadow: 0 30px 80px rgba(42,29,18,0.26);
        color: #3f2f24;
        border: 1px solid rgba(118, 92, 64, 0.12);
        border-radius: 34px;
      }
      #eyeflow-warning .eyeflow-warning-left {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 18px;
        width: 100%;
      }
      #eyeflow-warning .eyeflow-warning-icon {
        width: 56px;
        height: 56px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        background: linear-gradient(135deg, #d89c60, #9f6b43);
        color: #fff8ef;
        font-size: 18px;
        flex-shrink: 0;
      }
      #eyeflow-warning .eyeflow-warning-title {
        font-size: clamp(28px, 3vw, 42px);
        line-height: 1.08;
        font-weight: 800;
      }
      #eyeflow-warning .eyeflow-warning-subtitle {
        font-size: clamp(16px, 1.45vw, 21px);
        opacity: 0.78;
        max-width: 760px;
        line-height: 1.6;
      }
      #eyeflow-warning .eyeflow-warning-actions {
        display: flex;
        gap: 14px;
        margin-top: 28px;
        width: 100%;
      }
      #eyeflow-warning .eyeflow-warning-btn {
        padding: 16px 24px;
        border: 1px solid transparent;
        border-radius: 999px;
        cursor: pointer;
        font-size: 17px;
        font-weight: 600;
        transition: all 0.2s;
      }
      #eyeflow-warning .eyeflow-warning-break {
        background: linear-gradient(135deg, #c9864c, #a66a3e);
        color: #fff9f0;
        min-width: 220px;
      }
      #eyeflow-warning .eyeflow-warning-break:hover {
        transform: translateY(-1px);
      }
      #eyeflow-warning .eyeflow-warning-dismiss {
        background: rgba(109, 136, 126, 0.08);
        border-color: rgba(109, 136, 126, 0.14);
        color: #4b5f59;
      }
      #eyeflow-warning .eyeflow-warning-dismiss:hover {
        background: rgba(109, 136, 126, 0.14);
      }
      #eyeflow-warning.eyeflow-warning-strict .eyeflow-warning-dismiss {
        display: none;
      }
      #eyeflow-warning.eyeflow-warning-strict .eyeflow-warning-actions {
        justify-content: flex-start;
      }
      @media (max-width: 720px) {
        #eyeflow-warning {
          padding: 14px;
        }
        #eyeflow-warning .eyeflow-warning-content {
          width: min(96vw, 560px);
          min-height: auto;
          aspect-ratio: auto;
          padding: 28px 22px;
          border-radius: 24px;
        }
        #eyeflow-warning .eyeflow-warning-actions {
          flex-direction: column;
        }
        #eyeflow-warning .eyeflow-warning-break,
        #eyeflow-warning .eyeflow-warning-dismiss {
          width: 100%;
        }
      }
    `;

    document.head.appendChild(style);
    document.body.appendChild(warningElement);
    warningElement.querySelector('.eyeflow-warning-icon').textContent = 'O';

    // "Eye Break Now" button — jump straight to full break
    warningElement.querySelector('.eyeflow-warning-break').addEventListener('click', () => {
      removeWarning();
      if (typeof EyeFlowOverlay !== 'undefined') {
        EyeFlowOverlay.show(currentSettings, getHostname(), timeOnSite);
      }
    });

    // "Later" button — dismiss for now
    warningElement
      .querySelector('.eyeflow-warning-dismiss')
      .addEventListener('click', removeWarning);
    setTimeout(removeWarning, 30000);
  }

  // -------------------------------------------------------
  // REMOVE WARNING — Hide the warning banner
  // -------------------------------------------------------
  function removeWarning() {
    if (warningElement) {
      warningElement.remove();
      warningElement = null;
    }
    const style = document.getElementById('eyeflow-warning-style');
    if (style) style.remove();
  }

  function showGentleReminder(options = {}) {
    const overlayShowing = typeof EyeFlowOverlay !== 'undefined' && EyeFlowOverlay.isShowing();
    if (!options.force && (!canShowGentleReminderWithPassiveVideoSupport() || overlayShowing)) {
      return false;
    }

    if (Date.now() - lastGentleReminderShownAt < GENTLE_REMINDER_DUPLICATE_GUARD_MS) {
      return false;
    }

    removeGentleReminder();
    lastGentleReminderShownAt = Date.now();

    subtleReminderElement = document.createElement('div');
    subtleReminderElement.id = 'eyeflow-gentle-reminder';

    const reminderContent = document.createElement('div');
    reminderContent.className = 'eyeflow-gentle-reminder-content';

    const reminderTitle = document.createElement('div');
    reminderTitle.className = 'eyeflow-gentle-reminder-title';
    reminderTitle.textContent = options.title || 'Your eyes could use a moment';

    const reminderText = document.createElement('div');
    reminderText.className = 'eyeflow-gentle-reminder-text';
    reminderText.textContent = options.text || 'Blink a little and relax your focus.';

    reminderContent.appendChild(reminderTitle);
    reminderContent.appendChild(reminderText);
    subtleReminderElement.appendChild(reminderContent);

    subtleReminderElement.style.cssText = `
      position: fixed;
      top: 18px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 2147483643;
      font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
      animation: eyeflow-gentle-fade 0.28s ease-out;
    `;

    const style = document.createElement('style');
    style.id = 'eyeflow-gentle-reminder-style';
    style.textContent = `
      @keyframes eyeflow-gentle-fade {
        from { opacity: 0; transform: translateX(-50%) translateY(-14px); }
        to { opacity: 1; transform: translateX(-50%) translateY(0); }
      }
      #eyeflow-gentle-reminder .eyeflow-gentle-reminder-content {
        width: min(92vw, 420px);
        padding: 15px 18px;
        border-radius: 20px;
        background: rgba(247, 249, 244, 0.985);
        border: 1px solid rgba(90, 116, 103, 0.18);
        box-shadow: 0 20px 44px rgba(25, 37, 32, 0.16);
        color: #23352f;
        text-align: center;
      }
      #eyeflow-gentle-reminder .eyeflow-gentle-reminder-title {
        font-size: 14px;
        font-weight: 700;
        margin-bottom: 5px;
      }
      #eyeflow-gentle-reminder .eyeflow-gentle-reminder-text {
        font-size: 13px;
        line-height: 1.45;
        opacity: 0.84;
      }
    `;

    document.head.appendChild(style);
    document.body.appendChild(subtleReminderElement);
    setTimeout(removeGentleReminder, 5000);
    return true;
  }

  function removeGentleReminder() {
    if (subtleReminderElement) {
      subtleReminderElement.remove();
      subtleReminderElement = null;
    }
    const style = document.getElementById('eyeflow-gentle-reminder-style');
    if (style) style.remove();
  }

  // -------------------------------------------------------
  // TRACK TIME ON SITE — Send time data to background.js
  // -------------------------------------------------------
  // Every 5 minutes, tell background.js how long the user
  // has been on this site. Used for stats dashboard.
  function startTimeTracking() {
    timeTrackingInterval = setInterval(() => {
      flushDsSiteTime();
    }, SITE_TIME_REPORT_INTERVAL_MS);
  }

  // -------------------------------------------------------
  // LISTEN FOR MESSAGES — From background.js
  // -------------------------------------------------------
  // Handle settings updates, snooze start/end, etc.
  function setupMessageListener() {
    try {
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        // Settings were updated from popup
        if (message.type === 'SETTINGS_UPDATED') {
          currentSettings = message.settings;
          EyeFlowIntelligence.updateSettings(message.settings);
          isActive = Boolean(message.settings.enabled);
          hydrationTargetMs = getTotalActiveUsageMs() + getHydrationTargetMs();
        }

        // Snooze started — stop tracking
        if (message.type === 'SNOOZE_STARTED') {
          syncActiveSession();
          isActive = Boolean(currentSettings?.enabled);
          removeGentleReminder();
          removeNudge();
          removeWarning();
        }

        // Snooze ended — resume tracking
        if (message.type === 'SNOOZE_ENDED') {
          isActive = Boolean(currentSettings?.enabled);
          syncSessionAndSharedTimer();
        }

        if (message.type === 'SYSTEM_IDLE_STATE_CHANGED') {
          isSystemIdle = message.state !== 'active';
          if (isSystemIdle) {
            if (isEffectivelySystemIdle()) {
              removeGentleReminder();
            }
            syncSessionAndSharedTimer();
          } else {
            syncSessionAndSharedTimer();
          }
        }

        if (message.type === 'RESET_SESSION_TIMERS') {
          resetSessionTimersFromBackground(message.snapshot);
          // Re-anchor the sync timestamp to now so stale elapsed time doesn't
          // immediately push the fresh shared DS state past the break target.
          sharedDsState.lastSyncedAt = Date.now();
        }

        if (message.type === 'SHOW_GENTLE_REMINDER') {
          if (showGentleReminder(message)) {
            acknowledgeLocalGentleReminder();
          }
        }

        if (message.type === 'SHOW_WATER_GENTLE_REMINDER') {
          showGentleReminder({
            title: 'Water check-in',
            text: 'Take a few sips of water when you get a moment.',
          });
        }

        if (message.type === 'SHOW_HYDRATION_POPUP') {
          tryShowHydrationPopup();
        }

        if (message.type === 'QUEUE_HYDRATION_FOR_NEXT_BREAK') {
          hydrationMergedIntoNextBreak = true;
          pendingHydrationPopup = false;
        }

        if (message.type === 'CAN_SHOW_GENTLE_REMINDER') {
          sendResponse({ allow: canShowGentleReminderWithPassiveVideoSupport() });
          return true;
        }

        if (message.type === 'GET_PAGE_REMINDER_CONTEXT') {
          sendResponse({
            isDoomScrollContext: isDoomScrollContext(),
            msUntilEyeBreak: getMsUntilEyeBreak(),
            canShowGentleReminder: canShowGentleReminderWithPassiveVideoSupport(),
            hasPassiveVideoPresence: isWatchingLongVideoPassively() || isWatchingPassiveDsVideo(),
            hasRecentRegularPageInput: hasRecentRegularPageInput(),
            isUsageActive: isUsageActiveNow(),
            isDsActive: shouldCountActiveTime(),
          });
          return true;
        }
        if (!message.type.startsWith('GET_') && message.type !== 'CAN_SHOW_GENTLE_REMINDER') {
          sendResponse({ success: true });
        }
        return true;
      });
    } catch (e) {
      // Ignore if extension context is invalid
    }
  }

  // -------------------------------------------------------
  // INITIALIZE — Set everything up when page loads
  // -------------------------------------------------------
  function init() {
    // Get initial settings from background.js
    try {
      chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (settings) => {
        if (runtimeCallbackFailed()) return;
        if (settings) {
          currentSettings = settings;
          isActive = Boolean(settings.enabled);
          EyeFlowIntelligence.updateSettings(settings);
          hydrationTargetMs = getTotalActiveUsageMs() + getHydrationTargetMs();
        }
      });
      chrome.runtime.sendMessage({ type: 'GET_SHARED_DS_STATE' }, (response) => {
        if (runtimeCallbackFailed()) return;
        applySharedDsState(response);
      });
      chrome.runtime.sendMessage({ type: 'GET_SYSTEM_STATE' }, (response) => {
        if (runtimeCallbackFailed()) return;
        if (response && response.state) {
          isSystemIdle = response.state !== 'active';
          syncSessionAndSharedTimer();
        }
      });
    } catch (e) {
      // Ignore
    }

    // Attach scroll listener
    // Using { passive: true } for better scroll performance
    window.addEventListener('scroll', handleScroll, { passive: true });
    document.addEventListener('scroll', handleScroll, { passive: true, capture: true });
    document.addEventListener('wheel', handleScroll, { passive: true, capture: true });
    document.addEventListener('touchmove', handleScroll, { passive: true, capture: true });
    document.addEventListener('click', handleInteraction, { passive: true, capture: true });
    document.addEventListener('pointerup', handleInteraction, { passive: true, capture: true });
    document.addEventListener('keydown', handleInteraction, { passive: true, capture: true });
    document.addEventListener(
      'visibilitychange',
      () => {
        if (document.hidden) {
          flushDsSiteTime();
        } else {
          recordActivity();
        }
        syncSessionAndSharedTimer();
      },
      { passive: true }
    );
    window.addEventListener(
      'focus',
      () => {
        recordActivity();
        syncSessionAndSharedTimer();
      },
      { passive: true }
    );
    window.addEventListener(
      'blur',
      () => {
        flushDsSiteTime();
        syncSessionAndSharedTimer();
      },
      { passive: true }
    );
    window.addEventListener('pagehide', flushDsSiteTime, { passive: true });
    window.addEventListener('beforeunload', flushDsSiteTime, { passive: true });
    window.addEventListener('eyeflow-break-flow-closed', resetBreakCycle, { passive: true });
    // Hydration actions are handled in content so the timer state stays in one place.
    window.addEventListener('eyeflow-hydration-completed', resetHydrationTimer, { passive: true });
    window.addEventListener(
      'eyeflow-hydration-remind-soon',
      () => {
        hydrationMergedIntoNextBreak = false;
        pendingHydrationPopup = false;
        try {
          chrome.runtime.sendMessage({ type: 'HYDRATION_REMIND_SOON' });
        } catch (e) {
          // Ignore temporary extension-context issues.
        }
      },
      { passive: true }
    );

    lastContextKey = getDoomScrollContextKey();
    if (isSinglePostGraceContextKey(lastContextKey)) {
      singlePostGraceContextKey = lastContextKey;
      singlePostGraceStartedAt = Date.now();
    }
    resetTrackedSession();
    syncSessionAndSharedTimer();

    // Start the doom-scroll check interval (every 2 seconds)
    scrollCheckInterval = setInterval(checkForDoomScroll, SCROLL_CHECK_INTERVAL_MS);

    // Start time tracking
    startTimeTracking();

    // Start listening for messages from background.js
    setupMessageListener();
  }

  // Start everything
  init();

  // -------------------------------------------------------
  // PUBLIC API
  // -------------------------------------------------------
  return {
    getHostname,
    removeNudge,
    removeWarning,
  };
})();
