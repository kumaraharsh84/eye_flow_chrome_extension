/**
 * @file content.js
 * @description Injected Content Script for Doom-Scroll & Activity Monitoring.
 *
 * @purpose
 * This script runs in the context of every webpage the user visits. Its primary jobs are:
 *   1. Identifying if the current page or subroute is a known "doom-scrolling" context.
 *   2. Listening for user interactions (clicks, keyboard arrows, scrolling) to calculate "presence".
 *   3. Counting the active minutes spent on social media sites and reporting them to storage.
 *   4. Interfacing with `overlay.js` to mount fullscreen guided eye breaks or water reminders.
 *   5. Synchronizing the active state tab duration with other tabs via background script relays.
 *
 * @project-fit
 *   - Instantiated as `EyeFlowContent` wrapper.
 *   - Runs in the isolated web page DOM context.
 *   - Uses `chrome.runtime` messaging to communicate configuration queries, log audits,
 *     and report time rollups back to the central Service Worker (`background.js`).
 */

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

// If true, mounts a visible overlay in the bottom left displaying live countdowns for debugging.
const EYEFLOW_DEBUG_CONTENT = false;

/**
 * @namespace EyeFlowContent
 * @description Main content script controller wrapping local variables, context parsers,
 * active listeners, and renderers in a closure.
 */
