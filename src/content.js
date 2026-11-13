/**
 * @file content.js
 * @description Content script: doom-scroll detection and in-page reminders.
 *
 * On every page it can answer the service worker's requests to show a gentle
 * reminder, a water break or a manual eye break. It does nothing else there:
 * no timers, no scroll listeners, no messages on page load.
 *
 * On the tracked social sites it additionally:
 *   1. Works out whether the current route is a doom-scroll (DS) surface.
 *   2. Watches for presence (scroll, taps, navigation keys, playing video).
 *   3. Sends a heartbeat to the service worker while the user is actively
 *      doom scrolling, which drives the shared break timer.
 *   4. Shows the eye-break overlay when that timer runs out.
 *
 * The service worker (background.js) owns all persistent state.
 */

import { EyeFlowOverlay } from './overlay.js';
import { GENTLE_REMINDER_DUPLICATE_GUARD_MS } from './utils.js';

(() => {
  // -------------------------------------------------------
  // CONSTANTS
  // -------------------------------------------------------

  // Sites with doom-scroll surfaces. Must mirror TRACKED_TAB_PATTERNS in background.js.
  const TRACKED_HOSTS = new Set([
    'instagram.com',
    'youtube.com',
    'reddit.com',
    'facebook.com',
    'x.com',
    'twitter.com',
    'tiktok.com',
    'snapchat.com',
    'linkedin.com',
    'twitch.tv',
  ]);

  // Sites where the eye break cannot be skipped. YouTube Shorts is added by route.
  const STRICT_BREAK_HOSTS = new Set([
    'instagram.com',
    'tiktok.com',
    'reddit.com',
    'facebook.com',
    'twitter.com',
    'x.com',
  ]);

  const SITE_LABELS = {
    'instagram.com': 'Instagram',
    'youtube.com': 'YouTube Shorts',
    'reddit.com': 'Reddit',
    'facebook.com': 'Facebook',
    'x.com': 'X',
    'twitter.com': 'X',
    'tiktok.com': 'TikTok',
    'snapchat.com': 'Snapchat',
    'linkedin.com': 'LinkedIn',
    'twitch.tv': 'Twitch',
  };

  // Hostnames where a reminder would interrupt real work (payments, exams,
  // sign-in, documents, meetings). Distinctive words match anywhere in the
  // hostname; short or ambiguous ones must be a whole label, so "pay.google.com"
  // matches "pay" but "example.org" does not match "exam" and "pinterest.com"
  // does not match "test".
  const SENSITIVE_HOST_FRAGMENTS = [
    'bank',
    'paypal',
    'razorpay',
    'stripe',
    'billing',
    'checkout',
    'wallet',
    'proctor',
    'assessment',
    'signin',
    'login',
    'notion',
    'figma',
    'canva',
  ];
  const SENSITIVE_HOST_LABELS = new Set([
    'pay',
    'payments',
    'exam',
    'exams',
    'quiz',
    'test',
    'auth',
    'accounts',
    'verify',
    'otp',
    'docs',
    'sheets',
    'slides',
    'miro',
    'zoom',
    'meet',
    'teams',
  ]);

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
    'assessment',
    'proctor',
  ];

  // Whole sites that are conversations; reminders stay away from them.
  const CHAT_APP_HOSTS = [
    'messenger.com',
    'discord.com',
    'web.whatsapp.com',
    'web.telegram.org',
    'web.snapchat.com',
  ];

  const AUTH_PATH_TOKENS = [
    'login',
    'signin',
    'signup',
    'auth',
    'verify',
    'verification',
    'checkpoint',
    'forgot',
    'reset',
  ];

  // Keys that count as "still browsing the feed".
  const NAVIGATION_KEYS = new Set([
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

  const TICK_INTERVAL_MS = 2000; // Heartbeat and break check
  const PRESENCE_WINDOW_MS = 35 * 1000; // No input for this long = not actively scrolling
  const TYPING_WINDOW_MS = 30 * 1000;
  const SCROLL_THROTTLE_MS = 250;
  const CONTEXT_CACHE_MS = 1000;
  const SINGLE_POST_GRACE_MS = 60 * 1000; // Reading one post is not doom scrolling
  const BREAK_DUPLICATE_GUARD_MS = 60 * 1000;
  const BREAK_REQUEST_RETRY_MS = 5000;
  const SITE_TIME_REPORT_INTERVAL_MS = 60 * 1000;
  const LONG_GAP_RESET_MS = 15 * 60 * 1000;
  const GENTLE_REMINDER_VISIBLE_MS = 6000;

  const HOSTNAME = window.location.hostname.replace(/^(www|m)\./, '');
  const IS_TRACKED_HOST = TRACKED_HOSTS.has(HOSTNAME);

  // -------------------------------------------------------
  // STATE
  // -------------------------------------------------------

  let isEnabled = true;
  let currentSettings = null;
  let isSystemIdle = false;
  let tickTimer = null;
  const listenerController = new AbortController();

  let lastMeaningfulInputAt = Date.now();
  let lastScrollSignalAt = 0;
  let lastTypingAt = 0;

  let lastKnownUrl = window.location.href;
  let lastContextKey = '';
  let contextCache = { href: '', at: 0, key: '' };
  let singlePostGraceKey = '';
  let singlePostGraceStartedAt = 0;

  // Active time on this site in this tab (for stats and the post-break card)
  let activeSiteMs = 0;
  let activeSessionStartedAt = 0;
  let lastReportedActiveSiteMs = 0;
  let activeSiteLabel = SITE_LABELS[HOSTNAME] || HOSTNAME;
  let lastSiteTimeFlushAt = Date.now();

  // Local mirror of the shared break timer owned by the service worker
  let sharedDs = { activeMs: 0, nextBreakTargetMs: 0, lastSyncedAt: 0 };
  let syncInFlight = false;
  let lastSentIsActive = false;
  let breakRequestInFlight = false;
  let lastBreakRequestAt = 0;
  let lastBreakOverlayShownAt = 0;

  let gentleReminderElement = null;
  let gentleReminderTimer = null;
  let lastGentleReminderShownAt = 0;

  // -------------------------------------------------------
  // MESSAGING
  // -------------------------------------------------------

  /**
   * Sends a message to the service worker. The callback receives null when the
   * worker could not be reached. If the extension was reloaded or updated, this
   * orphaned script shuts itself down.
   */
  function sendMessage(message, callback) {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        const failed = Boolean(chrome.runtime.lastError);
        if (callback) callback(failed ? null : (response ?? null));
      });
    } catch (error) {
      shutdown();
      if (callback) callback(null);
    }
  }

  function shutdown() {
    clearInterval(tickTimer);
    tickTimer = null;
    listenerController.abort();
    removeGentleReminder();
  }

  // -------------------------------------------------------
  // DOOM-SCROLL SURFACE DETECTION
  // -------------------------------------------------------

  /**
   * Returns a key such as "instagram.com/reels" when the current route is a
   * doom-scroll surface, or an empty string when it is not. The result is
   * cached briefly because several checks per tick ask for it.
   */
  function getDoomScrollContextKey() {
    if (!IS_TRACKED_HOST) return '';

    const now = Date.now();
    const href = window.location.href;
    if (contextCache.href === href && now - contextCache.at < CONTEXT_CACHE_MS) {
      return contextCache.key;
    }

    let key = detectDoomSurfaceKey();
    if (key && isAuthOrVerificationSurface()) key = '';
    contextCache = { href, at: now, key };
    return key;
  }

  function detectDoomSurfaceKey() {
    switch (HOSTNAME) {
      case 'instagram.com':
        return getInstagramDoomSurfaceKey();
      case 'youtube.com':
        return getYouTubeDoomSurfaceKey();
      case 'reddit.com':
        return getRedditDoomSurfaceKey();
      case 'facebook.com':
        return getFacebookDoomSurfaceKey();
      case 'x.com':
      case 'twitter.com':
        return getXDoomSurfaceKey();
      case 'snapchat.com':
        return getSnapchatDoomSurfaceKey();
      case 'linkedin.com':
        return getLinkedInDoomSurfaceKey();
      case 'twitch.tv':
        return getTwitchDoomSurfaceKey();
      case 'tiktok.com':
        return (window.location.pathname || '').startsWith('/messages') ? '' : 'tiktok.com';
      default:
        return '';
    }
  }

  function getInstagramDoomSurfaceKey() {
    const path = window.location.pathname || '/';

    if (path.startsWith('/reels') || path.startsWith('/reel/')) {
      return 'instagram.com/reels';
    }

    if (path.startsWith('/p/')) {
      const reelViewerOpen = Boolean(
        document.querySelector(
          '[role="dialog"] video, [role="dialog"] article video, main [role="presentation"] video'
        )
      );
      return reelViewerOpen ? 'instagram.com/reels' : 'instagram.com/detail';
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

  function getYouTubeDoomSurfaceKey() {
    const path = window.location.pathname || '/';

    if (path.startsWith('/shorts')) {
      return 'youtube.com/shorts';
    }

    // A channel page counts only while its Shorts tab is the selected one.
    const shortsTabSelected = Boolean(
      document.querySelector(
        'yt-tab-shape[tab-title="Shorts"][selected], [role="tab"][aria-label*="Shorts" i][aria-selected="true"], [aria-selected="true"][tab-identifier="shorts"], [selected][tab-identifier="shorts"], .iron-selected[tab-identifier="shorts"]'
      )
    );
    if (!shortsTabSelected) return '';

    const shortsGridVisible = Boolean(
      document.querySelector(
        'ytd-rich-grid-renderer ytd-reel-item-renderer, ytd-reel-shelf-renderer, ytd-reel-video-renderer'
      )
    );
    return shortsGridVisible ? 'youtube.com/channel-shorts' : '';
  }

  function getRedditDoomSurfaceKey() {
    let path = (window.location.pathname || '/').toLowerCase();
    if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);

    if (path.startsWith('/explore')) return '';
    if (path.includes('/comments/')) return 'reddit.com/detail';
    if (path === '/' || path === '/best' || path === '/hot') return 'reddit.com/home';
    if (path === '/popular' || path.startsWith('/r/popular')) return 'reddit.com/popular';
    if (path === '/news' || path.startsWith('/r/news')) return '';
    if (/^\/r\/[^/]+$/.test(path)) return 'reddit.com/community';
    return '';
  }

  function getFacebookDoomSurfaceKey() {
    const path = (window.location.pathname || '/').toLowerCase();
    const search = (window.location.search || '').toLowerCase();

    if (path.startsWith('/messages') || path.startsWith('/messenger')) return '';
    if (path.includes('/posts/') || path.includes('/permalink/')) return 'facebook.com/detail';
    if (path.startsWith('/watch') || path.startsWith('/videos') || path.startsWith('/reel')) {
      return 'facebook.com/video';
    }
    if (path.startsWith('/groups')) return 'facebook.com/groups';
    if (search.includes('filter=all')) return 'facebook.com/feeds-all';
    if (search.includes('filter=groups')) return 'facebook.com/feeds-groups';
    if (search.includes('filter=pages')) return 'facebook.com/feeds-pages';
    if (
      search.includes('filter=favourites') ||
      search.includes('filter=favorites') ||
      search.includes('filter=friends')
    ) {
      return '';
    }
    if (path === '/' || path === '') return 'facebook.com/home';
    return '';
  }

  function getXDoomSurfaceKey() {
    const path = (window.location.pathname || '/').toLowerCase();
    const quietPaths = [
      '/messages',
      '/notifications',
      '/settings',
      '/compose',
      '/premium',
      '/grok',
      '/i/connect_people',
      '/i/connect_tab',
      '/i/following',
      '/i/premium',
      '/i/grok',
      '/i/verified-orgs-signup',
      '/i/spaces',
      '/i/creators/studio',
      '/i/business',
    ];
    if (quietPaths.some((prefix) => path.startsWith(prefix))) return '';

    if (path.startsWith('/home')) return 'x.com/home';
    if (path.startsWith('/explore')) return 'x.com/explore';
    if (
      path.startsWith('/i/communities') ||
      path.startsWith('/communities') ||
      /^\/[^/]+\/communities(\/|$)/.test(path)
    ) {
      return 'x.com/communities';
    }
    if (path.includes('/status/')) return 'x.com/detail';
    if (/^\/[^/]+\/(likes|media)\/?$/.test(path)) return 'x.com/profile-feed';
    return '';
  }

  function getSnapchatDoomSurfaceKey() {
    const path = (window.location.pathname || '/').toLowerCase();

    // snapchat.com/ itself is a marketing and sign-in page, not a feed.
    if (path.startsWith('/spotlight') || path.includes('/spotlight/')) {
      return 'snapchat.com/spotlight';
    }
    if (path.startsWith('/stories') || path.startsWith('/discover')) {
      return 'snapchat.com/feed';
    }
    return '';
  }

  function getLinkedInDoomSurfaceKey() {
    const path = (window.location.pathname || '/').toLowerCase();

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

    if (path.startsWith('/clip/')) return 'twitch.tv/detail';
    if (
      path.startsWith('/clips') ||
      (path.startsWith('/directory/game/') && path.includes('/clips')) ||
      (path.startsWith('/directory/all/tags/') && path.includes('/clips'))
    ) {
      return 'twitch.tv/feed';
    }
    return '';
  }

  /** Login, sign-up and verification screens never count as doom scrolling. */
  function isAuthOrVerificationSurface() {
    const path = `${window.location.pathname || ''} ${window.location.search || ''}`.toLowerCase();
    if (AUTH_PATH_TOKENS.some((token) => path.includes(token))) return true;

    return Boolean(
      document.querySelector(
        'input[type="password"], input[autocomplete="current-password"], input[autocomplete="username"], input[autocomplete="one-time-code"], input[name*="otp" i], input[name*="password" i], input[id*="password" i]'
      )
    );
  }

  function isSinglePostKey(contextKey) {
    return contextKey.endsWith('/detail');
  }

  /** A single post gets a one-minute reading window before it counts as scrolling. */
  function isWithinSinglePostGraceWindow(contextKey = getDoomScrollContextKey()) {
    return (
      isSinglePostKey(contextKey) &&
      singlePostGraceKey === contextKey &&
      Date.now() - singlePostGraceStartedAt < SINGLE_POST_GRACE_MS
    );
  }

  function isDoomScrollContext() {
    const contextKey = getDoomScrollContextKey();
    return Boolean(contextKey) && !isWithinSinglePostGraceWindow(contextKey);
  }

  /** Short-form video surfaces where watching without input is still doom scrolling. */
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
    if (!contextKey) return false;
    return STRICT_BREAK_HOSTS.has(HOSTNAME) || contextKey === 'youtube.com/shorts';
  }

  function getSiteLabel() {
    return SITE_LABELS[HOSTNAME] || HOSTNAME;
  }

  // -------------------------------------------------------
  // PRESENCE
  // -------------------------------------------------------

  function recordActivity() {
    lastMeaningfulInputAt = Date.now();
  }

  function hasRecentMeaningfulInput() {
    return Date.now() - lastMeaningfulInputAt <= PRESENCE_WINDOW_MS;
  }

  function isEditableElement(element) {
    if (!(element instanceof Element)) return false;
    if (element.isContentEditable || element.tagName === 'TEXTAREA') return true;
    if (element.tagName !== 'INPUT') return false;
    const type = (element.getAttribute('type') || 'text').toLowerCase();
    return !['checkbox', 'radio', 'range', 'button', 'submit', 'reset', 'file'].includes(type);
  }

  function isUserTyping() {
    return Date.now() - lastTypingAt < TYPING_WINDOW_MS;
  }

  function handleScroll(event) {
    const now = Date.now();
    if (now - lastScrollSignalAt < SCROLL_THROTTLE_MS) return;
    if (event.type === 'wheel' && Math.abs(event.deltaY || 0) <= 6) return;
    lastScrollSignalAt = now;
    lastMeaningfulInputAt = now;
  }

  function handleKeydown(event) {
    const target = event.composedPath ? event.composedPath()[0] : event.target;
    if (isEditableElement(target)) {
      lastTypingAt = Date.now();
      return;
    }
    if (IS_TRACKED_HOST && NAVIGATION_KEYS.has(event.key)) recordActivity();
  }

  /**
   * Finds a playing video that takes up a meaningful part of the viewport.
   * With requireLongDuration, clips of a minute or less are ignored.
   */
  function findPassiveVideoCandidate({ requireLongDuration = false } = {}) {
    const videos = document.querySelectorAll('video');
    if (videos.length === 0) return null;

    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    const viewportArea = viewportWidth * viewportHeight;
    const minimumVisibleArea = Math.max(160 * 160, Math.round(viewportArea * 0.06));
    const minimumVideoArea = Math.max(220 * 160, Math.round(viewportArea * 0.08));

    for (const video of videos) {
      if (video.paused || video.ended || video.readyState < 2) continue;
      if (requireLongDuration && !(Number(video.duration) > 60)) continue;

      const rect = video.getBoundingClientRect();
      if (rect.width < 180 || rect.height < 120) continue;
      if (rect.width * rect.height < minimumVideoArea) continue;

      const visibleWidth = Math.min(rect.right, viewportWidth) - Math.max(rect.left, 0);
      const visibleHeight = Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0);
      if (visibleWidth <= 0 || visibleHeight <= 0) continue;
      if (visibleWidth * visibleHeight >= minimumVisibleArea) return video;
    }
    return null;
  }

  function isWatchingLongVideo() {
    return Boolean(findPassiveVideoCandidate({ requireLongDuration: true }));
  }

  /** True while the user is actively doom scrolling in this tab right now. */
  function shouldCountActiveTime() {
    if (!isEnabled || document.hidden || EyeFlowOverlay.isShowing()) return false;
    if (!isDoomScrollContext()) return false;

    // With the system idle, only a long video still playing counts as presence.
    if (isSystemIdle) return isWatchingLongVideo();
    return hasRecentMeaningfulInput() || isPassiveViewerDoomContext() || isWatchingLongVideo();
  }

  // -------------------------------------------------------
  // SITE TIME (STATS)
  // -------------------------------------------------------

  /** Starts or stops the local active-time stopwatch to match reality. */
  function syncActiveSession(isActiveNow = shouldCountActiveTime()) {
    const now = Date.now();
    if (isActiveNow && !activeSessionStartedAt) {
      activeSessionStartedAt = now;
      activeSiteLabel = getSiteLabel();
    } else if (!isActiveNow && activeSessionStartedAt) {
      activeSiteMs += now - activeSessionStartedAt;
      activeSessionStartedAt = 0;
    }
  }

  function getActiveSiteMs() {
    return activeSiteMs + (activeSessionStartedAt ? Date.now() - activeSessionStartedAt : 0);
  }

  /** Reports whole minutes of active time that have not been reported yet. */
  function flushDsSiteTime() {
    lastSiteTimeFlushAt = Date.now();
    const minutes = Math.floor((getActiveSiteMs() - lastReportedActiveSiteMs) / 60000);
    if (minutes <= 0) return;

    lastReportedActiveSiteMs += minutes * 60000;
    sendMessage({ type: 'REPORT_DS_SITE_TIME', site: activeSiteLabel, minutes });
  }

  function resetLocalSession() {
    activeSiteMs = 0;
    activeSessionStartedAt = 0;
    lastReportedActiveSiteMs = 0;
  }

  // -------------------------------------------------------
  // SHARED BREAK TIMER
  // -------------------------------------------------------

  function applySharedDsState(snapshot) {
    if (!snapshot) return;
    sharedDs = {
      activeMs: Number(snapshot.activeMs) || 0,
      nextBreakTargetMs: Number(snapshot.nextBreakTargetMs) || 0,
      lastSyncedAt: Date.now(),
    };
    lastBreakOverlayShownAt = Math.max(
      lastBreakOverlayShownAt,
      Number(snapshot.lastBreakOverlayShownAt) || 0
    );
  }

  /** Break-cycle time including what accrued since the last heartbeat answer. */
  function getEstimatedBreakCycleMs(now = Date.now()) {
    if (!lastSentIsActive || !sharedDs.lastSyncedAt) return sharedDs.activeMs;
    return sharedDs.activeMs + Math.max(0, now - sharedDs.lastSyncedAt);
  }

  function getMsUntilEyeBreak() {
    if (!sharedDs.nextBreakTargetMs) return null;
    return Math.max(0, sharedDs.nextBreakTargetMs - getEstimatedBreakCycleMs());
  }

  /**
   * Heartbeat. Sent every tick while actively doom scrolling, and once more when
   * that stops, so idle tabs and normal pages never wake the service worker.
   */
  function syncSharedDsTimer({ force = false } = {}) {
    if (syncInFlight) return;

    const isActiveNow = shouldCountActiveTime();
    syncActiveSession(isActiveNow);
    if (!isActiveNow && !lastSentIsActive && !force) return;

    syncInFlight = true;
    lastSentIsActive = isActiveNow;
    sendMessage(
      {
        type: 'SYNC_SHARED_DS_STATE',
        isActive: isActiveNow,
        contextKey: isActiveNow ? getDoomScrollContextKey() : '',
        site: getSiteLabel(),
      },
      (snapshot) => {
        syncInFlight = false;
        applySharedDsState(snapshot);
      }
    );
  }

  function refreshSharedDsState() {
    sendMessage({ type: 'GET_SHARED_DS_STATE' }, applySharedDsState);
  }

  // -------------------------------------------------------
  // EYE BREAK
  // -------------------------------------------------------

  function maybeRequestEyeBreak(now) {
    if (!sharedDs.nextBreakTargetMs) return;
    if (getEstimatedBreakCycleMs(now) < sharedDs.nextBreakTargetMs) return;
    if (breakRequestInFlight || now - lastBreakRequestAt < BREAK_REQUEST_RETRY_MS) return;
    if (now - lastBreakOverlayShownAt < BREAK_DUPLICATE_GUARD_MS) return;

    breakRequestInFlight = true;
    lastBreakRequestAt = now;
    sendMessage({ type: 'DOOM_SCROLL_DETECTED', site: getSiteLabel() }, (response) => {
      breakRequestInFlight = false;
      if (response === null) {
        // The service worker did not answer; still give the user their break.
        showEyeBreak(currentSettings);
      } else if (response.action === 'INTERVENE') {
        showEyeBreak(response.settings, { hydrationPrompt: Boolean(response.hydrationPrompt) });
      }
      // IGNORE: the extension is off, or another tab showed a break moments ago.
    });
  }

  function showEyeBreak(settings, { hydrationPrompt = false, manual = false } = {}) {
    if (EyeFlowOverlay.isShowing()) return false;

    syncActiveSession(false);
    removeGentleReminder();
    lastBreakOverlayShownAt = Date.now();

    const site = getSiteLabel();
    let flowClosedSent = false;
    const reportFlowClosed = (completed) => {
      if (flowClosedSent) return;
      flowClosedSent = true;
      sendMessage({ type: 'EYE_BREAK_FLOW_CLOSED', completed }, () => {
        if (IS_TRACKED_HOST) refreshSharedDsState();
      });
    };

    const shown = EyeFlowOverlay.show(settings || currentSettings || {}, {
      site,
      timeOnSite: Math.round(getActiveSiteMs() / 60000),
      // A break the user asked for themselves can always be skipped.
      strict: !manual && isStrictBreakSite(),
      hydrationPrompt,
      onCompleted: () => sendMessage({ type: 'EYE_BREAK_COMPLETED' }),
      onMood: (mood) => sendMessage({ type: 'MOOD_RECORDED', mood, site }),
      onHydration: sendHydrationResult,
      onCloseTab: () => {
        flushDsSiteTime();
        reportFlowClosed(true);
        sendMessage({ type: 'CLOSE_TAB' });
      },
      onClosed: ({ completed } = {}) => {
        sharedDs.activeMs = 0;
        sharedDs.lastSyncedAt = Date.now();
        recordActivity();
        reportFlowClosed(Boolean(completed));
      },
    });

    // Tell the worker right away that scrolling stopped, instead of on the next tick.
    if (IS_TRACKED_HOST) syncSharedDsTimer();
    return shown;
  }

  // -------------------------------------------------------
  // WATER BREAK
  // -------------------------------------------------------

  function sendHydrationResult(result) {
    sendMessage({ type: result === 'done' ? 'HYDRATION_COMPLETED' : 'HYDRATION_REMIND_SOON' });
  }

  function showHydrationBreak(settings) {
    if (EyeFlowOverlay.isShowing() || document.hidden) return false;

    syncActiveSession(false);
    removeGentleReminder();
    const shown = EyeFlowOverlay.showHydration(settings || currentSettings || {}, {
      strict: isStrictBreakSite(),
      onHydration: sendHydrationResult,
      onClosed: recordActivity,
    });
    if (IS_TRACKED_HOST) syncSharedDsTimer();
    return shown;
  }

  // -------------------------------------------------------
  // GENTLE REMINDER
  // -------------------------------------------------------

  /** Pages where a reminder would get in the way of something that matters. */
  function isSensitiveReminderContext() {
    if (isEditableElement(document.activeElement) || isUserTyping()) return true;

    const host = window.location.hostname.toLowerCase();
    if (
      SENSITIVE_HOST_FRAGMENTS.some((fragment) => host.includes(fragment)) ||
      host.split(/[.-]/).some((label) => SENSITIVE_HOST_LABELS.has(label))
    ) {
      return true;
    }

    const path = `${window.location.pathname || ''} ${window.location.search || ''}`.toLowerCase();
    if (SENSITIVE_PATH_KEYWORDS.some((keyword) => path.includes(keyword))) return true;

    if (
      document.querySelector(
        'input[type="password"], input[autocomplete="one-time-code"], input[name*="otp" i], input[id*="otp" i]'
      )
    ) {
      return true;
    }

    if (path.includes('form') && document.querySelectorAll('input, textarea, select').length >= 6) {
      return true;
    }

    return Boolean(
      document.querySelector(
        '[data-meeting-title], [aria-label*="leave call" i], [aria-label*="end call" i], [aria-label*="hang up" i]'
      )
    );
  }

  /** Chats and calls: never interrupt a conversation. */
  function isCommunicationContext() {
    const host = window.location.hostname.toLowerCase();
    if (CHAT_APP_HOSTS.some((chatHost) => host === chatHost || host.endsWith(`.${chatHost}`))) {
      return true;
    }
    return /\/(direct|messages|messaging|inbox|chat)(\/|$)/.test(
      (window.location.pathname || '').toLowerCase()
    );
  }

  function canShowGentleReminder() {
    if (document.hidden || EyeFlowOverlay.isShowing()) return false;
    if (getDoomScrollContextKey()) return false; // DS surfaces get eye breaks instead
    if (isCommunicationContext() || isSensitiveReminderContext()) return false;
    return !isWatchingLongVideo();
  }

  function showGentleReminder({ variant = 'eyes', force = false } = {}) {
    if (!force && !canShowGentleReminder()) return false;
    if (Date.now() - lastGentleReminderShownAt < GENTLE_REMINDER_DUPLICATE_GUARD_MS) return false;

    removeGentleReminder();
    lastGentleReminderShownAt = Date.now();

    const isWater = variant === 'water';
    const title = document.createElement('div');
    title.className = 'eyeflow-gentle-reminder-title';
    title.textContent = isWater ? 'Water check-in' : 'Your eyes could use a moment';

    const text = document.createElement('div');
    text.className = 'eyeflow-gentle-reminder-text';
    text.textContent = isWater
      ? 'Take a few sips of water when you get a moment.'
      : 'Look at something far away for 20 seconds and blink a few times.';

    const content = document.createElement('div');
    content.className = 'eyeflow-gentle-reminder-content';
    content.append(title, text);

    gentleReminderElement = document.createElement('div');
    gentleReminderElement.id = 'eyeflow-gentle-reminder';
    gentleReminderElement.setAttribute('role', 'status');
    gentleReminderElement.appendChild(content);
    gentleReminderElement.addEventListener('click', removeGentleReminder);

    (document.body || document.documentElement).appendChild(gentleReminderElement);
    gentleReminderTimer = setTimeout(removeGentleReminder, GENTLE_REMINDER_VISIBLE_MS);
    return true;
  }

  function removeGentleReminder() {
    clearTimeout(gentleReminderTimer);
    gentleReminderTimer = null;
    if (gentleReminderElement) {
      gentleReminderElement.remove();
      gentleReminderElement = null;
    }
  }

  // -------------------------------------------------------
  // ROUTE CHANGES (single-page apps)
  // -------------------------------------------------------

  function syncRouteState() {
    const currentUrl = window.location.href;
    const contextKey = getDoomScrollContextKey();
    if (currentUrl === lastKnownUrl && contextKey === lastContextKey) return;

    lastKnownUrl = currentUrl;
    if (contextKey === lastContextKey) return;

    // Time so far belongs to the surface the user just left.
    flushDsSiteTime();

    if (isSinglePostKey(contextKey)) {
      singlePostGraceKey = contextKey;
      singlePostGraceStartedAt = Date.now();
    } else {
      singlePostGraceKey = '';
      singlePostGraceStartedAt = 0;
    }

    // Arriving on a feed is itself a sign of presence.
    if (contextKey && !lastContextKey) recordActivity();
    lastContextKey = contextKey;
  }

  // -------------------------------------------------------
  // MAIN LOOP (tracked sites only)
  // -------------------------------------------------------

  function tick() {
    if (!chrome.runtime?.id) {
      shutdown(); // The extension was reloaded or removed
      return;
    }
    if (document.hidden) return; // visibilitychange already reported this tab as inactive

    const now = Date.now();
    syncRouteState();

    // Long away from this tab: the "time on site" shown after a break starts over.
    if (!activeSessionStartedAt && now - lastMeaningfulInputAt >= LONG_GAP_RESET_MS) {
      flushDsSiteTime();
      resetLocalSession();
    }

    syncSharedDsTimer();

    if (now - lastSiteTimeFlushAt >= SITE_TIME_REPORT_INTERVAL_MS) flushDsSiteTime();

    if (isEnabled && !EyeFlowOverlay.isShowing() && isDoomScrollContext()) {
      maybeRequestEyeBreak(now);
    }
  }

  function startTracking() {
    const options = { passive: true, capture: true, signal: listenerController.signal };
    document.addEventListener('scroll', handleScroll, options);
    document.addEventListener('wheel', handleScroll, options);
    document.addEventListener('touchmove', handleScroll, options);
    document.addEventListener('pointerdown', recordActivity, options);

    document.addEventListener(
      'visibilitychange',
      () => {
        if (document.hidden) {
          flushDsSiteTime();
          syncSharedDsTimer();
        } else {
          recordActivity();
          tick();
        }
      },
      { signal: listenerController.signal }
    );

    window.addEventListener(
      'pagehide',
      () => {
        syncActiveSession(false);
        flushDsSiteTime();
        if (lastSentIsActive) {
          lastSentIsActive = false;
          sendMessage({ type: 'SYNC_SHARED_DS_STATE', isActive: false });
        }
      },
      { signal: listenerController.signal }
    );

    lastContextKey = getDoomScrollContextKey();
    if (isSinglePostKey(lastContextKey)) {
      singlePostGraceKey = lastContextKey;
      singlePostGraceStartedAt = Date.now();
    }

    // One round trip for settings, the shared timer and the idle state. The forced
    // heartbeat that follows lets the worker notice this tab navigated off a feed.
    sendMessage({ type: 'GET_CONTENT_BOOTSTRAP' }, (bootstrap) => {
      if (bootstrap) {
        currentSettings = bootstrap.settings || null;
        isEnabled = Boolean(bootstrap.settings?.enabled);
        isSystemIdle = Boolean(bootstrap.idleState) && bootstrap.idleState !== 'active';
        applySharedDsState(bootstrap.sharedDs);
      }
      syncSharedDsTimer({ force: true });
    });

    tickTimer = setInterval(tick, TICK_INTERVAL_MS);
  }

  // -------------------------------------------------------
  // MESSAGES FROM THE SERVICE WORKER
  // -------------------------------------------------------

  function handleMessage(message, sender, sendResponse) {
    switch (message?.type) {
      case 'SETTINGS_UPDATED':
        currentSettings = message.settings || null;
        isEnabled = Boolean(message.settings?.enabled);
        if (!isEnabled) removeGentleReminder();
        if (IS_TRACKED_HOST) syncSharedDsTimer();
        break;

      case 'SYSTEM_IDLE_STATE_CHANGED':
        isSystemIdle = message.state !== 'active';
        if (IS_TRACKED_HOST) syncSharedDsTimer();
        break;

      case 'RESET_SESSION_TIMERS':
        flushDsSiteTime();
        resetLocalSession();
        lastSentIsActive = false;
        applySharedDsState(message.snapshot);
        removeGentleReminder();
        break;

      case 'SHOW_EYE_BREAK_NOW':
        sendResponse({ success: showEyeBreak(message.settings, { manual: true }) });
        break;

      case 'SHOW_GENTLE_REMINDER':
        sendResponse({
          shown: showGentleReminder({ variant: message.variant, force: Boolean(message.force) }),
        });
        break;

      case 'SHOW_HYDRATION_POPUP':
        sendResponse({ accepted: showHydrationBreak(message.settings) });
        break;

      case 'GET_PAGE_REMINDER_CONTEXT':
        sendResponse({
          isDoomScrollContext: isDoomScrollContext(),
          msUntilEyeBreak: getMsUntilEyeBreak(),
          canShowGentleReminder: canShowGentleReminder(),
          hasPassiveVideoPresence: isWatchingLongVideo(),
        });
        break;

      default:
        break;
    }
    return false; // Every response above is sent synchronously
  }

  // -------------------------------------------------------
  // INIT
  // -------------------------------------------------------

  try {
    chrome.runtime.onMessage.addListener(handleMessage);
  } catch (error) {
    return; // Extension context already gone
  }

  document.addEventListener('keydown', handleKeydown, {
    passive: true,
    capture: true,
    signal: listenerController.signal,
  });

  if (IS_TRACKED_HOST) startTracking();
})();
