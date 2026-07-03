/**
 * @file intelligence.js
 * @description EyeFlow Detection & Smart Timing Heuristics.
 *
 * @purpose
 * This file is the heuristic "brain" of the extension that runs in the context
 * of doom-scrolling webpages. Its primary responsibilities are:
 *   1. Categorizing site strictness tiers (strict, moderate, relaxed).
 *   2. Computing dynamic, randomized countdown targets adjusted by the user's sensitivity setting.
 *   3. Detecting passive video viewing (Netflix, YouTube full-length videos) so we do not interrupt movie watching.
 *   4. Detecting active typing to avoid blocking forms, messages, or search boxes mid-keystroke.
 *
 * @project-fit
 *   - Bundled and injected as a content script dependency.
 *   - Exposes a unified singleton API `EyeFlowIntelligence` utilized primarily by `content.js`
 *     to calculate when to trigger nudges, warnings, or screen-blocking breaks.
 */

// ============================================================
// INTELLIGENCE.JS - EyeFlow Detection & Smart Timing
// ============================================================
// This file is the "smart brain" of the extension. It does 2 things:
//
// 1. SITE SENSITIVITY: Different sites get different strictness
//    levels for scroll density detection (Instagram = strict, etc).
//
// 2. GRADUAL INTERRUPTION: Instead of immediately going fullscreen,
//    it tracks interruption stages (nudge -> warning -> break).
//
// This file exposes the EyeFlowIntelligence object, which is used
// by content.js to decide what to do.
// ============================================================

// -------------------------------------------------------
// EYEFLOW INTELLIGENCE - Main intelligence object
// -------------------------------------------------------
/**
 * @namespace EyeFlowIntelligence
 * @description IIFE (Immediately Invoked Function Expression) that returns a singleton object
 * managing state and heuristics for site strictness, typing status, and break calculation.
 */
