import { clampNumber } from './utils.js';

// ============================================================
// BACKGROUND.JS — EyeFlow Chrome Extension
// ============================================================
// This is the "brain" of the extension. It runs in the background
// and manages everything:
//   - Receiving doom-scroll alerts from content.js
//   - Managing timers (snooze, alarms)
//   - Storing/retrieving settings from Chrome storage
//   - Coordinating between popup.js and content.js
//   - Tracking stats (doom scrolls blocked, breaks taken, etc.)
// ============================================================

const EYEFLOW_DEBUG = false;

// -------------------------------------------------------
// DEFAULT SETTINGS
// -------------------------------------------------------
// These are the initial settings when the extension is first installed.
// The user can change them from the popup UI.
const DEFAULT_SETTINGS = {
  enabled: true, // Is the extension active?
  snoozedUntil: 0, // Timestamp when snooze ends (0 = not snoozed)
  sensitivity: 50, // Doom-scroll sensitivity (0-100). Higher = triggers faster
  eyeBreakDurationSec: 20, // How long the eye exercise lasts (seconds)
  hydrationBreakDurationSec: 40, // Hydration reset countdown duration
  reminderIntervalMin: 5, // Main eye reminder interval (in minutes)
  reminderIntervalMax: 5, // Main eye reminder interval (in minutes)
  hydrationReminderMin: 60, // Show a hydration reset after this much continuous time
  subtleReminderEnabled: true, // Show a soft corner reminder during normal work in Chrome
  subtleReminderMin: 25, // Soft reminder interval (in minutes)
  subtleReminderMax: 25, // Soft reminder interval (in minutes)
  timingMode: 'fixed', // fixed = exact intervals, surprise = random ranges
  customTimingEnabled: false, // Let advanced users override reminder timing from the popup
  soundReminderEnabled: false, // Keep background audio opt-in for a calmer first-run experience
  soundReminderMin: 20, // Minimum gap for the background sound reminder
  soundReminderMax: 30, // Maximum gap for the background sound reminder
  popupTheme: 'dark', // Popup theme preference: dark or light

  // Site-specific sensitivity tiers
  // "strict" = triggers faster, "moderate" = normal, "relaxed" = triggers slower
  siteTiers: {
    'instagram.com': 'strict',
    'tiktok.com': 'strict',
    'reddit.com': 'strict',
    'facebook.com': 'strict',
    'twitter.com': 'strict',
    'x.com': 'strict',
    'snapchat.com': 'strict',
    'twitch.tv': 'strict',
    'youtube.com': 'moderate',
    'youtube.com/shorts': 'strict',
    'linkedin.com': 'moderate',
    'stackoverflow.com': 'relaxed',
    'github.com': 'relaxed',
  },

  // User's custom redirect suggestions (what to do instead of scrolling)
  redirectSuggestions: [
    'Take a short walk',
    'Drink a glass of water',
    'Do a quick stretch',
    'Read a book for 5 min',
    'Step outside for fresh air',
  ],
};

// Keep redirect suggestions ASCII-clean even if the source file contains legacy encoding artifacts.
DEFAULT_SETTINGS.redirectSuggestions = [
  'Take a short walk',
  'Drink a glass of water',
  'Do a quick stretch',
  'Read a book for 5 min',
  'Step outside for fresh air',
];

// -------------------------------------------------------
// DEFAULT STATS (tracked data)
// -------------------------------------------------------
// These stats are saved in Chrome storage and updated as the user
// interacts with the extension. Displayed in the popup dashboard.
const DEFAULT_STATS = {
  totalDoomScrollsBlocked: 0, // Total interruptions ever
  totalEyeBreaksCompleted: 0, // Total eye exercises done
  todayDoomScrollsBlocked: 0, // Interruptions today
  todayEyeBreaksCompleted: 0, // Eye exercises today
  weekDoomScrollsBlocked: 0, // Interruptions this week
  weekEyeBreaksCompleted: 0, // Eye exercises this week
  lastBreakTime: 0, // Timestamp of last eye break
  lastResetDate: '', // The date when daily counters were last reset
  moodHistory: [], // Array of { mood, timestamp, site }
  doomScrollSessions: [], // Array of { site, day, hour, duration, scrollCount }
  siteTimeSpent: {}, // Legacy aggregate site-time bucket
  todayDsSiteTimeSpent: {}, // { 'Instagram': totalMinutes, ... } persisted across reload/restart, resets only on a new day
};

const DEFAULT_RUNTIME_STATE = {
  nextGentleReminderAt: 0,
  gentlePausedRemainingMs: 0,
  gentleState: 'off',
  gentlePauseReason: 'none',
  nextWaterReminderAt: 0,
  waterReminderPending: false,
  waterReminderPendingSince: 0,
  waterQueuedForNextBreak: false,
  nextSoundReminderAt: 0,
  lastPrimaryInterventionAt: 0,
  lastGentleReminderAt: 0,
  lastSoundReminderAt: 0,
  sharedDsActiveMs: 0,
  sharedDsNextBreakTargetMs: 0,
  sharedDsLastUpdateAt: 0,
  sharedDsActiveTabId: 0,
  sharedDsIsActive: false,
  sharedDsContextKey: '',
  sharedDsState: 'off',
  sharedDsPauseReason: 'none',
};

const GENTLE_TIMER_STATES = Object.freeze({
  OFF: 'off',
  RUNNING: 'running',
  PAUSED: 'paused',
  DUE: 'due',
});

const GENTLE_PAUSE_REASONS = Object.freeze({
  NONE: 'none',
  SNOOZE: 'snooze',
  DS_ACTIVE: 'ds_active',
  INACTIVE: 'inactive',
  NO_WINDOW: 'no_window',
  DISABLED: 'disabled',
  FEATURE_OFF: 'feature_off',
});

const SHARED_DS_TIMER_STATES = Object.freeze({
  OFF: 'off',
  RUNNING: 'running',
  PAUSED: 'paused',
});

const SHARED_DS_PAUSE_REASONS = Object.freeze({
  NONE: 'none',
  INACTIVE: 'inactive',
  SESSION_TIMEOUT: 'session_timeout',
  DISABLED: 'disabled',
  BREAK_FLOW: 'break_flow',
});

const GENTLE_REMINDER_DUPLICATE_GUARD_MS = 15 * 1000;
const SOUND_REMINDER_FOLLOWUP_MS = 10 * 60 * 1000;
const WATER_REMIND_SOON_DELAY_MS = 3 * 60 * 1000;
const WATER_PENDING_TIMEOUT_MS = 2 * 60 * 1000;
const SESSION_RESET_INACTIVITY_MS = 15 * 60 * 1000;
const TICK_ALARM_PERIOD_MINUTES = 0.5;
const IDLE_DETECTION_INTERVAL_SECONDS = 60;
const DOOM_SCROLL_HOSTS = new Set([
  'instagram.com',
  'tiktok.com',
  'reddit.com',
  'facebook.com',
  'twitter.com',
  'x.com',
]);

const TIMER_LIMITS = {
  doomReminderMin: { min: 5, max: 30, fallback: DEFAULT_SETTINGS.reminderIntervalMin },
  doomReminderMax: { min: 5, max: 30, fallback: DEFAULT_SETTINGS.reminderIntervalMax },
  eyeBreakDurationSec: { min: 15, max: 40, fallback: DEFAULT_SETTINGS.eyeBreakDurationSec },
  hydrationReminderMin: { min: 60, max: 240, fallback: DEFAULT_SETTINGS.hydrationReminderMin },
  subtleReminderMin: { min: 20, max: 60, fallback: DEFAULT_SETTINGS.subtleReminderMin },
  subtleReminderMax: { min: 20, max: 60, fallback: DEFAULT_SETTINGS.subtleReminderMax },
};

