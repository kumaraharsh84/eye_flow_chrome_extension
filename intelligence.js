// ============================================================
// INTELLIGENCE.JS - EyeFlow Pattern Learning & Smart Detection
// ============================================================
// This file is the "smart brain" of the extension. It does 3 things:
//
// 1. PATTERN LEARNING: Remembers when you doom scroll most
//    (e.g., "Sundays at 11pm") and warns you proactively.
//
// 2. SITE SENSITIVITY: Different sites get different strictness
//    levels (Instagram = strict, LinkedIn = relaxed).
//
// 3. GRADUAL INTERRUPTION: Instead of immediately going fullscreen,
//    it starts with a small nudge, then a warning, then the full break.
//
// This file exposes the EyeFlowIntelligence object, which is used
// by content.js to decide what to do.
// ============================================================

const EYEFLOW_DEBUG_INTELLIGENCE = false;

// -------------------------------------------------------
// EYEFLOW INTELLIGENCE - Main intelligence object
// -------------------------------------------------------
const EyeFlowIntelligence = (() => {
  // --- Internal state ---
  let currentBreakTargetMs = 0; // Active watch time required before the next eye break
  let lastReminderAt = 0; // Timestamp of the latest recurring reminder
  let cachedSettings = null; // Cached settings from background.js
  let lastTypingTime = 0;

  // -------------------------------------------------------
  // GET SITE TIER - Determine sensitivity level for a site
  // -------------------------------------------------------
  // Returns 'strict', 'moderate', or 'relaxed' based on the
  // current site. Strict sites trigger faster.
  function getCurrentContextKeys(hostname) {
    const cleanHost = hostname.replace(/^www\./, '');
    const path = window.location.pathname || '';
    const keys = [];

    if (cleanHost.includes('youtube.com') && path.startsWith('/shorts')) {
      keys.push('youtube.com/shorts');
    }

    keys.push(hostname);
    if (cleanHost !== hostname) {
      keys.push(cleanHost);
    }

    return keys;
  }

  function getSiteTier(hostname) {
    const contextKeys = getCurrentContextKeys(hostname);

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
  function getScrollThreshold(hostname) {
    const tier = getSiteTier(hostname);
    const sensitivity = cachedSettings ? cachedSettings.sensitivity : 50;

    const baseThresholds = {
      strict: 8,
      moderate: 15,
      relaxed: 25
    };

    const base = baseThresholds[tier] || 15;
    const multiplier = 1.5 - (sensitivity / 100);

    return Math.round(base * multiplier);
  }

  // -------------------------------------------------------
  // GET TIME WINDOW - How long to track scrolls (in ms)
  // -------------------------------------------------------
  function getTimeWindow(hostname) {
    const tier = getSiteTier(hostname);

    const windows = {
      strict: 10000,
      moderate: 15000,
      relaxed: 20000
    };

    return windows[tier] || 15000;
  }

  // -------------------------------------------------------
  // DETERMINE STAGE - What stage of interruption should we show?
  // -------------------------------------------------------
  function determineStage(activeSessionMs = 0) {
    const now = Date.now();

    if (!currentBreakTargetMs) {
      currentBreakTargetMs = getNextBreakTargetMs();
    }

    if (activeSessionMs < currentBreakTargetMs) {
      return 'none';
    }

    if (!lastReminderAt || (now - lastReminderAt) >= 60 * 1000) {
      return 'warning';
    }

    return 'none';
  }

  function getMsUntilBreak(activeSessionMs = 0) {
    if (!currentBreakTargetMs) {
      currentBreakTargetMs = getNextBreakTargetMs();
    }

    return Math.max(0, currentBreakTargetMs - activeSessionMs);
  }

  // -------------------------------------------------------
  // RESET STAGES - Reset the interruption stages
  // -------------------------------------------------------
  function resetStages() {
    lastReminderAt = 0;
    currentBreakTargetMs = getNextBreakTargetMs();
  }

  function recordBreakCompleted() {
    lastReminderAt = Date.now();
    currentBreakTargetMs = getNextBreakTargetMs();
  }

  function pauseForInactivity(inactiveMs) {
    if (!inactiveMs || inactiveMs <= 0) return;
  }

  function markReminderShown() {
    lastReminderAt = Date.now();
  }

  function getNextBreakTargetMs() {
    const minMinutes = (cachedSettings && cachedSettings.reminderIntervalMin) || 5;
    const maxMinutes = Math.max(
      minMinutes,
      (cachedSettings && cachedSettings.reminderIntervalMax) || minMinutes
    );
    return getRandomInt(minMinutes, maxMinutes) * 60 * 1000;
  }

  function getRandomInt(min, max) {
    const low = Math.ceil(min);
    const high = Math.floor(max);
    return Math.floor(Math.random() * (high - low + 1)) + low;
  }

  // -------------------------------------------------------
  // CHECK PROACTIVE WARNING - Placeholder for future risk-based timing
  // -------------------------------------------------------
  // This is intentionally not implemented yet. It exists as a stub so
  // the API is available for later proactive warning work.
  async function checkProactiveWarning() {
    return null;
  }

  // -------------------------------------------------------
  // IS SINGLE VIDEO PAGE - Detect if user is watching ONE video
  // -------------------------------------------------------
  function isSingleVideoPage() {
    const url = window.location.href;
    const hostname = window.location.hostname;

    if (hostname.includes('youtube.com') && url.includes('/watch')) {
      return true;
    }

    if (hostname.includes('vimeo.com') && /\/\d+/.test(window.location.pathname)) {
      return true;
    }

    if (hostname.includes('netflix.com') && url.includes('/watch')) {
      return true;
    }

    return false;
  }

  // -------------------------------------------------------
  // IS USER WORKING - Detect if user is typing/interacting
  // -------------------------------------------------------
  function trackTyping() {
    document.addEventListener('keydown', () => {
      lastTypingTime = Date.now();
    }, { passive: true });
  }

  function isUserTyping() {
    return (Date.now() - lastTypingTime) < 30000;
  }

  // -------------------------------------------------------
  // UPDATE SETTINGS - Cache settings from background.js
  // -------------------------------------------------------
  function updateSettings(settings) {
    cachedSettings = settings;
    if (!currentBreakTargetMs) {
      currentBreakTargetMs = getNextBreakTargetMs();
    }
  }

  // -------------------------------------------------------
  // INITIALIZE - Set up the intelligence layer
  // -------------------------------------------------------
  function init() {
    trackTyping();

    try {
      chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (settings) => {
        if (settings) cachedSettings = settings;
      });
    } catch (e) {
      // Ignore if extension context is invalid
    }
  }

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
    resetStages,
    recordBreakCompleted,
    pauseForInactivity,
    markReminderShown,
    checkProactiveWarning,
    isSingleVideoPage,
    isUserTyping,
    updateSettings
  };
})();