export const EyeFlowIntelligence = (() => {
  // --- Internal state ---

  // The dynamically calculated active browsing duration (in milliseconds) required to trigger the next eye break.
  let currentBreakTargetMs = 0;

  // Timestamp when the last break warning nudge or break overlay was shown. Used to throttle alerts.
  let lastReminderAt = 0;

  // Locally cached copy of user preferences synced from Chrome Storage via background.js.
  let cachedSettings = null;

  // Timestamp of the user's last keyboard keydown event.
  let lastTypingTime = 0;

  // -------------------------------------------------------
  // GET SITE TIER - Determine sensitivity level for a site
  // -------------------------------------------------------
  // Returns 'strict', 'moderate', or 'relaxed' based on the
  // current site. Strict sites trigger faster.

  /**
   * @function getCurrentContextKeys
   * @description Extract potential match keys for the current hostname and path.
   * This allows matching general domains (e.g. youtube.com) as well as specific paths (e.g. youtube.com/shorts).
   *
   * @param {string} hostname - The hostname of the current window (e.g. "www.youtube.com").
   * @returns {string[]} An array of strings representing context matches to test against settings.
   */
  function getCurrentContextKeys(hostname) {
    // Strip "www." prefix to normalize comparisons (e.g. "www.instagram.com" -> "instagram.com")
    const cleanHost = hostname.replace(/^www\./, '');
    const path = window.location.pathname || '';
    const keys = [];

    // Specific sub-paths like YouTube Shorts trigger higher scroll strictness than regular YouTube
    if (cleanHost.includes('youtube.com') && path.startsWith('/shorts')) {
      keys.push('youtube.com/shorts');
    }

    keys.push(hostname);
    if (cleanHost !== hostname) {
      keys.push(cleanHost);
    }

    return keys;
  }

  /**
   * @function getSiteTier
   * @description Determines the configured strictness level ('strict', 'moderate', or 'relaxed')
   * for the current site.
   *
   * @param {string} hostname - The current page's hostname.
   * @returns {string} The tier name ('strict', 'moderate', or 'relaxed'). Default is 'moderate'.
   *
   * @called-by
   *   - getScrollThreshold()
   *   - getTimeWindow()
   */
  function getSiteTier(hostname) {
    const contextKeys = getCurrentContextKeys(hostname);

    // Check if the user settings contain override definitions for these sites
    if (cachedSettings && cachedSettings.siteTiers) {
      for (const key of contextKeys) {
        if (cachedSettings.siteTiers[key]) {
          return cachedSettings.siteTiers[key];
        }
      }
    }

    return 'moderate';
  }

  // -------------------------------------------------------
  // GET SCROLL THRESHOLD - How many scrolls before triggering
  // -------------------------------------------------------
  /**
   * @function getScrollThreshold
   * @description Calculates the scroll threshold limit based on the site's tier and user's sensitivity setting.
   * Note: This is preserved for API signature integrity but is no longer active in the time-only triggers.
   *
   * @param {string} hostname - Hostname of the page.
   * @returns {number} The calculated integer threshold.
   */
  function getScrollThreshold(hostname) {
    const tier = getSiteTier(hostname);
    const sensitivity = cachedSettings ? cachedSettings.sensitivity : 50;

    // Strict sites have lower scroll thresholds (easier to trigger), relaxed sites have higher
    const baseThresholds = {
      strict: cachedSettings?.scrollThresholdStrict ?? 20,
      moderate: cachedSettings?.scrollThresholdModerate ?? 30,
      relaxed: cachedSettings?.scrollThresholdRelaxed ?? 45,
    };

    const base = baseThresholds[tier] || 15;
    // Map sensitivity percentage (0-100) to a multiplier (1.5 down to 0.5)
    // Higher sensitivity = lower multiplier = lower threshold = faster triggers
    const multiplier = 1.5 - sensitivity / 100;

    return Math.round(base * multiplier);
  }

  // -------------------------------------------------------
  // GET TIME WINDOW - How long to track scrolls (in ms)
  // -------------------------------------------------------
  /**
   * @function getTimeWindow
   * @description Retrieves the duration window (in milliseconds) used for filtering scroll logs.
   *
   * @param {string} hostname - Hostname of the page.
   * @returns {number} The time window duration in milliseconds.
   */
  function getTimeWindow(hostname) {
    const tier = getSiteTier(hostname);

    const windows = {
      strict: 10000, // 10s window
      moderate: 15000, // 15s window
      relaxed: 20000, // 20s window
    };

    return windows[tier] || 15000;
  }

  // -------------------------------------------------------
  // DETERMINE STAGE - What stage of interruption should we show?
  // -------------------------------------------------------
  /**
   * @function determineStage
   * @description Evaluates current session duration against the break target to decide
   * if we should display an warning interruption overlay.
   *
   * @param {number} [activeSessionMs=0] - The accumulated active duration on doom-scroll sites in milliseconds.
   * @returns {string} The decision: 'warning' or 'none'.
   *
   * @called-by
   *   - checkForDoomScroll() in content.js
   */
  function determineStage(activeSessionMs = 0) {
    const now = Date.now();

    // Ensure we have a target threshold initialized
    if (!currentBreakTargetMs) {
      currentBreakTargetMs = getNextBreakTargetMs();
    }

    // User has not reached the time limit threshold yet
    if (activeSessionMs < currentBreakTargetMs) {
      return 'none';
    }

    // Throttle: avoid warning the user multiple times within the same 60-second window
    if (!lastReminderAt || now - lastReminderAt >= 60 * 1000) {
      return 'warning';
    }

    return 'none';
  }

  /**
   * @function getMsUntilBreak
   * @description Calculates remaining active milliseconds before a break is due.
   *
   * @param {number} [activeSessionMs=0] - Accumulated active milliseconds in the session.
   * @returns {number} Milliseconds remaining (always >= 0).
   */
  function getMsUntilBreak(activeSessionMs = 0) {
    if (!currentBreakTargetMs) {
      currentBreakTargetMs = getNextBreakTargetMs();
    }

    return Math.max(0, currentBreakTargetMs - activeSessionMs);
  }

  // -------------------------------------------------------
  // RESET STAGES - Reset the interruption stages
  // -------------------------------------------------------
  /**
   * @function resetStages
   * @description Resets the reminder timer and calculates a new random break target.
   *
   * @called-by
   *   - Content script on tab focus, manual skips, or reset events.
   */
  function resetStages() {
    lastReminderAt = 0;
    currentBreakTargetMs = getNextBreakTargetMs();
  }

  /**
   * @function recordBreakCompleted
   * @description Call this when the user successfully finishes their eye break.
   * Sets the warning cooldown and rolls a new countdown target.
   */
  function recordBreakCompleted() {
    lastReminderAt = Date.now();
    currentBreakTargetMs = getNextBreakTargetMs();
  }

  /**
   * @function pauseForInactivity
   * @description Postpones the next break target by adding the inactive duration to it.
   * This ensures that if the user steps away from their keyboard/mouse, they aren't
   * immediately greeted with a break screen upon returning.
   *
   * @param {number} inactiveMs - Inactive time duration in milliseconds.
   */
  function pauseForInactivity(inactiveMs) {
    if (!inactiveMs || inactiveMs <= 0) return;
    if (!currentBreakTargetMs) return;

    // Add the idle time to the target limit, capped at double the normal target to avoid infinite delays
    currentBreakTargetMs = Math.min(currentBreakTargetMs + inactiveMs, getNextBreakTargetMs() * 2);
  }

  /**
   * @function markReminderShown
   * @description Sets the last reminder timestamp to now, running the throttle timer.
   */
  function markReminderShown() {
    lastReminderAt = Date.now();
  }

  /**
   * @function getNextBreakTargetMs
   * @description Calculates a randomized break threshold interval within settings boundaries,
   * adjusted by the sensitivity multiplier.
   *
   * @returns {number} Target interval in milliseconds.
   *
   * @uses
   *   - getRandomInt(): Helper for randomization range.
   */
  function getNextBreakTargetMs() {
    const minMinutes = (cachedSettings && cachedSettings.reminderIntervalMin) || 5;
    const maxMinutes = Math.max(
      minMinutes,
      (cachedSettings && cachedSettings.reminderIntervalMax) || minMinutes
    );
    const sensitivity =
      cachedSettings && cachedSettings.sensitivity !== undefined ? cachedSettings.sensitivity : 50;

    // Map sensitivity to a speed multiplier:
    // Sensitivity = 100 -> multiplier = 0.5 (Timer expires 2x faster)
    // Sensitivity = 50  -> multiplier = 1.0 (Timer expires at standard speed)
    // Sensitivity = 0   -> multiplier = 1.5 (Timer expires 1.5x slower)
    const multiplier = 1.5 - sensitivity / 100;

    return Math.round(getRandomInt(minMinutes, maxMinutes) * 60 * 1000 * multiplier);
  }

  /**
   * @function getRandomInt
   * @description Standard random integer generator (inclusive bounds).
   *
   * @param {number} min - Lower bound.
   * @param {number} max - Upper bound.
   * @returns {number} Random integer.
   */
  function getRandomInt(min, max) {
    const low = Math.ceil(min);
    const high = Math.floor(max);
    return Math.floor(Math.random() * (high - low + 1)) + low;
  }

  // -------------------------------------------------------
  // IS SINGLE VIDEO PAGE - Detect if user is watching ONE video
  // -------------------------------------------------------
  /**
   * @function isSingleVideoPage
   * @description Analyzes document URL and hostname to identify if the page is currently
   * displaying a full-length media player (e.g. Netflix, YouTube video page).
   * In these contexts, we want to hold back aggressive screen blocks so we don't ruin
   * movie/video viewing experiences.
   *
   * @returns {boolean} True if on a full-length video playback page.
   *
   * @called-by
   *   - checkForDoomScroll() in content.js
   *
   * @uses
   *   - window.location.href: Browser's URL API.
   *   - RegExp: To test URL routing patterns.
   */
  function isSingleVideoPage() {
    const url = window.location.href;
    const hostname = window.location.hostname;

    // Standard YouTube watch pages (e.g. youtube.com/watch?v=...)
    if (hostname.includes('youtube.com') && url.includes('/watch')) {
      return true;
    }

    // Vimeo movie IDs (e.g. vimeo.com/123456789)
    if (hostname.includes('vimeo.com') && /\/\d+/.test(window.location.pathname)) {
      return true;
    }

    // Netflix player context
    if (hostname.includes('netflix.com') && url.includes('/watch')) {
      return true;
    }

    return false;
  }

  // -------------------------------------------------------
  // IS USER WORKING - Detect if user is typing/interacting
  // -------------------------------------------------------
  /**
   * @function trackTyping
   * @description Attaches keydown listener on the document level to log user keystrokes.
   * Uses a passive event listener for performance reasons (does not block browser scrolling/rendering).
   *
   * @uses
   *   - document.addEventListener(): Browser API for DOM events.
   */
  function trackTyping() {
    document.addEventListener(
      'keydown',
      () => {
        lastTypingTime = Date.now();
      },
      { passive: true }
    );
  }

  /**
   * @function isUserTyping
   * @description Checks if the user has pressed a key on their keyboard in the last 30 seconds.
   * Useful to determine if the user is engaged in active work (writing emails, coding) rather than doom-scrolling.
   *
   * @returns {boolean} True if typing activity occurred in the last 30s.
   *
   * @called-by
   *   - checkForDoomScroll() in content.js
   */
  function isUserTyping() {
    return Date.now() - lastTypingTime < 30000;
  }

  // -------------------------------------------------------
  // UPDATE SETTINGS - Cache settings from background.js
  // -------------------------------------------------------
  /**
   * @function updateSettings
   * @description Caches settings and generates a fresh countdown target.
   *
   * @param {Object} settings - Extension settings dictionary.
   */
  function updateSettings(settings) {
    cachedSettings = settings;
    if (!currentBreakTargetMs) {
      currentBreakTargetMs = getNextBreakTargetMs();
    }
  }

  // -------------------------------------------------------
  // INITIALIZE - Set up the intelligence layer
  // -------------------------------------------------------
  /**
   * @function init
   * @description Bootstraps keyboard event listeners and requests settings from storage
   * via background script communication.
   *
   * @uses
   *   - chrome.runtime.sendMessage(): Extension API to send messages to background.js.
   */
  function init() {
    trackTyping();

    try {
      chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (settings) => {
        if (settings) cachedSettings = settings;
      });
    } catch (e) {
      // Ignore errors when context is invalidated (e.g. extension updated/reloaded)
    }
  }

  // Self-execute initialization on load
  init();

  // -------------------------------------------------------
  // PUBLIC API - What content.js can use
  // -------------------------------------------------------
  return {
    getSiteTier,
    getScrollThreshold,
    getTimeWindow,
    determineStage,
    getMsUntilBreak,
    getNextBreakTargetMs,
    resetStages,
    recordBreakCompleted,
    pauseForInactivity,
    markReminderShown,

    isSingleVideoPage,
    isUserTyping,
    updateSettings,
  };
})();