// -------------------------------------------------------
// ON INSTALL — Set up defaults
// -------------------------------------------------------
// When the extension is installed for the first time,
// save the default settings and stats to Chrome storage.
chrome.runtime.onInstalled.addListener((details) => {
  ensureDefaults({ freshSession: true });
  ensureTickAlarm();
  ensureIdleDetection();

  // Open onboarding only on a fresh install, never on updates.
  if (details.reason === 'install') {
    chrome.storage.local.get(['onboardingComplete'], (result) => {
      if (!result.onboardingComplete) {
        chrome.tabs.create({
          url: chrome.runtime.getURL('onboarding.html'),
          active: true,
        });
      }
    });
  }
});

chrome.runtime.onStartup.addListener(() => {
  ensureDefaults({ freshSession: true });
  ensureTickAlarm();
  ensureIdleDetection();
});

ensureIdleDetection();

chrome.idle.onStateChanged.addListener((state) => {
  broadcastToAllTabs({ type: 'SYSTEM_IDLE_STATE_CHANGED', state });

  if (state === 'locked') {
    resetRuntimeStateForFreshSession('locked');
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.settings?.newValue) return;

  broadcastToAllTabs({
    type: 'SETTINGS_UPDATED',
    settings: changes.settings.newValue,
  });
});

// -------------------------------------------------------
// ALARM HANDLER — Periodic checks
// -------------------------------------------------------
// Every minute, this alarm fires. We use it to:
//   1. Check if a snooze period has ended → re-enable the extension
//   2. Reset daily stats at midnight
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== 'eyeflow-tick') return;

  const result = await chrome.storage.local.get(['settings', 'stats', 'runtimeState']);
  const settings = mergeSettings(result.settings);
  const stats = mergeStats(result.stats);
  const runtimeState = mergeRuntimeState(result.runtimeState);
  const now = Date.now();
  let settingsChanged = false;
  let statsChanged = false;
  let runtimeStateChanged = false;

  // Keep snooze expiry and the soft-reminder scheduler on the same clock tick.
  if (settings.snoozedUntil > 0 && now >= settings.snoozedUntil) {
    settings.snoozedUntil = 0;
    settingsChanged = true;
  }

  const today = new Date(now).toDateString();
  if (stats.lastResetDate !== today) {
    // Daily counters roll over lazily on the first tick of a new day.
    // This is the only normal reset point for Top DS Sites Today.
    // Reloading the extension, refreshing a page, or closing/reopening Chrome should not clear it.
    stats.todayDoomScrollsBlocked = 0;
    stats.todayEyeBreaksCompleted = 0;
    stats.todayDsSiteTimeSpent = {};
    stats.lastResetDate = today;
    statsChanged = true;

    if (new Date(now).getDay() === 1) {
      stats.weekDoomScrollsBlocked = 0;
      stats.weekEyeBreaksCompleted = 0;
    }

    resetRuntimeStateFields(runtimeState, settings, now);
    runtimeStateChanged = true;
  }

  if (settingsChanged || statsChanged || runtimeStateChanged) {
    await chrome.storage.local.set({
      ...(settingsChanged ? { settings } : {}),
      ...(statsChanged ? { stats } : {}),
      ...(runtimeStateChanged ? { runtimeState } : {}),
    });
  }

  if (settingsChanged) {
    broadcastToAllTabs({ type: 'SNOOZE_ENDED' });
  }

  if (runtimeStateChanged) {
    broadcastRuntimeReset(runtimeState);
  }

  await runAmbientReminderTick(settings, runtimeState, now);
});