const EyeFlowContent = (() => {
  // A Set of hostnames representing targeted doom-scroll surfaces.
  const DOOM_SCROLL_SITES = new Set([
    'instagram.com',
    'tiktok.com',
    'reddit.com',
    'facebook.com',
    'twitter.com',
    'x.com',
  ]);

  // Sensitive keywords found in hostnames. If matched, reminders are suppressed to avoid interrupting tasks.
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
    'images',
  ];

  // Sensitive keywords found in URL paths.
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

  // Platforms containing chat features where reminders are paused during active conversations.
  const COMMUNICATION_HOST_KEYWORDS = [
    'instagram',
    'facebook',
    'messenger',
    'x.com',
    'twitter',
    'discord',
    'snapchat',
  ];

  // Frequency at which we write cumulative site time to storage (1 minute).
  const SITE_TIME_REPORT_INTERVAL_MS = 60 * 1000;

  // Random variance range added to hydration targets.
  const HYDRATION_JITTER_MINUTES = 3;

  // Keystroke/presence activity window. Users inactive longer than this are considered idle.
  const PRESENCE_WINDOW_MS = 35 * 1000;

  // Idle duration check window for non-social sites (2 minutes).
  const REGULAR_PAGE_INACTIVITY_WINDOW_MS = 2 * 60 * 1000;

  // Window (3 minutes) during which pending water reminders can merge into upcoming eye breaks.
  const HYDRATION_EYE_MERGE_WINDOW_MS = 3 * 60 * 1000;
  const HYDRATION_REMIND_SOON_WINDOW_MS = 5 * 60 * 1000;
  const HYDRATION_GENTLE_DELAY_MS = 3 * 60 * 1000;

  // Temporary grace period (1 minute) granted when visiting individual posts.
  const SINGLE_POST_GRACE_MS = 60 * 1000;

  // Debounce window (1 minute) to prevent duplicate break screen triggers.
  const BREAK_DUPLICATE_GUARD_MS = 60 * 1000;

  // Session reset timeout after continuous inactivity (15 minutes).
  const SESSION_RESET_INACTIVITY_MS = 15 * 60 * 1000;

  // Timing check loop interval (2 seconds).
  const SCROLL_CHECK_INTERVAL_MS = 2000;

  // --- Scroll & State Variables ---
  let lastDoomScrollTime = 0;
  let scrollCheckInterval = null;
  let siteEntryTime = Date.now();
  let timeTrackingInterval = null;
  let isActive = true;
  let currentSettings = null;
  let lastScrollSignalAt = 0;
  let lastActivityAt = Date.now();
  let lastMeaningfulInputAt = Date.now();
  let lastKnownUrl = window.location.href;
  let pendingHydrationPopup = false;
  let activeSiteMs = 0;
  let activeSessionStartedAt = 0;
  let lastReportedActiveSiteMs = 0;
  let hydrationTargetMs = 0;
  let lastContextKey = '';
  let isSystemIdle = false;
  let totalActiveUsageMs = 0;
  let totalUsageStartedAt = 0;
  let hydrationMergedIntoNextBreak = false;
  let hydrationGentleReminderAt = 0;
  let lastBreakOverlayShownAt = 0;
  let lastGentleReminderFallbackAt = 0;
  let lastGentleReminderShownAt = 0;
  let singlePostGraceContextKey = '';
  let singlePostGraceStartedAt = 0;

  // --- UI Elements ---
  let warningElement = null;
  let subtleReminderElement = null;
  let debugTimerElement = null;
  let debugTimerInterval = null;
  let debugTimerMeta = {
    nextGentleReminderAt: 0,
    gentlePausedRemainingMs: 0,
    gentleState: 'off',
    gentlePauseReason: 'none',
    nextWaterReminderAt: 0,
    waterReminderPending: false,
    waterQueuedForNextBreak: false,
    lastFetchedAt: 0,
  };

  let sharedDsSyncInFlight = false;
  let sharedDsState = {
    activeMs: 0,
    nextBreakTargetMs: 0,
    isActive: false,
    contextKey: '',
    activeTabId: 0,
    lastSyncedAt: 0,
  };

  /**
   * @function runtimeCallbackFailed
   * @description Validates if chrome runtime API generated errors.
   */
  function runtimeCallbackFailed() {
    return Boolean(chrome.runtime?.lastError);
  }

  // -------------------------------------------------------
  // GET HOSTNAME — Extract clean domain name from URL
  // -------------------------------------------------------
  /**
   * @function getHostname
   * @description Strips leading subdomains like "www" or "m" from location hostname.
   * @returns {string} Clean hostname (e.g. "instagram.com").
   */
  function getHostname() {
    return window.location.hostname.replace(/^(www|m)\./, '');
  }

  /**
   * @function getStatsSiteLabel
   * @description Maps URL contexts to human-readable site labels for stats tables.
   */
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

  /**
   * @function getDoomScrollContextKey
   * @description Inspects subroutes and page layout to check if the user is on an
   * infinite doom-scroll feed layout (reels, shorts, main feed) or a passive work zone.
   *
   * @returns {string} Context identifier string. Returns empty string if on a non-feed route.
   */
  function getDoomScrollContextKey() {
    const hostname = getHostname();

    // Do not count time spent entering usernames or passwords
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

  /**
   * @function isDoomScrollContext
   * @description Checks if doom scroll context is active, taking post grace windows into account.
   */
  function isDoomScrollContext() {
    const contextKey = getDoomScrollContextKey();
    if (!contextKey) {
      return false;
    }

    // Ignore single post detail pages during their grace period (lets users read an article without breaks)
    if (isSinglePostGraceContextKey(contextKey) && isWithinSinglePostGraceWindow(contextKey)) {
      return false;
    }

    return true;
  }

  /**
   * @function isSinglePostGraceContextKey
   * @description Audits if a key matches detail-view routes.
   */
  function isSinglePostGraceContextKey(contextKey) {
    return typeof contextKey === 'string' && contextKey.endsWith('/detail');
  }

  /**
   * @function isWithinSinglePostGraceWindow
   * @description Audits if the grace period for reading a detailed single post has not expired.
   */
  function isWithinSinglePostGraceWindow(contextKey = getDoomScrollContextKey()) {
    if (!isSinglePostGraceContextKey(contextKey)) {
      return false;
    }

    if (singlePostGraceContextKey !== contextKey || !singlePostGraceStartedAt) {
      return false;
    }

    return Date.now() - singlePostGraceStartedAt < SINGLE_POST_GRACE_MS;
  }

  /**
   * @function getSinglePostGraceRemainingMs
   * @description Calculates remaining grace period milliseconds.
   */
  function getSinglePostGraceRemainingMs(contextKey = getDoomScrollContextKey()) {
    if (!isWithinSinglePostGraceWindow(contextKey)) {
      return 0;
    }

    return Math.max(0, SINGLE_POST_GRACE_MS - (Date.now() - singlePostGraceStartedAt));
  }

  /**
   * @function isPassiveViewerDoomContext
   * @description Identifies if user is on short-form video layouts.
   */
  function isPassiveViewerDoomContext() {
    const contextKey = getDoomScrollContextKey();
    return (
      contextKey === 'tiktok.com' ||
      contextKey === 'youtube.com/shorts' ||
      contextKey === 'instagram.com/reels' ||
      contextKey === 'facebook.com/video'
    );
  }

  /**
   * @function isStrictBreakSite
   * @description Identifies if user is browsing platforms that hide skip buttons during breaks.
   */
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

  /**
   * @function recordActivity
   * @description Refreshes timestamps representing recent active inputs.
   */
  function recordActivity() {
    const now = Date.now();
    lastActivityAt = now;
    lastMeaningfulInputAt = now;
  }

  /**
   * @function hasRecentMeaningfulInput
   * @description Audits keyboard/scroll logs. Returns true if inputs occurred within presence window.
   */
  function hasRecentMeaningfulInput() {
    return Date.now() - lastMeaningfulInputAt <= PRESENCE_WINDOW_MS;
  }

  /**
   * @function hasRecentRegularPageInput
   * @description Audits inputs for general browsing pages.
   */
  function hasRecentRegularPageInput() {
    return Date.now() - lastMeaningfulInputAt <= REGULAR_PAGE_INACTIVITY_WINDOW_MS;
  }

  // --- Platform-Specific Subroute Detectors ---

  function getInstagramDoomSurfaceKey() {
    const path = window.location.pathname || '/';

    if (path.startsWith('/reels') || path.startsWith('/reel/')) {
      return 'instagram.com/reels';
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

    if (/^\/[^/]+\/likes\/?$/.test(path) || /^\/[^/]+\/media\/?$/.test(path)) {
      return 'x.com/profile-feed';
    }

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
        'yt-tab-shape[tab-title="Shorts"][selected], [role="tab"][aria-label*="Shorts" i][aria-selected="true"], [aria-selected="true"][tab-identifier="shorts"], [selected][tab-identifier="shorts"], .iron-selected[tab-identifier="shorts"]'
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

    if (path.includes('/spotlight/') || path.startsWith('/spotlight')) {
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

    return '';
  }

  /**
   * @function isAuthOrVerificationSurface
   * @description Audits if user is currently looking at login page forms.
   */
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

  /**
   * @function handleInteraction
   * @description Log activity triggers on mouse clicks or arrow/scroll keystrokes.
   */
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

  /**
   * @function getHydrationTargetMs
   * @description Fetches standard hydration reminder thresholds in milliseconds.
   */
  function getHydrationTargetMs() {
    const baseMinutes = currentSettings?.hydrationReminderMin ?? 80;
    return baseMinutes * 60 * 1000;
  }

  /**
   * @function applySharedDsState
   * @description Syncs the page's local timer values with the shared background timer.
   */
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
    if (snapshot.lastBreakOverlayShownAt) {
      lastBreakOverlayShownAt = snapshot.lastBreakOverlayShownAt;
    }
  }

  /**
   * @function resetTrackedSession
   * @description Resets session variables and recalculates hydration target intervals.
   */
  function resetTrackedSession({ resetTotalTime = true } = {}) {
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

  /**
   * @function flushDsSiteTime
   * @description Flushes accumulated browsing time on this site to local storage.
   */
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

  /**
   * @function resetSessionTimersFromBackground
   * @description Wipes local countdowns and applies a snapshot from the background script.
   */
  function resetSessionTimersFromBackground(snapshot) {
    resetTrackedSession();
    applySharedDsState(snapshot);
    lastGentleReminderFallbackAt = 0;
    lastGentleReminderShownAt = 0;
    removeGentleReminder();
    removeWarning();
  }

  /**
   * @function syncRouteState
   * @description Checks if the URL has changed since the last check, and resets
   * timers if the user navigated away from a doom-scroll site.
   */
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
      removeWarning();
    }

    if (contextChanged && lastContextKey && lastContextKey !== contextKey) {
      flushDsSiteTime();

      if (contextKey && !lastContextKey) {
        lastMeaningfulInputAt = Date.now();
        lastActivityAt = Date.now();
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

  /**
   * @function isTabActivelyVisible
   * @description Checks if tab is active and visible.
   */
  function isTabActivelyVisible() {
    return !document.hidden && document.hasFocus();
  }

  /**
   * @function isSensitiveReminderContext
   * @description Identifies if page has sensitive password, billing, or meeting components
   * to avoid showing reminders.
   */
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

  /**
   * @function isCommunicationContext
   * @description Checks if user is currently messaging or calling.
   */
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
    if (communicationHost && (callUiSignals || liveOrSharedWatchSignals)) return true;
    if (path.includes('/direct/') || path.includes('/messages/') || path.includes('/inbox'))
      return true;

    return false;
  }

  /**
   * @function canShowGentleReminder
   * @description Checks if a gentle reminder notification can be shown on the active page.
   */
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

  /**
   * @function isWatchingLongVideoPassively
   * @description Validates if user is passively watching a long YouTube video.
   */
  function isWatchingLongVideoPassively() {
    if (getHostname() !== 'youtube.com') return false;
    if ((window.location.pathname || '') !== '/watch') return false;
    if (isDoomScrollContext()) return false;

    return Boolean(findPassiveVideoCandidate({ requireLongDuration: true }));
  }

  /**
   * @function findPassiveVideoCandidate
   * @description Finds visible video players on screen.
   */
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

    return Boolean(findPassiveVideoCandidate({ requireLongDuration: true }));
  }

  /**
   * @function shouldCountUsageTime
   * @description Determines if active presence time should increment.
   */
  function shouldCountUsageTime() {
    const overlayShowing = typeof EyeFlowOverlay !== 'undefined' && EyeFlowOverlay.isShowing();
    if (!isActive || isEffectivelySystemIdle() || !isTabActivelyVisible() || overlayShowing) {
      return false;
    }

    if (isPassiveViewerDoomContext()) {
      return true;
    }

    if (isWatchingLongVideoPassively()) {
      return true;
    }

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

  /**
   * @function syncActiveSession
   * @description Tracks session duration deltas when state flips (active vs inactive).
   */
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

  /**
   * @function getActiveSiteMs
   * @description Returns accumulated active session milliseconds.
   */
  function getActiveSiteMs() {
    syncActiveSession();

    if (!activeSessionStartedAt) {
      return activeSiteMs;
    }

    return activeSiteMs + (Date.now() - activeSessionStartedAt);
  }

  /**
   * @function getEstimatedSharedDsActiveMs
   * @description Calculates current estimated shared doom scroll active duration.
   */
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

  /**
   * @function resetBreakCycle
   * @description Restores timers and resets the active session.
   */
  function resetBreakCycle() {
    sharedDsState.activeMs = 0;
    sharedDsState.nextBreakTargetMs = EyeFlowIntelligence.getNextBreakTargetMs();
    sharedDsState.isActive = false;
    sharedDsState.lastSyncedAt = Date.now();
    activeSessionStartedAt = 0;
    lastDoomScrollTime = Date.now();
  }

  /**
   * @function maybeResetSessionAfterLongGap
   * @description Clears active states if the tab was abandoned for a long time.
   */
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

  /**
   * @function resetHydrationTimer
   * @description Resets hydration variables and updates background stats.
   */
  function resetHydrationTimer() {
    hydrationMergedIntoNextBreak = false;
    hydrationGentleReminderAt = 0;
    pendingHydrationPopup = false;

    try {
      chrome.runtime.sendMessage({ type: 'HYDRATION_COMPLETED' });
    } catch (e) {
      // Ignore
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

  /**
   * @function syncSharedDsTimer
   * @description Sends synchronization signals to background.js.
   */
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

  function acknowledgeLocalGentleReminder(now = Date.now()) {
    lastGentleReminderShownAt = now;
    lastGentleReminderFallbackAt = now;
  }

  function isHydrationDue() {
    if (!hydrationTargetMs) return false;
    return getTotalActiveUsageMs() >= hydrationTargetMs;
  }

  /**
   * @function tryShowHydrationPopup
   * @description Mounts full-screen hydration popup, postponing if eye break is showing.
   */
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

  function maybeShowHydrationGentleReminder() {
    if (!hydrationGentleReminderAt) return false;
    if (Date.now() < hydrationGentleReminderAt) return false;
    if (!canShowGentleReminder()) return false;
    hydrationGentleReminderAt = 0;
    showGentleReminder({
      title: 'Water check-in',
      text: 'Take a few sips if you have not had water in a while.',
    });
    resetHydrationTimer();
    return true;
  }

  /**
   * @function showStageInterruption
   * @description Communicates triggers to the background script and shows overlays.
   */
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
          scrollCount: 0,
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
      if (typeof EyeFlowIntelligence !== 'undefined') {
        EyeFlowIntelligence.markReminderShown();
      }
      showInterruption(stage, currentSettings || {});
    }
  }

  // -------------------------------------------------------
  // HANDLE SCROLL EVENT — Called on every scroll
  // -------------------------------------------------------
  // We record that a scroll happened to detect active usage.
  /**
   * @function handleScroll
   * @description Debounces scroll triggers and records presence activity.
   */
  function handleScroll(event) {
    if (!isActive) return;

    const now = Date.now();

    if (now - lastScrollSignalAt < 120) return;
    lastScrollSignalAt = now;

    if (!isMeaningfulScrollSignal(event)) return;

    recordActivity();
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
  // is doom scrolling based on time limit checks.
  /**
   * @function checkForDoomScroll
   * @description Core polling cycle (runs every 2 seconds). Audits active doom scroll durations,
   * checks if break is due, and handles hydration merges.
   */
  function checkForDoomScroll() {
    syncRouteState();
    syncSessionAndSharedTimer();

    if (!isActive) return;
    if (!isTabActivelyVisible()) return;

    const hostname = getHostname();
    const now = Date.now();

    if (EyeFlowIntelligence.isSingleVideoPage()) return;

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

        chrome.runtime.sendMessage({
          type: 'ADD_AUDIT_LOG',
          event: 'Time Limit Reached',
          details: `Break cycle time: ${Math.round(getBreakCycleMs() / 1000)}s, target: ${Math.round(sharedDsState.nextBreakTargetMs / 1000)}s`,
        });

        lastDoomScrollTime = now;
        showStageInterruption('break', hostname);
        return;
      }
    }

    if (EyeFlowIntelligence.isUserTyping()) return;
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

    return;
  }

  /**
   * @function showInterruption
   * @description Triggers warnings or break overlays depending on active stages.
   */
  function showInterruption(stage, settings) {
    const hostname = getHostname();
    const timeOnSite = Math.round(getActiveSiteMs() / 60000);
    const hydrationPrompt = hydrationMergedIntoNextBreak || shouldMergeHydrationIntoBreak();

    switch (stage) {
      case 'nudge':
        break;

      case 'warning':
        removeGentleReminder();
        showWarning(timeOnSite);
        break;

      case 'break':
        if (!canShowBreakOverlay()) {
          chrome.runtime.sendMessage({
            type: 'ADD_AUDIT_LOG',
            event: 'Break Blocked by Duplicate Guard',
            details: `Gap since last break: ${Math.round((Date.now() - lastBreakOverlayShownAt) / 1000)}s (guard: ${Math.round(BREAK_DUPLICATE_GUARD_MS / 1000)}s)`,
          });
          return;
        }
        chrome.runtime.sendMessage({
          type: 'ADD_AUDIT_LOG',
          event: 'Break Overlay Shown',
          details: `Overlay triggered on ${hostname} (time on site: ${timeOnSite}m)`,
        });
        lastBreakOverlayShownAt = Date.now();
        removeGentleReminder();
        removeWarning();
        if (typeof EyeFlowOverlay !== 'undefined') {
          EyeFlowOverlay.show(settings, hostname, timeOnSite, { hydrationPrompt });
        }
        break;
    }
  }

  // -------------------------------------------------------
  // SHOW WARNING — Larger banner at the top of screen
  // -------------------------------------------------------
  /**
   * @function showWarning
   * @description Mounts a screen-wide blocking warning panel with blur backdrops.
   */
  function showWarning(timeOnSite) {
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

    warningElement.querySelector('.eyeflow-warning-break').addEventListener('click', () => {
      removeWarning();
      if (typeof EyeFlowOverlay !== 'undefined') {
        EyeFlowOverlay.show(currentSettings, getHostname(), timeOnSite);
      }
    });

    warningElement
      .querySelector('.eyeflow-warning-dismiss')
      .addEventListener('click', removeWarning);
    setTimeout(removeWarning, 30000);
  }

  // -------------------------------------------------------
  // REMOVE WARNING — Hide the warning banner
  // -------------------------------------------------------
  /**
   * @function removeWarning
   * @description Cleans up warning overlay elements from the active document view.
   */
  function removeWarning() {
    if (warningElement) {
      warningElement.remove();
      warningElement = null;
    }
    const style = document.getElementById('eyeflow-warning-style');
    if (style) style.remove();
  }

  /**
   * @function showGentleReminder
   * @description Mounts a small floating toast reminder at the top-center of the screen.
   */
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

  /**
   * @function removeGentleReminder
   * @description Cleans up gentle reminders.
   */
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
  /**
   * @function startTimeTracking
   * @description Launches interval loops writing accumulated tab time to local storage.
   */
  function startTimeTracking() {
    timeTrackingInterval = setInterval(() => {
      flushDsSiteTime();
    }, SITE_TIME_REPORT_INTERVAL_MS);
  }

  /**
   * @function updateDebugTimerChip
   * @description Diagnostic UI overlays displaying countdown details.
   */
  function updateDebugTimerChip() {
    if (!EYEFLOW_DEBUG_CONTENT) {
      removeDebugTimerChip();
      return;
    }

    const overlayShowing = typeof EyeFlowOverlay !== 'undefined' && EyeFlowOverlay.isShowing();
    const shouldShow = isActive && !overlayShowing;

    if (!shouldShow) {
      removeDebugTimerChip();
      return;
    }

    syncDebugTimerMeta();

    if (EYEFLOW_DEBUG_CONTENT && !debugTimerElement) {
      debugTimerElement = document.createElement('div');
      debugTimerElement.id = 'eyeflow-debug-timer';
      debugTimerElement.innerHTML = `
        <div class="eyeflow-debug-timer-content">
          <div class="eyeflow-debug-timer-row">
            <div class="eyeflow-debug-timer-label">Eye break (tab)</div>
            <div class="eyeflow-debug-timer-value" data-debug-timer="eye">0:00</div>
          </div>
          <div class="eyeflow-debug-timer-row">
            <div class="eyeflow-debug-timer-label">Gentle (global)</div>
            <div class="eyeflow-debug-timer-value" data-debug-timer="gentle">0:00</div>
          </div>
          <div class="eyeflow-debug-timer-row">
            <div class="eyeflow-debug-timer-label">Water (global)</div>
            <div class="eyeflow-debug-timer-value" data-debug-timer="water">0:00</div>
          </div>
        </div>
      `;
      debugTimerElement.style.cssText = `
        position: fixed;
        left: 18px;
        bottom: 18px;
        z-index: 2147483642;
        font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
        pointer-events: none;
      `;

      const style = document.createElement('style');
      style.id = 'eyeflow-debug-timer-style';
      style.textContent = `
        #eyeflow-debug-timer .eyeflow-debug-timer-content {
          min-width: 156px;
          padding: 10px 12px;
          border-radius: 16px;
          background: rgba(28, 20, 14, 0.28);
          border: 1px solid rgba(216, 156, 96, 0.1);
          box-shadow: 0 8px 18px rgba(22, 16, 11, 0.1);
          color: #fff6ea;
          backdrop-filter: blur(3px);
        }
        #eyeflow-debug-timer .eyeflow-debug-timer-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }
        #eyeflow-debug-timer .eyeflow-debug-timer-row + .eyeflow-debug-timer-row {
          margin-top: 6px;
          padding-top: 6px;
          border-top: 1px solid rgba(255, 246, 234, 0.08);
        }
        #eyeflow-debug-timer .eyeflow-debug-timer-label {
          font-size: 11px;
          line-height: 1.2;
          opacity: 0.66;
        }
        #eyeflow-debug-timer .eyeflow-debug-timer-value {
          font-size: 16px;
          font-weight: 700;
          letter-spacing: 0.02em;
          white-space: nowrap;
        }
      `;

      document.head.appendChild(style);
      document.body.appendChild(debugTimerElement);
    }

    const eyeValueElement = debugTimerElement.querySelector('[data-debug-timer="eye"]');
    const gentleValueElement = debugTimerElement.querySelector('[data-debug-timer="gentle"]');
    const waterValueElement = debugTimerElement.querySelector('[data-debug-timer="water"]');
    if (!eyeValueElement || !gentleValueElement || !waterValueElement) return;

    if (isDoomScrollContext()) {
      eyeValueElement.textContent = shouldCountActiveTime()
        ? formatCountdown(getMsUntilEyeBreak())
        : 'Paused';
    } else if (isWithinSinglePostGraceWindow()) {
      eyeValueElement.textContent = `Read ${formatCountdown(getSinglePostGraceRemainingMs())}`;
    } else {
      eyeValueElement.textContent = 'Off';
    }

    if (isDoomScrollContext()) {
      gentleValueElement.textContent = 'Off';
    } else if (debugTimerMeta.gentleState === 'off') {
      gentleValueElement.textContent = 'Off';
    } else if (debugTimerMeta.gentleState === 'paused' || debugTimerMeta.gentleState === 'hold') {
      const holdMs =
        debugTimerMeta.gentlePausedRemainingMs > 0
          ? debugTimerMeta.gentlePausedRemainingMs
          : Math.max(0, debugTimerMeta.nextGentleReminderAt - Date.now());
      gentleValueElement.textContent = `Hold ${formatCountdown(holdMs)}`;
    } else if (debugTimerMeta.nextGentleReminderAt > 0) {
      const gentleRemainingMs = Math.max(0, debugTimerMeta.nextGentleReminderAt - Date.now());
      gentleValueElement.textContent = formatCountdown(gentleRemainingMs);
    } else {
      gentleValueElement.textContent = 'Off';
    }

    if (debugTimerMeta.waterQueuedForNextBreak) {
      waterValueElement.textContent = 'Queued';
    } else if (debugTimerMeta.waterReminderPending) {
      waterValueElement.textContent = 'Pending';
    } else if (debugTimerMeta.nextWaterReminderAt > 0) {
      waterValueElement.textContent = formatReadableTimer(
        debugTimerMeta.nextWaterReminderAt - Date.now()
      );
    } else {
      waterValueElement.textContent = 'Waiting';
    }
  }

  function removeDebugTimerChip() {
    if (debugTimerElement) {
      debugTimerElement.remove();
      debugTimerElement = null;
    }
    const style = document.getElementById('eyeflow-debug-timer-style');
    if (style) style.remove();
  }

  function syncDebugTimerMeta(force = false) {
    const now = Date.now();
    if (!force && now - debugTimerMeta.lastFetchedAt < 1000) return;

    debugTimerMeta.lastFetchedAt = now;
    try {
      chrome.runtime.sendMessage({ type: 'GET_DEBUG_TIMERS' }, (response) => {
        if (runtimeCallbackFailed()) return;
        if (!response) return;
        debugTimerMeta.nextGentleReminderAt = response.nextGentleReminderAt || 0;
        debugTimerMeta.gentlePausedRemainingMs = response.gentlePausedRemainingMs || 0;
        debugTimerMeta.gentleState = response.gentleState || 'off';
        debugTimerMeta.gentlePauseReason = response.gentlePauseReason || 'none';
        debugTimerMeta.nextWaterReminderAt = response.nextWaterReminderAt || 0;
        debugTimerMeta.waterReminderPending = Boolean(response.waterReminderPending);
        debugTimerMeta.waterQueuedForNextBreak = Boolean(response.waterQueuedForNextBreak);
      });
    } catch (e) {
      // Ignore
    }
  }

  // -------------------------------------------------------
  // LISTEN FOR MESSAGES — From background.js
  // -------------------------------------------------------
  // Handle settings updates, snooze start/end, etc.
  /**
   * @function setupMessageListener
   * @description Configures event hooks parsing runtime message payloads from the service worker.
   *
   * @uses
   *   - chrome.runtime.onMessage.addListener(): Listens for incoming extension messages.
   */
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
          removeWarning();
        }

        // Snooze ended — resume tracking
        if (message.type === 'SNOOZE_ENDED') {
          isActive = Boolean(currentSettings?.enabled);
          syncSessionAndSharedTimer();
        }

        // Handle browser/OS idle transitions
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

        // Reset session timing metrics completely
        if (message.type === 'RESET_SESSION_TIMERS') {
          resetSessionTimersFromBackground(message.snapshot);
          sharedDsState.lastSyncedAt = Date.now();
        }

        // Display an immediate eye break bypass
        if (message.type === 'SHOW_EYE_BREAK_NOW') {
          removeGentleReminder();
          removeWarning();
          if (typeof EyeFlowOverlay !== 'undefined') {
            lastBreakOverlayShownAt = Date.now();
            EyeFlowOverlay.show(
              currentSettings || {},
              getHostname(),
              Math.round(getActiveSiteMs() / 60000),
              { hydrationPrompt: false }
            );
          }
          sendResponse({ success: true });
          return true;
        }

        // Trigger gentle reminders
        if (message.type === 'SHOW_GENTLE_REMINDER') {
          if (showGentleReminder(message)) {
            acknowledgeLocalGentleReminder();
          }
        }

        // Trigger water check-in gentle reminders
        if (message.type === 'SHOW_WATER_GENTLE_REMINDER') {
          showGentleReminder({
            title: 'Water check-in',
            text: 'Take a few sips of water when you get a moment.',
          });
        }

        // Display full hydration interruption
        if (message.type === 'SHOW_HYDRATION_POPUP') {
          tryShowHydrationPopup();
        }

        // Defer hydration popups to append alongside subsequent eye break overlay mounts
        if (message.type === 'QUEUE_HYDRATION_FOR_NEXT_BREAK') {
          hydrationMergedIntoNextBreak = true;
          pendingHydrationPopup = false;
        }

        // Let background query if gentle reminder toasts can render safely in this tab context
        if (message.type === 'CAN_SHOW_GENTLE_REMINDER') {
          sendResponse({ allow: canShowGentleReminderWithPassiveVideoSupport() });
          return true;
        }

        // Query active state contexts for debugging/verification scripts
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
      // Ignore
    }
  }

  // -------------------------------------------------------
  // INITIALIZE — Set everything up when page loads
  // -------------------------------------------------------
  /**
   * @function init
   * @description Bootstraps click/scroll listeners, registers page load logs,
   * queries current storage states, and starts timer tick pollers.
   */
  function init() {
    try {
      chrome.runtime.sendMessage({
        type: 'ADD_AUDIT_LOG',
        event: 'Page Load',
        details: `Loaded ${window.location.hostname}${window.location.pathname} (visible: ${!document.hidden}, focused: ${document.hasFocus()})`,
      });
    } catch (_) {}

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

    // Attach scroll and gesture activity trackers. Passive listeners optimize frames-per-second
    window.addEventListener('scroll', handleScroll, { passive: true });
    document.addEventListener('scroll', handleScroll, { passive: true, capture: true });
    document.addEventListener('wheel', handleScroll, { passive: true, capture: true });
    document.addEventListener('touchmove', handleScroll, { passive: true, capture: true });
    document.addEventListener('click', handleInteraction, { passive: true, capture: true });
    document.addEventListener('pointerup', handleInteraction, { passive: true, capture: true });
    document.addEventListener('keydown', handleInteraction, { passive: true, capture: true });

    // Visibility state changes (minimize tab/switch focus)
    document.addEventListener(
      'visibilitychange',
      () => {
        if (document.hidden) {
          flushDsSiteTime();
        } else {
          recordActivity();
        }
        syncSessionAndSharedTimer();
        syncDebugTimerMeta();
      },
      { passive: true }
    );
    window.addEventListener(
      'focus',
      () => {
        recordActivity();
        syncSessionAndSharedTimer();
        syncDebugTimerMeta();
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

    // Page unload hooks
    window.addEventListener('pagehide', flushDsSiteTime, { passive: true });
    window.addEventListener('beforeunload', flushDsSiteTime, { passive: true });

    // Guided break overlay feedback responders
    window.addEventListener('eyeflow-break-flow-closed', resetBreakCycle, { passive: true });
    window.addEventListener('eyeflow-hydration-completed', resetHydrationTimer, { passive: true });
    window.addEventListener(
      'eyeflow-hydration-remind-soon',
      () => {
        hydrationMergedIntoNextBreak = false;
        pendingHydrationPopup = false;
        try {
          chrome.runtime.sendMessage({ type: 'HYDRATION_REMIND_SOON' });
        } catch (e) {
          // Ignore
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

    // Start polling loops
    scrollCheckInterval = setInterval(checkForDoomScroll, SCROLL_CHECK_INTERVAL_MS);
    if (EYEFLOW_DEBUG_CONTENT) {
      debugTimerInterval = setInterval(updateDebugTimerChip, 1000);
      updateDebugTimerChip();
    }

    startTimeTracking();
    setupMessageListener();
  }

  // Self-start initializing content logic
  init();

  // -------------------------------------------------------
  // PUBLIC API
  // -------------------------------------------------------
  return {
    getHostname,
    removeWarning,
  };
})();