// -------------------------------------------------------
// MESSAGE HANDLER — Communication hub
// -------------------------------------------------------
// This handles all messages from content.js and popup.js.
// Each message has a "type" field that tells us what to do.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // --- GET_SETTINGS: popup or content script wants current settings ---
  if (message.type === 'GET_SETTINGS') {
    chrome.storage.local.get(['settings'], (result) => {
      sendResponse(mergeSettings(result.settings));
    });
    return true; // Required for async sendResponse
  }

  if (message.type === 'GET_SYSTEM_STATE') {
    chrome.idle.queryState(60, (state) => {
      sendResponse({ state });
    });
    return true;
  }

  if (message.type === 'GET_SHARED_DS_STATE') {
    chrome.storage.local.get(['settings', 'runtimeState'], (result) => {
      const settings = mergeSettings(result.settings);
      const runtimeState = mergeRuntimeState(result.runtimeState);

      if (!settings.enabled) {
        sendResponse(getSharedDsSnapshot(runtimeState));
        return;
      }

      if (!runtimeState.sharedDsNextBreakTargetMs) {
        runtimeState.sharedDsNextBreakTargetMs = getNextSharedBreakTargetMs(settings);
        chrome.storage.local.set({ runtimeState });
      }

      sendResponse(getSharedDsSnapshot(runtimeState));
    });
    return true;
  }

  if (message.type === 'GET_DEBUG_TIMERS') {
    chrome.storage.local.get(['settings', 'runtimeState'], (result) => {
      const settings = mergeSettings(result.settings);
      const runtimeState = mergeRuntimeState(result.runtimeState);
      if (!settings.enabled) {
        sendResponse({
          enabled: false,
          snoozedUntil: settings.snoozedUntil || 0,
          nextGentleReminderAt: 0,
          gentlePausedRemainingMs: 0,
          gentleState: GENTLE_TIMER_STATES.OFF,
          gentlePauseReason: GENTLE_PAUSE_REASONS.DISABLED,
          nextWaterReminderAt: 0,
          waterReminderPending: false,
          waterQueuedForNextBreak: false,
        });
        return;
      }

      expireStaleWaterPending(runtimeState, settings);
      if (
        !runtimeState.nextWaterReminderAt &&
        !runtimeState.waterReminderPending &&
        !runtimeState.waterQueuedForNextBreak
      ) {
        runtimeState.nextWaterReminderAt = Date.now() + getWaterDelayMs(settings);
        chrome.storage.local.set({ runtimeState });
      }
      sendResponse({
        enabled: settings.enabled,
        snoozedUntil: settings.snoozedUntil || 0,
        nextGentleReminderAt: runtimeState.nextGentleReminderAt || 0,
        gentlePausedRemainingMs: runtimeState.gentlePausedRemainingMs || 0,
        gentleState: runtimeState.gentleState || GENTLE_TIMER_STATES.OFF,
        gentlePauseReason: runtimeState.gentlePauseReason || GENTLE_PAUSE_REASONS.NONE,
        nextWaterReminderAt: runtimeState.nextWaterReminderAt || 0,
        waterReminderPending: Boolean(runtimeState.waterReminderPending),
        waterQueuedForNextBreak: Boolean(runtimeState.waterQueuedForNextBreak),
      });
    });
    return true;
  }

  if (message.type === 'SYNC_SHARED_DS_STATE') {
    chrome.storage.local.get(['settings', 'runtimeState'], (result) => {
      const settings = mergeSettings(result.settings);
      const runtimeState = mergeRuntimeState(result.runtimeState);
      const now = Date.now();
      const senderTabId = sender?.tab?.id || 0;
      const senderTabIsActive = Boolean(sender?.tab?.active);
      const wasDsActive = Boolean(runtimeState.sharedDsIsActive);
      const isSnoozed = settings.snoozedUntil > 0 && now < settings.snoozedUntil;

      if (!runtimeState.sharedDsNextBreakTargetMs) {
        runtimeState.sharedDsNextBreakTargetMs = getNextSharedBreakTargetMs(settings);
      }

      advanceSharedDsState(runtimeState, now);

      if (message.isActive) {
        runtimeState.sharedDsIsActive = true;
        runtimeState.sharedDsActiveTabId = senderTabId;
        runtimeState.sharedDsContextKey = message.contextKey || '';
        runtimeState.sharedDsLastUpdateAt = now;
        runtimeState.sharedDsState = SHARED_DS_TIMER_STATES.RUNNING;
        runtimeState.sharedDsPauseReason = SHARED_DS_PAUSE_REASONS.NONE;
      } else if (runtimeState.sharedDsActiveTabId === senderTabId || senderTabIsActive) {
        runtimeState.sharedDsIsActive = false;
        runtimeState.sharedDsActiveTabId = 0;
        runtimeState.sharedDsContextKey = '';
        runtimeState.sharedDsLastUpdateAt = now;
        runtimeState.sharedDsState = SHARED_DS_TIMER_STATES.PAUSED;
        runtimeState.sharedDsPauseReason = SHARED_DS_PAUSE_REASONS.INACTIVE;
      }

      // Keep the gentle reminder visually and logically out of the way while the
      // stronger DS timer owns the experience, instead of waiting for the next
      // ambient tick to pause or resume it.
      if (runtimeState.sharedDsIsActive) {
        pauseGentleReminder(runtimeState, GENTLE_PAUSE_REASONS.DS_ACTIVE, now);
      } else if (
        !isSnoozed &&
        wasDsActive &&
        !runtimeState.sharedDsIsActive &&
        settings.subtleReminderEnabled
      ) {
        resumeGentleReminder(runtimeState, now);
        if (!runtimeState.nextGentleReminderAt) {
          runtimeState.nextGentleReminderAt = now + getGentleDelayMs(settings);
        }
      }

      chrome.storage.local.set({ runtimeState }, () => {
        sendResponse(getSharedDsSnapshot(runtimeState));
      });
    });
    return true;
  }

  // --- SAVE_SETTINGS: popup changed a setting, save it ---
  if (message.type === 'SAVE_SETTINGS') {
    chrome.storage.local.get(['settings', 'runtimeState'], (result) => {
      const previousSettings = mergeSettings(result.settings);
      const settings = mergeSettings(result.settings, message.settings);
      const runtimeState = mergeRuntimeState(result.runtimeState);
      const now = Date.now();
      const isSnoozed = settings.snoozedUntil > 0 && now < settings.snoozedUntil;

      if (settings.enabled) {
        if (shouldRestartMainTimers(previousSettings, settings)) {
          restartMainTimers(runtimeState, settings, now);
        }

        if (isSnoozed) {
          pauseGentleReminder(runtimeState, GENTLE_PAUSE_REASONS.SNOOZE, now);
          runtimeState.nextSoundReminderAt = 0;
        }
      } else {
        clearRuntimeStateForDisabled(runtimeState);
      }

      chrome.storage.local.set({ settings, runtimeState }, () => {
        sendResponse({ success: true });
      });
    });
    return true;
  }

  // --- GET_STATS: popup wants to display stats ---
  if (message.type === 'GET_STATS') {
    chrome.storage.local.get(['stats'], (result) => {
      sendResponse(mergeStats(result.stats));
    });
    return true;
  }

  // --- DOOM_SCROLL_DETECTED: content.js says the user is doom scrolling ---
  // This is the key event! When content.js detects rapid scrolling,
  // it sends this message. We update stats and decide what to do.
  if (message.type === 'DOOM_SCROLL_DETECTED') {
    chrome.storage.local.get(['settings', 'stats', 'runtimeState'], (result) => {
      const settings = mergeSettings(result.settings);
      const stats = mergeStats(result.stats);
      const runtimeState = mergeRuntimeState(result.runtimeState);

      // Snooze only pauses gentle reminders. Strong DS protection should still run.
      if (!settings.enabled) {
        sendResponse({ action: 'IGNORE' });
        return;
      }

      // Update doom scroll stats
      stats.totalDoomScrollsBlocked++;
      stats.todayDoomScrollsBlocked++;
      stats.weekDoomScrollsBlocked++;

      // Save the session data for pattern learning
      const sessionData = {
        site: message.site || 'unknown',
        day: new Date().getDay(), // 0=Sunday, 1=Monday, etc.
        hour: new Date().getHours(), // 0-23
        duration: message.duration || 0,
        scrollCount: message.scrollCount || 0,
        timestamp: Date.now(),
      };
      stats.doomScrollSessions.push(sessionData);

      // Keep only the last 200 sessions to avoid using too much storage
      if (stats.doomScrollSessions.length > 200) {
        stats.doomScrollSessions = stats.doomScrollSessions.slice(-200);
      }

      // Strong DS handling should pause the gentle timeline, not rewrite it.
      // The pause/resume path is managed separately through the shared DS state.
      runtimeState.lastPrimaryInterventionAt = 0;
      runtimeState.nextSoundReminderAt = 0;

      chrome.storage.local.set({ stats, runtimeState });

      // Tell the content script what stage of interruption to show
      sendResponse({
        action: 'INTERVENE',
        stage: message.stage || 'nudge', // nudge, warning, or break
        settings: settings,
      });
    });
    return true;
  }

  // --- EYE_BREAK_COMPLETED: user finished the eye exercise ---
  if (message.type === 'EYE_BREAK_COMPLETED') {
    chrome.storage.local.get(['settings', 'stats', 'runtimeState'], (result) => {
      const stats = mergeStats(result.stats);

      stats.totalEyeBreaksCompleted++;
      stats.todayEyeBreaksCompleted++;
      stats.weekEyeBreaksCompleted++;
      stats.lastBreakTime = Date.now();

      chrome.storage.local.set({ stats });
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.type === 'EYE_BREAK_FLOW_CLOSED') {
    chrome.storage.local.get(['settings', 'runtimeState'], (result) => {
      const settings = mergeSettings(result.settings);
      const runtimeState = mergeRuntimeState(result.runtimeState);

      // Restart the next DS cycle only after the user actually dismisses the
      // post-break UI, so the follow-up card cannot overlap with a fresh timer.
      runtimeState.lastPrimaryInterventionAt = 0;
      runtimeState.nextSoundReminderAt = 0;
      runtimeState.sharedDsActiveMs = 0;
      runtimeState.sharedDsNextBreakTargetMs = getNextSharedBreakTargetMs(settings);
      runtimeState.sharedDsLastUpdateAt = Date.now();
      runtimeState.sharedDsState = SHARED_DS_TIMER_STATES.PAUSED;
      runtimeState.sharedDsPauseReason = SHARED_DS_PAUSE_REASONS.BREAK_FLOW;

      chrome.storage.local.set({ runtimeState });
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.type === 'HYDRATION_COMPLETED') {
    chrome.storage.local.get(['settings', 'runtimeState'], (result) => {
      const settings = mergeSettings(result.settings);
      const runtimeState = mergeRuntimeState(result.runtimeState);
      const now = Date.now();

      runtimeState.nextWaterReminderAt = now + getWaterDelayMs(settings);
      runtimeState.waterReminderPending = false;
      runtimeState.waterReminderPendingSince = 0;
      runtimeState.waterQueuedForNextBreak = false;

      chrome.storage.local.set({ runtimeState });
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.type === 'HYDRATION_REMIND_SOON') {
    chrome.storage.local.get(['runtimeState'], (result) => {
      const runtimeState = mergeRuntimeState(result.runtimeState);
      const now = Date.now();

      runtimeState.nextWaterReminderAt = now + WATER_REMIND_SOON_DELAY_MS;
      runtimeState.waterReminderPending = false;
      runtimeState.waterReminderPendingSince = 0;
      runtimeState.waterQueuedForNextBreak = false;

      chrome.storage.local.set({ runtimeState });
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.type === 'GENTLE_REMINDER_SHOWN') {
    chrome.storage.local.get(['settings', 'runtimeState'], (result) => {
      const settings = mergeSettings(result.settings);
      const runtimeState = mergeRuntimeState(result.runtimeState);
      const now = Date.now();

      runtimeState.lastGentleReminderAt = now;
      scheduleNextGentleReminder(runtimeState, settings, now);

      chrome.storage.local.set({ runtimeState });
      sendResponse({ success: true });
    });
    return true;
  }

  // --- MOOD_RECORDED: user tapped a mood emoji after eye break ---
  if (message.type === 'MOOD_RECORDED') {
    chrome.storage.local.get(['stats'], (result) => {
      const stats = mergeStats(result.stats);

      stats.moodHistory.push({
        mood: message.mood, // 'good', 'okay', or 'bad'
        timestamp: Date.now(),
        site: message.site || 'unknown',
      });

      // Keep only last 100 mood entries
      if (stats.moodHistory.length > 100) {
        stats.moodHistory = stats.moodHistory.slice(-100);
      }

      chrome.storage.local.set({ stats });
      sendResponse({ success: true });
    });
    return true;
  }

  // --- SNOOZE: user activated work mode snooze from popup ---
  if (message.type === 'SNOOZE') {
    chrome.storage.local.get(['settings'], (result) => {
      const settings = mergeSettings(result.settings);
      const now = Date.now();

      // Set the snooze end time
      settings.snoozedUntil = now + message.hours * 60 * 60 * 1000;
      chrome.storage.local.get(['runtimeState'], (runtimeResult) => {
        const runtimeState = mergeRuntimeState(runtimeResult.runtimeState);
        pauseGentleReminder(runtimeState, GENTLE_PAUSE_REASONS.SNOOZE, now);
        runtimeState.nextSoundReminderAt = 0;
        chrome.storage.local.set({ settings, runtimeState });

        // Notify all tabs that snooze is active
        broadcastToAllTabs({ type: 'SNOOZE_STARTED', until: settings.snoozedUntil });
        sendResponse({ success: true, until: settings.snoozedUntil });
      });
    });
    return true;
  }

  // --- RESUME: user manually ended snooze ---
  if (message.type === 'RESUME') {
    chrome.storage.local.get(['settings', 'runtimeState'], (result) => {
      const settings = mergeSettings(result.settings);
      const runtimeState = mergeRuntimeState(result.runtimeState);
      const now = Date.now();
      settings.snoozedUntil = 0;
      if (!runtimeState.sharedDsIsActive) {
        resumeGentleReminder(runtimeState, now);
      }
      chrome.storage.local.set({ settings, runtimeState });

      broadcastToAllTabs({ type: 'SNOOZE_ENDED' });
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.type === 'CLOSE_TAB') {
    if (!sender.tab || !sender.tab.id) {
      sendResponse({ success: false });
      return false;
    }

    chrome.tabs.remove(sender.tab.id, () => {
      sendResponse({ success: !chrome.runtime.lastError });
    });
    return true;
  }

  // --- GET_PATTERN_INSIGHTS: intelligence.js asks for pattern data ---
  if (message.type === 'GET_PATTERN_INSIGHTS') {
    chrome.storage.local.get(['stats'], (result) => {
      const stats = mergeStats(result.stats);
      const insights = analyzePatterns(stats.doomScrollSessions);
      sendResponse(insights);
    });
    return true;
  }

  if (!message.type.startsWith('GET_')) {
    sendResponse({ success: true, unhandled: true });
  }
  return true;
});

async function runAmbientReminderTick(settings, runtimeState, now) {
  if (!settings.enabled) {
    clearRuntimeStateForDisabled(runtimeState);
    await chrome.storage.local.set({ runtimeState });
    return;
  }

  const isSnoozed = settings.snoozedUntil > 0 && now < settings.snoozedUntil;

  expireStaleWaterPending(runtimeState, settings, now);

  if (runtimeState.waterReminderPending) {
    await reconcilePendingWaterReminder(runtimeState, settings, now);
  }

  if (
    !runtimeState.nextWaterReminderAt &&
    !runtimeState.waterReminderPending &&
    !runtimeState.waterQueuedForNextBreak
  ) {
    runtimeState.nextWaterReminderAt = now + getWaterDelayMs(settings);
  }

  if (
    runtimeState.nextWaterReminderAt &&
    now >= runtimeState.nextWaterReminderAt &&
    !runtimeState.waterReminderPending &&
    !runtimeState.waterQueuedForNextBreak
  ) {
    const waterResult = await deliverWaterReminder(now);

    if (waterResult === 'queued') {
      runtimeState.waterQueuedForNextBreak = true;
      runtimeState.nextWaterReminderAt = 0;
    } else if (waterResult === 'popup') {
      runtimeState.waterReminderPending = true;
      runtimeState.waterReminderPendingSince = now;
      runtimeState.nextWaterReminderAt = 0;
    } else {
      runtimeState.nextWaterReminderAt = now + getWaterDelayMs(settings);
      runtimeState.waterReminderPending = false;
      runtimeState.waterReminderPendingSince = 0;
      runtimeState.waterQueuedForNextBreak = false;
    }
  }

  if (isSnoozed) {
    pauseGentleReminder(runtimeState, GENTLE_PAUSE_REASONS.SNOOZE, now);
    runtimeState.nextSoundReminderAt = 0;
    await chrome.storage.local.set({ runtimeState });
    return;
  }

  const chromeState = await getChromeWindowState();
  if (!chromeState.hasChromeWindow) {
    pauseGentleReminder(runtimeState, GENTLE_PAUSE_REASONS.NO_WINDOW, now);
    runtimeState.nextSoundReminderAt = 0;
    await chrome.storage.local.set({ runtimeState });
    return;
  }

  if (chromeState.chromeFocused) {
    runtimeState.nextSoundReminderAt = 0;

    if (!settings.subtleReminderEnabled) {
      setGentleReminderOff(runtimeState, GENTLE_PAUSE_REASONS.FEATURE_OFF);
      await chrome.storage.local.set({ runtimeState });
      return;
    }

    if (runtimeState.sharedDsIsActive) {
      pauseGentleReminder(runtimeState, GENTLE_PAUSE_REASONS.DS_ACTIVE, now);
      await chrome.storage.local.set({ runtimeState });
      return;
    }

    const { pageContext } = await getActiveTabReminderContext();
    if (pageContext && pageContext.isUsageActive === false) {
      pauseGentleReminder(runtimeState, GENTLE_PAUSE_REASONS.INACTIVE, now);
      await chrome.storage.local.set({ runtimeState });
      return;
    }

    resumeGentleReminder(runtimeState, now);

    if (!runtimeState.nextGentleReminderAt) {
      scheduleNextGentleReminder(runtimeState, settings, now);
    } else if (now >= runtimeState.nextGentleReminderAt) {
      runtimeState.gentleState = GENTLE_TIMER_STATES.DUE;
      runtimeState.gentlePauseReason = GENTLE_PAUSE_REASONS.NONE;
      const reminderShown = await sendGentleReminderToActiveTab();
      scheduleNextGentleReminder(runtimeState, settings, now);
      if (reminderShown) {
        runtimeState.lastGentleReminderAt = now;
      }
    } else {
      runtimeState.gentleState = GENTLE_TIMER_STATES.RUNNING;
      runtimeState.gentlePauseReason = GENTLE_PAUSE_REASONS.NONE;
    }
  } else {
    if (!settings.soundReminderEnabled) {
      runtimeState.nextSoundReminderAt = 0;
      await chrome.storage.local.set({ runtimeState });
      return;
    }

    if (!runtimeState.nextSoundReminderAt) {
      runtimeState.nextSoundReminderAt =
        now + getRandomDelayMs(settings.soundReminderMin, settings.soundReminderMax);
    } else if (now >= runtimeState.nextSoundReminderAt) {
      const soundPlayed = await playReminderSound();
      runtimeState.nextSoundReminderAt =
        now + getRandomDelayMs(settings.soundReminderMin, settings.soundReminderMax);
      if (!soundPlayed) {
        runtimeState.nextSoundReminderAt = now + SOUND_REMINDER_FOLLOWUP_MS;
      } else {
        runtimeState.lastSoundReminderAt = now;
      }
    }
  }

  await chrome.storage.local.set({ runtimeState });
}

function setGentleReminderOff(runtimeState, reason = GENTLE_PAUSE_REASONS.DISABLED) {
  runtimeState.nextGentleReminderAt = 0;
  runtimeState.gentlePausedRemainingMs = 0;
  runtimeState.gentleState = GENTLE_TIMER_STATES.OFF;
  runtimeState.gentlePauseReason = reason;
}

function scheduleNextGentleReminder(runtimeState, settings, now = Date.now()) {
  runtimeState.nextGentleReminderAt = now + getGentleDelayMs(settings);
  runtimeState.gentlePausedRemainingMs = 0;
  runtimeState.gentleState = GENTLE_TIMER_STATES.RUNNING;
  runtimeState.gentlePauseReason = GENTLE_PAUSE_REASONS.NONE;
}

function pauseGentleReminder(
  runtimeState,
  reason = GENTLE_PAUSE_REASONS.NO_WINDOW,
  now = Date.now()
) {
  if (runtimeState.nextGentleReminderAt > 0) {
    runtimeState.gentlePausedRemainingMs = Math.max(1000, runtimeState.nextGentleReminderAt - now);
    runtimeState.nextGentleReminderAt = 0;
  }
  runtimeState.gentleState = GENTLE_TIMER_STATES.PAUSED;
  runtimeState.gentlePauseReason = reason;
}

function resumeGentleReminder(runtimeState, now = Date.now()) {
  if (!runtimeState.nextGentleReminderAt && runtimeState.gentlePausedRemainingMs > 0) {
    runtimeState.nextGentleReminderAt = now + runtimeState.gentlePausedRemainingMs;
    runtimeState.gentlePausedRemainingMs = 0;
  }
  if (runtimeState.nextGentleReminderAt > 0) {
    runtimeState.gentleState = GENTLE_TIMER_STATES.RUNNING;
    runtimeState.gentlePauseReason = GENTLE_PAUSE_REASONS.NONE;
  }
}

async function getChromeWindowState() {
  const windows = await chrome.windows.getAll({ windowTypes: ['normal'] });
  return {
    hasChromeWindow: windows.length > 0,
    chromeFocused: windows.some((windowInfo) => windowInfo.focused),
  };
}

async function sendGentleReminderToActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const activeTab = tabs.find((tab) => tab.id && tab.url && !tab.url.startsWith('chrome://'));
  if (!activeTab || !activeTab.id) return false;

  // Skip the gentle work reminder on pages that already need the stronger feed logic.
  if (isLikelyDoomScrollUrl(activeTab.url || '')) {
    return false;
  }

  try {
    // Ask the page if a soft reminder would be inappropriate right now.
    const pageContext = await chrome.tabs.sendMessage(activeTab.id, {
      type: 'CAN_SHOW_GENTLE_REMINDER',
    });
    if (!pageContext || !pageContext.allow) {
      return false;
    }

    await chrome.tabs.sendMessage(activeTab.id, { type: 'SHOW_GENTLE_REMINDER' });
    return true;
  } catch (e) {
    // Ignore tabs that cannot receive messages.
    return false;
  }
}

async function getActiveTabReminderContext() {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const activeTab = tabs.find((tab) => tab.id && tab.url && !tab.url.startsWith('chrome://'));
  if (!activeTab || !activeTab.id) {
    return { activeTab: null, pageContext: null };
  }

  try {
    const pageContext = await chrome.tabs.sendMessage(activeTab.id, {
      type: 'GET_PAGE_REMINDER_CONTEXT',
    });
    return { activeTab, pageContext };
  } catch (e) {
    return { activeTab, pageContext: null };
  }
}

async function deliverWaterReminder(now = Date.now()) {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const activeTab = tabs.find((tab) => tab.id && tab.url && !tab.url.startsWith('chrome://'));

  if (!activeTab || !activeTab.id) {
    await showBasicNotification(
      'water-reminder',
      'EyeFlow water reminder',
      'Take a few sips of water when you get a moment.'
    );
    return 'notification';
  }

  try {
    const pageContext = await chrome.tabs.sendMessage(activeTab.id, {
      type: 'GET_PAGE_REMINDER_CONTEXT',
    });

    if (pageContext?.isDoomScrollContext) {
      if ((pageContext.msUntilEyeBreak || Infinity) <= 3 * 60 * 1000) {
        await chrome.tabs.sendMessage(activeTab.id, { type: 'QUEUE_HYDRATION_FOR_NEXT_BREAK' });
        return 'queued';
      }

      await chrome.tabs.sendMessage(activeTab.id, { type: 'SHOW_HYDRATION_POPUP' });
      return 'popup';
    }

    if (pageContext?.canShowGentleReminder) {
      await chrome.tabs.sendMessage(activeTab.id, { type: 'SHOW_WATER_GENTLE_REMINDER' });
      return 'gentle';
    }
  } catch (e) {
    // Fall through to a normal browser notification when the page cannot respond.
  }

  await showBasicNotification(
    'water-reminder',
    'EyeFlow water reminder',
    'Take a few sips of water when you get a moment.'
  );
  return 'notification';
}

async function reconcilePendingWaterReminder(runtimeState, settings, now = Date.now()) {
  if (!runtimeState.waterReminderPending) return false;

  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const activeTab = tabs.find((tab) => tab.id && tab.url && !tab.url.startsWith('chrome://'));

  if (!activeTab || !activeTab.id) {
    expireStaleWaterPending(runtimeState, settings, now);
    return false;
  }

  try {
    const pageContext = await chrome.tabs.sendMessage(activeTab.id, {
      type: 'GET_PAGE_REMINDER_CONTEXT',
    });

    if (pageContext?.isDoomScrollContext) {
      expireStaleWaterPending(runtimeState, settings, now);
      return false;
    }

    if (pageContext?.canShowGentleReminder) {
      await chrome.tabs.sendMessage(activeTab.id, { type: 'SHOW_WATER_GENTLE_REMINDER' });
      runtimeState.waterReminderPending = false;
      runtimeState.waterReminderPendingSince = 0;
      runtimeState.waterQueuedForNextBreak = false;
      runtimeState.nextWaterReminderAt = now + getWaterDelayMs(settings);
      return true;
    }
  } catch (e) {
    // Ignore transient tab messaging issues and let normal recovery handle it.
  }

  expireStaleWaterPending(runtimeState, settings, now);
  return false;
}

async function showBasicNotification(id, title, message) {
  await chrome.notifications.create(id, {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title,
    message,
  });
}

async function playReminderSound() {
  try {
    await ensureOffscreenDocument();

    await chrome.runtime.sendMessage({ type: 'PLAY_REMINDER_SOUND' });
    return true;
  } catch (e) {
    // Ignore transient offscreen messaging issues.
    return false;
  }
}

async function ensureOffscreenDocument() {
  const offscreenUrl = chrome.runtime.getURL('offscreen.html');
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [offscreenUrl],
  });

  if (contexts.length > 0) return;

  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['AUDIO_PLAYBACK'],
    justification: 'Play a short eye-care reminder sound when Chrome is open in the background.',
  });
}

function getRandomDelayMs(minMinutes, maxMinutes) {
  const min = Math.max(1, Math.min(minMinutes, maxMinutes));
  const max = Math.max(min, Math.max(minMinutes, maxMinutes));
  const randomMinutes = Math.floor(Math.random() * (max - min + 1)) + min;
  return randomMinutes * 60 * 1000;
}

function getNextSharedBreakTargetMs(settings) {
  return getEyeBreakDelayMs(settings);
}

function getWaterDelayMs(settings) {
  const minutes = settings?.hydrationReminderMin || DEFAULT_SETTINGS.hydrationReminderMin;
  const jitterMinutes = Math.floor(Math.random() * 6);
  return (minutes + jitterMinutes) * 60 * 1000;
}

function expireStaleWaterPending(runtimeState, settings, now = Date.now()) {
  if (!runtimeState.waterReminderPending) return false;
  if (!runtimeState.waterReminderPendingSince) {
    runtimeState.waterReminderPendingSince = now;
    return true;
  }
  if (now - runtimeState.waterReminderPendingSince < WATER_PENDING_TIMEOUT_MS) {
    return false;
  }

  runtimeState.waterReminderPending = false;
  runtimeState.waterReminderPendingSince = 0;
  runtimeState.waterQueuedForNextBreak = false;
  runtimeState.nextWaterReminderAt = now + getWaterDelayMs(settings);
  return true;
}

function advanceSharedDsState(runtimeState, now = Date.now()) {
  if (!runtimeState.sharedDsLastUpdateAt) {
    runtimeState.sharedDsLastUpdateAt = now;
    return;
  }

  if (now - runtimeState.sharedDsLastUpdateAt > SESSION_RESET_INACTIVITY_MS) {
    runtimeState.sharedDsActiveMs = 0;
    runtimeState.sharedDsIsActive = false;
    runtimeState.sharedDsActiveTabId = 0;
    runtimeState.sharedDsContextKey = '';
    runtimeState.sharedDsLastUpdateAt = now;
    runtimeState.sharedDsState = SHARED_DS_TIMER_STATES.PAUSED;
    runtimeState.sharedDsPauseReason = SHARED_DS_PAUSE_REASONS.SESSION_TIMEOUT;
    return;
  }

  if (!runtimeState.sharedDsIsActive) {
    runtimeState.sharedDsLastUpdateAt = now;
    runtimeState.sharedDsState = SHARED_DS_TIMER_STATES.PAUSED;
    runtimeState.sharedDsPauseReason = SHARED_DS_PAUSE_REASONS.INACTIVE;
    return;
  }

  runtimeState.sharedDsActiveMs += Math.max(0, now - runtimeState.sharedDsLastUpdateAt);
  runtimeState.sharedDsLastUpdateAt = now;
  runtimeState.sharedDsState = SHARED_DS_TIMER_STATES.RUNNING;
  runtimeState.sharedDsPauseReason = SHARED_DS_PAUSE_REASONS.NONE;
}

function getSharedDsSnapshot(runtimeState) {
  return {
    activeMs: runtimeState.sharedDsActiveMs || 0,
    nextBreakTargetMs: runtimeState.sharedDsNextBreakTargetMs || 0,
    isActive: Boolean(runtimeState.sharedDsIsActive),
    contextKey: runtimeState.sharedDsContextKey || '',
    activeTabId: runtimeState.sharedDsActiveTabId || 0,
  };
}

function normalizeTimingMode(timingMode, customTimingEnabled) {
  if (timingMode === 'fixed' || timingMode === 'surprise') {
    return timingMode;
  }

  return customTimingEnabled ? 'surprise' : 'fixed';
}

function isSurpriseTiming(settings) {
  return normalizeTimingMode(settings?.timingMode, settings?.customTimingEnabled) === 'surprise';
}

function getEyeBreakDelayMs(settings) {
  if (isSurpriseTiming(settings)) {
    return getRandomDelayMs(
      settings?.reminderIntervalMin || DEFAULT_SETTINGS.reminderIntervalMin,
      settings?.reminderIntervalMax || DEFAULT_SETTINGS.reminderIntervalMax
    );
  }

  const exactMinutes = clampNumber(
    settings?.reminderIntervalMin,
    TIMER_LIMITS.doomReminderMin.min,
    TIMER_LIMITS.doomReminderMin.max,
    TIMER_LIMITS.doomReminderMin.fallback
  );
  return exactMinutes * 60 * 1000;
}

function getGentleDelayMs(settings) {
  if (isSurpriseTiming(settings)) {
    return getRandomDelayMs(
      settings?.subtleReminderMin || DEFAULT_SETTINGS.subtleReminderMin,
      settings?.subtleReminderMax || DEFAULT_SETTINGS.subtleReminderMax
    );
  }

  const exactMinutes = clampNumber(
    settings?.subtleReminderMin,
    TIMER_LIMITS.subtleReminderMin.min,
    TIMER_LIMITS.subtleReminderMin.max,
    TIMER_LIMITS.subtleReminderMin.fallback
  );
  return exactMinutes * 60 * 1000;
}

function isLikelyDoomScrollUrl(url) {
  try {
    const parsedUrl = new URL(url);
    const hostname = parsedUrl.hostname.replace(/^(www|m)\./, '');
    const pathname = (parsedUrl.pathname || '/').toLowerCase();

    if (hostname === 'youtube.com' && pathname.startsWith('/shorts')) return true;
    if (hostname === 'snapchat.com') {
      return (
        pathname.startsWith('/spotlight') ||
        pathname.includes('/spotlight/') ||
        pathname.startsWith('/stories') ||
        pathname.startsWith('/discover') ||
        pathname === '/'
      );
    }
    if (hostname === 'linkedin.com') {
      return (
        pathname.startsWith('/feed/') ||
        pathname.startsWith('/video/') ||
        pathname.startsWith('/posts/') ||
        pathname.startsWith('/feed/update/')
      );
    }
    if (hostname === 'twitch.tv') {
      return (
        pathname.startsWith('/clips') ||
        pathname.startsWith('/clip/') ||
        (pathname.startsWith('/directory/game/') && pathname.includes('/clips')) ||
        (pathname.startsWith('/directory/all/tags/') && pathname.includes('/clips'))
      );
    }
    if (hostname === 'x.com' || hostname === 'twitter.com') {
      if (pathname.startsWith('/home') || pathname.startsWith('/explore')) return true;
      if (
        pathname.startsWith('/i/communities') ||
        /^\/[^/]+\/communities(\/|$)/.test(pathname) ||
        pathname.startsWith('/communities')
      )
        return true;
      if (pathname.includes('/status/')) return true;
      return false;
    }

    return DOOM_SCROLL_HOSTS.has(hostname);
  } catch (e) {
    return false;
  }
}

function mergeSettings(...sources) {
  const merged = {
    ...DEFAULT_SETTINGS,
    siteTiers: { ...DEFAULT_SETTINGS.siteTiers },
    redirectSuggestions: [...DEFAULT_SETTINGS.redirectSuggestions],
  };

  sources.filter(Boolean).forEach((source) => {
    Object.assign(merged, source);

    if (source.siteTiers) {
      merged.siteTiers = { ...merged.siteTiers, ...source.siteTiers };
    }

    if (Array.isArray(source.redirectSuggestions)) {
      merged.redirectSuggestions = [...source.redirectSuggestions];
    }
  });

  // Clamp user-controlled timers so old saved values or bad input cannot create odd schedules.
  merged.reminderIntervalMin = clampNumber(
    merged.reminderIntervalMin,
    TIMER_LIMITS.doomReminderMin.min,
    TIMER_LIMITS.doomReminderMin.max,
    TIMER_LIMITS.doomReminderMin.fallback
  );
  merged.reminderIntervalMax = clampNumber(
    merged.reminderIntervalMax,
    Math.max(merged.reminderIntervalMin, TIMER_LIMITS.doomReminderMax.min),
    TIMER_LIMITS.doomReminderMax.max,
    Math.max(merged.reminderIntervalMin, TIMER_LIMITS.doomReminderMax.fallback)
  );
  merged.eyeBreakDurationSec = clampNumber(
    merged.eyeBreakDurationSec,
    TIMER_LIMITS.eyeBreakDurationSec.min,
    TIMER_LIMITS.eyeBreakDurationSec.max,
    TIMER_LIMITS.eyeBreakDurationSec.fallback
  );
  merged.hydrationReminderMin = clampNumber(
    merged.hydrationReminderMin,
    TIMER_LIMITS.hydrationReminderMin.min,
    TIMER_LIMITS.hydrationReminderMin.max,
    TIMER_LIMITS.hydrationReminderMin.fallback
  );
  merged.subtleReminderMin = clampNumber(
    merged.subtleReminderMin,
    TIMER_LIMITS.subtleReminderMin.min,
    TIMER_LIMITS.subtleReminderMin.max,
    TIMER_LIMITS.subtleReminderMin.fallback
  );
  merged.subtleReminderMax = clampNumber(
    merged.subtleReminderMax,
    Math.max(merged.subtleReminderMin, TIMER_LIMITS.subtleReminderMax.min),
    TIMER_LIMITS.subtleReminderMax.max,
    Math.max(merged.subtleReminderMin, TIMER_LIMITS.subtleReminderMax.fallback)
  );

  merged.timingMode = normalizeTimingMode(merged.timingMode, merged.customTimingEnabled);
  merged.customTimingEnabled = merged.timingMode === 'surprise';

  if (merged.timingMode === 'fixed') {
    merged.reminderIntervalMax = merged.reminderIntervalMin;
    merged.subtleReminderMax = merged.subtleReminderMin;
  }

  return merged;
}

function mergeStats(source) {
  return {
    ...DEFAULT_STATS,
    ...(source || {}),
    moodHistory: Array.isArray(source?.moodHistory)
      ? source.moodHistory
      : [...DEFAULT_STATS.moodHistory],
    doomScrollSessions: Array.isArray(source?.doomScrollSessions)
      ? source.doomScrollSessions
      : [...DEFAULT_STATS.doomScrollSessions],
    siteTimeSpent: source?.siteTimeSpent
      ? { ...source.siteTimeSpent }
      : { ...DEFAULT_STATS.siteTimeSpent },
    todayDsSiteTimeSpent: source?.todayDsSiteTimeSpent
      ? { ...source.todayDsSiteTimeSpent }
      : { ...DEFAULT_STATS.todayDsSiteTimeSpent },
  };
}

function mergeRuntimeState(source) {
  const merged = {
    ...DEFAULT_RUNTIME_STATE,
    ...(source || {}),
  };

  if (merged.gentleState === 'hold') {
    merged.gentleState = GENTLE_TIMER_STATES.PAUSED;
  }

  return merged;
}

function resetRuntimeStateFields(runtimeState, settings, now = Date.now()) {
  Object.assign(runtimeState, DEFAULT_RUNTIME_STATE, {
    nextGentleReminderAt: settings.enabled ? now + getGentleDelayMs(settings) : 0,
    gentlePausedRemainingMs: 0,
    gentleState:
      settings.enabled && settings.subtleReminderEnabled
        ? GENTLE_TIMER_STATES.RUNNING
        : GENTLE_TIMER_STATES.OFF,
    gentlePauseReason:
      settings.enabled && settings.subtleReminderEnabled
        ? GENTLE_PAUSE_REASONS.NONE
        : GENTLE_PAUSE_REASONS.FEATURE_OFF,
    nextWaterReminderAt: settings.enabled ? now + getWaterDelayMs(settings) : 0,
    waterReminderPending: false,
    waterReminderPendingSince: 0,
    waterQueuedForNextBreak: false,
    sharedDsActiveMs: 0,
    sharedDsNextBreakTargetMs: settings.enabled ? getEyeBreakDelayMs(settings) : 0,
    sharedDsLastUpdateAt: settings.enabled ? now : 0,
    sharedDsActiveTabId: 0,
    sharedDsIsActive: false,
    sharedDsContextKey: '',
    sharedDsState: settings.enabled ? SHARED_DS_TIMER_STATES.PAUSED : SHARED_DS_TIMER_STATES.OFF,
    sharedDsPauseReason: settings.enabled
      ? SHARED_DS_PAUSE_REASONS.INACTIVE
      : SHARED_DS_PAUSE_REASONS.DISABLED,
  });
}

function clearRuntimeStateForDisabled(runtimeState) {
  setGentleReminderOff(runtimeState, GENTLE_PAUSE_REASONS.DISABLED);
  runtimeState.nextWaterReminderAt = 0;
  runtimeState.waterReminderPending = false;
  runtimeState.waterReminderPendingSince = 0;
  runtimeState.waterQueuedForNextBreak = false;
  runtimeState.nextSoundReminderAt = 0;
  runtimeState.lastPrimaryInterventionAt = 0;
  runtimeState.lastGentleReminderAt = 0;
  runtimeState.sharedDsActiveMs = 0;
  runtimeState.sharedDsNextBreakTargetMs = 0;
  runtimeState.sharedDsLastUpdateAt = 0;
  runtimeState.sharedDsActiveTabId = 0;
  runtimeState.sharedDsIsActive = false;
  runtimeState.sharedDsContextKey = '';
  runtimeState.sharedDsState = SHARED_DS_TIMER_STATES.OFF;
  runtimeState.sharedDsPauseReason = SHARED_DS_PAUSE_REASONS.DISABLED;
}

function restartMainTimers(runtimeState, settings, now = Date.now()) {
  if (settings.subtleReminderEnabled) {
    scheduleNextGentleReminder(runtimeState, settings, now);
  } else {
    setGentleReminderOff(runtimeState, GENTLE_PAUSE_REASONS.FEATURE_OFF);
  }
  runtimeState.nextWaterReminderAt = now + getWaterDelayMs(settings);
  runtimeState.waterReminderPending = false;
  runtimeState.waterReminderPendingSince = 0;
  runtimeState.waterQueuedForNextBreak = false;
  runtimeState.sharedDsActiveMs = 0;
  runtimeState.sharedDsNextBreakTargetMs = getEyeBreakDelayMs(settings);
  runtimeState.sharedDsLastUpdateAt = now;
  runtimeState.sharedDsActiveTabId = 0;
  runtimeState.sharedDsIsActive = false;
  runtimeState.sharedDsContextKey = '';
  runtimeState.sharedDsState = SHARED_DS_TIMER_STATES.PAUSED;
  runtimeState.sharedDsPauseReason = SHARED_DS_PAUSE_REASONS.INACTIVE;
  runtimeState.lastPrimaryInterventionAt = 0;
  runtimeState.lastGentleReminderAt = 0;
}

function shouldRestartMainTimers(previousSettings, nextSettings) {
  return (
    previousSettings.enabled !== nextSettings.enabled ||
    previousSettings.timingMode !== nextSettings.timingMode ||
    previousSettings.customTimingEnabled !== nextSettings.customTimingEnabled ||
    previousSettings.reminderIntervalMin !== nextSettings.reminderIntervalMin ||
    previousSettings.reminderIntervalMax !== nextSettings.reminderIntervalMax ||
    previousSettings.eyeBreakDurationSec !== nextSettings.eyeBreakDurationSec ||
    previousSettings.hydrationReminderMin !== nextSettings.hydrationReminderMin ||
    previousSettings.subtleReminderMin !== nextSettings.subtleReminderMin ||
    previousSettings.subtleReminderMax !== nextSettings.subtleReminderMax ||
    previousSettings.subtleReminderEnabled !== nextSettings.subtleReminderEnabled
  );
}

function ensureDefaults({ freshSession = false } = {}) {
  chrome.storage.local.get(['settings', 'stats', 'runtimeState'], (result) => {
    const settings = mergeSettings(result.settings);
    const runtimeState = mergeRuntimeState(result.runtimeState);

    if (freshSession) {
      resetRuntimeStateFields(runtimeState, settings);
    } else if (
      !runtimeState.nextWaterReminderAt &&
      !runtimeState.waterReminderPending &&
      !runtimeState.waterQueuedForNextBreak
    ) {
      runtimeState.nextWaterReminderAt = Date.now() + getWaterDelayMs(settings);
    }

    chrome.storage.local.set({
      settings,
      stats: mergeStats(result.stats),
      runtimeState,
    });
  });
}

function ensureTickAlarm() {
  chrome.alarms.create('eyeflow-tick', { periodInMinutes: TICK_ALARM_PERIOD_MINUTES });
}

function ensureIdleDetection() {
  chrome.idle.setDetectionInterval(IDLE_DETECTION_INTERVAL_SECONDS);
}

function broadcastRuntimeReset(runtimeState) {
  broadcastToAllTabs({
    type: 'RESET_SESSION_TIMERS',
    snapshot: getSharedDsSnapshot(runtimeState),
  });
}

async function resetRuntimeStateForFreshSession(reason = 'manual') {
  const result = await chrome.storage.local.get(['settings', 'runtimeState']);
  const settings = mergeSettings(result.settings);
  const runtimeState = mergeRuntimeState(result.runtimeState);
  const now = Date.now();

  resetRuntimeStateFields(runtimeState, settings, now);
  await chrome.storage.local.set({ runtimeState });
  broadcastRuntimeReset(runtimeState);
}

// -------------------------------------------------------
// PATTERN ANALYSIS — Learn user's doom-scroll patterns
// -------------------------------------------------------
// This function looks at the history of doom-scroll sessions and
// finds patterns like "user scrolls most on Sundays at 11pm".
function analyzePatterns(sessions) {
  // If not enough data, return empty insights
  if (!sessions || sessions.length < 7) {
    return { hasEnoughData: false, riskTimes: [], topSites: [] };
  }

  // Count doom scrolls by day + hour combination
  const dayHourCounts = {}; // key: "day-hour", value: count
  const siteCounts = {}; // key: site domain, value: count

  sessions.forEach((session) => {
    // Track day + hour patterns
    const key = `${session.day}-${session.hour}`;
    dayHourCounts[key] = (dayHourCounts[key] || 0) + 1;

    // Track which sites cause the most doom scrolling
    siteCounts[session.site] = (siteCounts[session.site] || 0) + 1;
  });

  // Find the top 3 high-risk day+hour combos
  const riskTimes = Object.entries(dayHourCounts)
    .sort((a, b) => b[1] - a[1]) // Sort by count, highest first
    .slice(0, 3) // Take top 3
    .map(([key, count]) => {
      const [day, hour] = key.split('-').map(Number);
      return {
        day, // 0=Sun, 1=Mon, ...
        hour, // 0-23
        count, // How many times
        dayName: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][
          day
        ],
        timeLabel: formatHour(hour), // "11 PM", "3 AM", etc.
      };
    });

  // Find top 3 doom-scroll sites
  const topSites = Object.entries(siteCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([site, count]) => ({ site, count }));

  return { hasEnoughData: true, riskTimes, topSites };
}

// -------------------------------------------------------
// HELPER: Format hour number to readable string
// -------------------------------------------------------
// Takes 0-23 and returns "12 AM", "3 PM", etc.
function formatHour(hour) {
  if (hour === 0) return '12 AM';
  if (hour < 12) return `${hour} AM`;
  if (hour === 12) return '12 PM';
  return `${hour - 12} PM`;
}

// -------------------------------------------------------
// HELPER: Broadcast a message to ALL open tabs
// -------------------------------------------------------
// Used to notify all content scripts when settings change,
// snooze starts/ends, etc.
function broadcastToAllTabs(message) {
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach((tab) => {
      // Only send to tabs that can receive messages (have URLs)
      if (tab.id && tab.url && !tab.url.startsWith('chrome://')) {
        chrome.tabs.sendMessage(tab.id, message).catch(() => {
          // Tab might not have content script loaded — ignore the error
        });
      }
    });
  });
}

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.local.get(['settings', 'runtimeState'], (result) => {
    const settings = mergeSettings(result.settings);
    const runtimeState = mergeRuntimeState(result.runtimeState);

    if (runtimeState.sharedDsActiveTabId !== tabId) return;

    runtimeState.sharedDsActiveMs = 0;
    runtimeState.sharedDsNextBreakTargetMs = getNextSharedBreakTargetMs(settings);
    runtimeState.sharedDsLastUpdateAt = 0;
    runtimeState.sharedDsActiveTabId = 0;
    runtimeState.sharedDsIsActive = false;
    runtimeState.sharedDsContextKey = '';
    runtimeState.sharedDsState = SHARED_DS_TIMER_STATES.PAUSED;
    runtimeState.sharedDsPauseReason = SHARED_DS_PAUSE_REASONS.INACTIVE;

    chrome.storage.local.set({ runtimeState });
  });
});

chrome.windows.onRemoved.addListener(async () => {
  const windows = await chrome.windows.getAll({ windowTypes: ['normal'] });
  if (windows.length === 0) {
    await resetRuntimeStateForFreshSession('all-windows-closed');
  }
});
