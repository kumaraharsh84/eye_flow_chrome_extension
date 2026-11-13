/**
 * @file background.js
 * @description Manifest V3 service worker: the single owner of EyeFlow state.
 *
 * Responsibilities:
 *   1. Persist settings, stats and runtime timers in chrome.storage.local.
 *   2. Run the shared doom-scroll (DS) timer that content scripts feed with heartbeats.
 *   3. Tick every 30 seconds to deliver gentle, water and sound reminders.
 *   4. Roll daily/weekly stats, prune old data and post the weekly webhook report.
 *   5. Answer messages from the popup, onboarding page and content scripts.
 *
 * All state changes go through withState(), which serializes read-modify-write
 * cycles so two messages arriving together cannot overwrite each other.
 */

import { clampNumber, getBreakDelayMs, isValidWebhookUrl, TIMER_LIMITS } from './utils.js';

// -------------------------------------------------------
// DEFAULTS
// -------------------------------------------------------

const DEFAULT_SETTINGS = Object.freeze({
  enabled: true, // Master switch
  snoozedUntil: 0, // Work-mode snooze end timestamp (0 = not snoozed)
  sensitivity: 50, // 0-100; higher = eye breaks arrive sooner
  eyeBreakDurationSec: 20, // Length of the guided eye exercise
  hydrationBreakDurationSec: 40, // Length of the fullscreen water break
  reminderIntervalMin: 5, // Eye-break interval (minutes of active doom scrolling)
  reminderIntervalMax: 5, // Upper bound, used in surprise mode
  hydrationReminderMin: 60, // Minutes between water reminders
  subtleReminderEnabled: true, // Gentle reminders on normal pages
  subtleReminderMin: 25, // Gentle reminder interval (minutes)
  subtleReminderMax: 25, // Upper bound, used in surprise mode
  timingMode: 'fixed', // 'fixed' = exact intervals, 'surprise' = random within range
  soundReminderEnabled: false, // Chime while Chrome is open but not focused
  soundReminderMin: 20, // Sound reminder interval range (minutes)
  soundReminderMax: 30,
  popupTheme: 'dark', // 'dark' or 'light'
  webhookUrl: '', // Weekly report endpoint (https only)
  webhookRemovalHash: '', // Stretched salted SHA-256 of the removal PIN
  webhookRemovalSalt: '', // 128-bit random salt
});

const DEFAULT_STATS = Object.freeze({
  totalDoomScrollsBlocked: 0,
  totalEyeBreaksCompleted: 0,
  totalHydrationBreaksCompleted: 0,
  todayDoomScrollsBlocked: 0,
  todayEyeBreaksCompleted: 0,
  todayHydrationBreaksCompleted: 0,
  weekDoomScrollsBlocked: 0,
  weekEyeBreaksCompleted: 0,
  weekHydrationBreaksCompleted: 0,
  lastBreakTime: 0,
  lastResetDate: '', // Day the "today" counters were last reset
  lastWeekResetDate: '', // Monday of the week the "week" counters belong to
  moodHistory: [], // [{ mood, timestamp, site }]
  doomScrollSessions: [], // [{ site, day, hour, duration, timestamp, interrupted, swappedFrom }]
  todayDsSiteTimeSpent: {}, // { 'Instagram': minutes }
  weekDsSiteTimeSpent: {},
});

const GENTLE_STATES = Object.freeze({
  OFF: 'off',
  RUNNING: 'running',
  PAUSED: 'paused',
  DUE: 'due',
});

const DEFAULT_RUNTIME_STATE = Object.freeze({
  nextGentleReminderAt: 0,
  gentlePausedRemainingMs: 0,
  gentleState: GENTLE_STATES.OFF,
  nextWaterReminderAt: 0,
  waterReminderPending: false, // A fullscreen water break is showing on a DS tab
  waterReminderPendingSince: 0,
  waterQueuedForNextBreak: false, // Water prompt will ride along with the next eye break
  waterQueuedSince: 0,
  nextSoundReminderAt: 0,
  sharedDsActiveMs: 0, // Active doom-scroll time in the current break cycle
  sharedDsNextBreakTargetMs: 0,
  sharedDsLastUpdateAt: 0,
  sharedDsActiveTabId: 0,
  sharedDsLastTabId: 0, // Last tab that was doom scrolling, even if it is paused now
  sharedDsIsActive: false,
  sharedDsContextKey: '',
  lastBreakOverlayShownAt: 0,
  lastBreakCompletedAt: 0,
  currentSessionStartedAt: 0,
  currentSessionSite: '',
  currentSessionInterrupted: false,
  lastSessionEndedAt: 0,
  lastSessionSite: '',
  webhookRemovalFailures: 0,
  webhookRemovalLockedUntil: 0,
});

// -------------------------------------------------------
// CONSTANTS
// -------------------------------------------------------

const TICK_ALARM_NAME = 'eyeflow-tick';
const TICK_ALARM_PERIOD_MINUTES = 0.5;
const IDLE_DETECTION_INTERVAL_SECONDS = 60;

const SESSION_RESET_INACTIVITY_MS = 15 * 60 * 1000; // DS cycle resets after this long away
const STALE_HEARTBEAT_MS = 15 * 1000; // DS tab stopped reporting (crash, sleep, discard)
const BREAK_DUPLICATE_GUARD_MS = 60 * 1000;
const FEED_HOP_WINDOW_MS = 60 * 1000;
const MIN_SESSION_SECONDS = 5;
const MAX_SESSIONS = 200;
const MAX_MOODS = 100;
const MAX_AUDIT_LOGS = 500;
const MAX_TRACKED_SITE_LABELS = 30;
const DATA_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

const WATER_REMIND_SOON_DELAY_MS = 3 * 60 * 1000;
const WATER_PENDING_TIMEOUT_MS = 2 * 60 * 1000;
const WATER_QUEUE_TIMEOUT_MS = 10 * 60 * 1000;
const WATER_EYE_MERGE_WINDOW_MS = 3 * 60 * 1000;
const SOUND_REMINDER_RETRY_MS = 10 * 60 * 1000;

const WEBHOOK_PIN_MAX_FAILURES = 5;
const WEBHOOK_PIN_LOCKOUT_MS = 5 * 60 * 1000;
const WEBHOOK_TIMEOUT_MS = 15 * 1000;
const TAB_MESSAGE_TIMEOUT_MS = 2000;

const VALID_MOODS = new Set(['good', 'okay', 'bad']);
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const EXTENSION_ORIGIN = chrome.runtime.getURL('');

// Tabs that run doom-scroll tracking. Must mirror host_permissions in manifest.json
// and TRACKED_HOSTS in content.js.
const TRACKED_TAB_PATTERNS = [
  '*://*.instagram.com/*',
  '*://*.youtube.com/*',
  '*://*.reddit.com/*',
  '*://*.x.com/*',
  '*://*.twitter.com/*',
  '*://*.facebook.com/*',
  '*://*.tiktok.com/*',
  '*://*.snapchat.com/*',
  '*://*.linkedin.com/*',
  '*://*.twitch.tv/*',
];

// -------------------------------------------------------
// STATE ACCESS
// -------------------------------------------------------

const STATE_KEYS = ['settings', 'stats', 'runtimeState'];
let stateQueue = Promise.resolve();
let auditQueue = Promise.resolve();

/**
 * Runs `mutator` with exclusive access to { settings, stats, runtimeState } and
 * writes back only the keys that changed. Calls are queued, so every mutator sees
 * the result of the previous one.
 */
function withState(mutator) {
  const run = stateQueue.then(async () => {
    const stored = await chrome.storage.local.get(STATE_KEYS);
    const state = {
      settings: mergeSettings(stored.settings),
      stats: mergeStats(stored.stats),
      runtimeState: mergeRuntimeState(stored.runtimeState),
    };

    const result = await mutator(state);

    const patch = {};
    for (const key of STATE_KEYS) {
      if (JSON.stringify(state[key]) !== JSON.stringify(stored[key])) {
        patch[key] = state[key];
      }
    }
    if (Object.keys(patch).length > 0) {
      try {
        await chrome.storage.local.set(patch);
      } catch (error) {
        console.warn('[EyeFlow] storage write failed:', error?.message || error);
      }
    }
    return result;
  });

  stateQueue = run.catch(() => {});
  return run;
}

/** Appends an entry to the capped debug log that the popup can download. */
function addAuditLog(event, details = '') {
  auditQueue = auditQueue
    .then(async () => {
      const { auditLogs } = await chrome.storage.local.get(['auditLogs']);
      const logs = Array.isArray(auditLogs) ? auditLogs : [];
      const now = Date.now();
      logs.push({
        timestamp: now,
        timeString: new Date(now).toLocaleTimeString('en-US', { hour12: false }),
        event: String(event).slice(0, 80),
        details: String(details).slice(0, 300),
      });
      await chrome.storage.local.set({ auditLogs: logs.slice(-MAX_AUDIT_LOGS) });
    })
    .catch(() => {});
  return auditQueue;
}

function pruneAuditLogs(cutoff) {
  auditQueue = auditQueue
    .then(async () => {
      const { auditLogs } = await chrome.storage.local.get(['auditLogs']);
      if (!Array.isArray(auditLogs)) return;
      const pruned = auditLogs.filter((entry) => entry.timestamp >= cutoff);
      if (pruned.length !== auditLogs.length) {
        await chrome.storage.local.set({ auditLogs: pruned });
      }
    })
    .catch(() => {});
}

// -------------------------------------------------------
// MERGE / NORMALIZE
// -------------------------------------------------------

/**
 * Builds a complete, validated settings object from stored and incoming values.
 * Unknown keys are dropped so stale or injected fields never reach storage.
 */
function mergeSettings(...sources) {
  const merged = { ...DEFAULT_SETTINGS };
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue;
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      if (source[key] !== undefined && source[key] !== null) merged[key] = source[key];
    }
  }

  const limit = (key, minOverride) => {
    const { min, max, fallback } = TIMER_LIMITS[key];
    const floor = Math.max(min, minOverride ?? min);
    return clampNumber(merged[key], floor, max, Math.max(floor, fallback));
  };

  merged.enabled = Boolean(merged.enabled);
  merged.subtleReminderEnabled = Boolean(merged.subtleReminderEnabled);
  merged.soundReminderEnabled = Boolean(merged.soundReminderEnabled);
  merged.snoozedUntil = Math.max(0, Number(merged.snoozedUntil) || 0);
  merged.sensitivity = clampNumber(merged.sensitivity, 0, 100, DEFAULT_SETTINGS.sensitivity);
  merged.popupTheme = merged.popupTheme === 'light' ? 'light' : 'dark';
  merged.timingMode = merged.timingMode === 'surprise' ? 'surprise' : 'fixed';
  merged.hydrationBreakDurationSec = clampNumber(
    merged.hydrationBreakDurationSec,
    15,
    60,
    DEFAULT_SETTINGS.hydrationBreakDurationSec
  );

  merged.eyeBreakDurationSec = limit('eyeBreakDurationSec');
  merged.hydrationReminderMin = limit('hydrationReminderMin');
  merged.reminderIntervalMin = clampNumber(
    merged.reminderIntervalMin,
    TIMER_LIMITS.doomReminderMin.min,
    TIMER_LIMITS.doomReminderMin.max,
    TIMER_LIMITS.doomReminderMin.fallback
  );
  merged.reminderIntervalMax = clampNumber(
    merged.reminderIntervalMax,
    merged.reminderIntervalMin,
    TIMER_LIMITS.doomReminderMax.max,
    merged.reminderIntervalMin
  );
  merged.subtleReminderMin = limit('subtleReminderMin');
  merged.subtleReminderMax = limit('subtleReminderMax', merged.subtleReminderMin);
  merged.soundReminderMin = limit('soundReminderMin');
  merged.soundReminderMax = limit('soundReminderMax', merged.soundReminderMin);

  if (merged.timingMode === 'fixed') {
    merged.reminderIntervalMax = merged.reminderIntervalMin;
    merged.subtleReminderMax = merged.subtleReminderMin;
  }

  merged.webhookUrl = isValidWebhookUrl(merged.webhookUrl) ? merged.webhookUrl.trim() : '';
  merged.webhookRemovalHash = merged.webhookUrl ? String(merged.webhookRemovalHash || '') : '';
  merged.webhookRemovalSalt = merged.webhookUrl ? String(merged.webhookRemovalSalt || '') : '';

  // The weekly report (sibling monitor) keeps the extension locked on.
  if (merged.webhookUrl) merged.enabled = true;

  return merged;
}

function mergeStats(source) {
  const merged = {};
  for (const key of Object.keys(DEFAULT_STATS)) {
    merged[key] = source?.[key] ?? DEFAULT_STATS[key];
  }
  merged.moodHistory = Array.isArray(source?.moodHistory) ? [...source.moodHistory] : [];
  merged.doomScrollSessions = Array.isArray(source?.doomScrollSessions)
    ? [...source.doomScrollSessions]
    : [];
  merged.todayDsSiteTimeSpent = { ...(source?.todayDsSiteTimeSpent || {}) };
  merged.weekDsSiteTimeSpent = { ...(source?.weekDsSiteTimeSpent || {}) };
  return merged;
}

function mergeRuntimeState(source) {
  const merged = {};
  for (const key of Object.keys(DEFAULT_RUNTIME_STATE)) {
    merged[key] = source?.[key] ?? DEFAULT_RUNTIME_STATE[key];
  }
  if (!Object.values(GENTLE_STATES).includes(merged.gentleState)) {
    merged.gentleState = merged.nextGentleReminderAt ? GENTLE_STATES.RUNNING : GENTLE_STATES.PAUSED;
  }
  return merged;
}

/** Settings as content scripts may see them: no webhook URL, hash or salt. */
function buildSettingsForContent(settings) {
  const safeSettings = { ...settings };
  delete safeSettings.webhookUrl;
  delete safeSettings.webhookRemovalHash;
  delete safeSettings.webhookRemovalSalt;
  return safeSettings;
}

/** Settings as extension pages may see them: the URL, but never the PIN hash or salt. */
function buildSettingsForPopup(settings) {
  const popupSettings = { ...settings };
  delete popupSettings.webhookRemovalHash;
  delete popupSettings.webhookRemovalSalt;
  return popupSettings;
}

// -------------------------------------------------------
// TIMING HELPERS
// -------------------------------------------------------

function isSnoozed(settings, now = Date.now()) {
  return settings.snoozedUntil > 0 && now < settings.snoozedUntil;
}

function getRandomInt(min, max) {
  const low = Math.min(min, max);
  const high = Math.max(min, max);
  return Math.floor(Math.random() * (high - low + 1)) + low;
}

function pickIntervalMinutes(settings, minKey, maxKey) {
  return settings.timingMode === 'surprise'
    ? getRandomInt(settings[minKey], settings[maxKey])
    : settings[minKey];
}

function getNextBreakTargetMs(settings) {
  const minutes = pickIntervalMinutes(settings, 'reminderIntervalMin', 'reminderIntervalMax');
  return getBreakDelayMs(minutes, settings.sensitivity);
}

function getGentleDelayMs(settings) {
  return pickIntervalMinutes(settings, 'subtleReminderMin', 'subtleReminderMax') * 60 * 1000;
}

function getWaterDelayMs(settings) {
  // A few minutes of jitter keeps the reminder from feeling mechanical.
  return (settings.hydrationReminderMin + getRandomInt(0, 5)) * 60 * 1000;
}

function getSoundDelayMs(settings) {
  return getRandomInt(settings.soundReminderMin, settings.soundReminderMax) * 60 * 1000;
}

function formatHour(hour) {
  if (hour === 0) return '12 AM';
  if (hour < 12) return `${hour} AM`;
  if (hour === 12) return '12 PM';
  return `${hour - 12} PM`;
}

/** Date string of the Monday that starts the week containing `now`. */
function getWeekStartKey(now) {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return date.toDateString();
}

// -------------------------------------------------------
// GENTLE REMINDER TIMER
// -------------------------------------------------------

function scheduleNextGentleReminder(runtimeState, settings, now) {
  runtimeState.nextGentleReminderAt = now + getGentleDelayMs(settings);
  runtimeState.gentlePausedRemainingMs = 0;
  runtimeState.gentleState = GENTLE_STATES.RUNNING;
}

function setGentleReminderOff(runtimeState) {
  runtimeState.nextGentleReminderAt = 0;
  runtimeState.gentlePausedRemainingMs = 0;
  runtimeState.gentleState = GENTLE_STATES.OFF;
}

function pauseGentleReminder(runtimeState, now) {
  if (runtimeState.nextGentleReminderAt > 0) {
    runtimeState.gentlePausedRemainingMs = Math.max(1000, runtimeState.nextGentleReminderAt - now);
    runtimeState.nextGentleReminderAt = 0;
  }
  runtimeState.gentleState = GENTLE_STATES.PAUSED;
}

/**
 * Puts the gentle timer in the state the current situation calls for:
 * off when the feature is disabled, held while doom scrolling or snoozed
 * (remaining time preserved), running otherwise.
 */
function syncGentleTimer({ settings, runtimeState }, now) {
  if (!settings.subtleReminderEnabled) {
    setGentleReminderOff(runtimeState);
    return;
  }

  if (runtimeState.sharedDsIsActive || isSnoozed(settings, now)) {
    pauseGentleReminder(runtimeState, now);
    return;
  }

  if (!runtimeState.nextGentleReminderAt) {
    if (runtimeState.gentlePausedRemainingMs > 0) {
      runtimeState.nextGentleReminderAt = now + runtimeState.gentlePausedRemainingMs;
      runtimeState.gentlePausedRemainingMs = 0;
      runtimeState.gentleState = GENTLE_STATES.RUNNING;
    } else {
      scheduleNextGentleReminder(runtimeState, settings, now);
    }
  } else if (runtimeState.gentleState !== GENTLE_STATES.DUE) {
    runtimeState.gentleState = GENTLE_STATES.RUNNING;
  }
}

// -------------------------------------------------------
// SHARED DOOM-SCROLL TIMER
// -------------------------------------------------------

/** Closes the running DS session and records it for stats and the weekly report. */
function endDsSession({ runtimeState, stats }, endTime) {
  const start = runtimeState.currentSessionStartedAt;
  const site = runtimeState.currentSessionSite;

  if (start > 0 && site) {
    const durationSec = Math.round((endTime - start) / 1000);
    if (durationSec >= MIN_SESSION_SECONDS) {
      const hoppedFromOtherFeed =
        runtimeState.lastSessionSite &&
        runtimeState.lastSessionSite !== site &&
        runtimeState.lastSessionEndedAt > 0 &&
        start - runtimeState.lastSessionEndedAt < FEED_HOP_WINDOW_MS;
      const swappedFrom = hoppedFromOtherFeed ? runtimeState.lastSessionSite : null;
      if (swappedFrom) addAuditLog('Feed-Hop Detected', `${swappedFrom} -> ${site}`);

      const startDate = new Date(start);
      stats.doomScrollSessions.push({
        site,
        day: startDate.getDay(),
        hour: startDate.getHours(),
        duration: durationSec,
        timestamp: start,
        interrupted: Boolean(runtimeState.currentSessionInterrupted),
        swappedFrom,
      });
      if (stats.doomScrollSessions.length > MAX_SESSIONS) {
        stats.doomScrollSessions = stats.doomScrollSessions.slice(-MAX_SESSIONS);
      }

      runtimeState.lastSessionEndedAt = endTime;
      runtimeState.lastSessionSite = site;
    }
  }

  runtimeState.currentSessionStartedAt = 0;
  runtimeState.currentSessionSite = '';
  runtimeState.currentSessionInterrupted = false;
}

function pauseSharedDs(state, endTime) {
  const { runtimeState } = state;
  if (runtimeState.sharedDsIsActive) endDsSession(state, endTime);
  runtimeState.sharedDsIsActive = false;
  runtimeState.sharedDsActiveTabId = 0;
  runtimeState.sharedDsContextKey = '';
}

/** Starts a fresh break cycle with a newly rolled target. */
function resetBreakCycle({ settings, runtimeState }, now) {
  runtimeState.sharedDsActiveMs = 0;
  runtimeState.sharedDsNextBreakTargetMs = getNextBreakTargetMs(settings);
  runtimeState.sharedDsLastUpdateAt = now;
  const minutes = (runtimeState.sharedDsNextBreakTargetMs / 60000).toFixed(1);
  addAuditLog(
    'Break Target Generated',
    `${minutes} min (${settings.timingMode} mode, sensitivity ${settings.sensitivity})`
  );
}

/**
 * Credits the time since the last heartbeat to the DS timer. Gaps longer than a
 * few heartbeats are never credited: they mean the tab went away (crash, sleep,
 * discard) rather than that the user kept scrolling.
 */
function advanceSharedDs(state, now) {
  const { runtimeState } = state;
  const last = runtimeState.sharedDsLastUpdateAt;
  runtimeState.sharedDsLastUpdateAt = now;
  if (!last) return;

  const gap = now - last;
  if (gap >= SESSION_RESET_INACTIVITY_MS) {
    pauseSharedDs(state, last);
    runtimeState.sharedDsActiveMs = 0;
    return;
  }
  if (!runtimeState.sharedDsIsActive) return;
  if (gap > STALE_HEARTBEAT_MS) {
    pauseSharedDs(state, last);
    return;
  }
  runtimeState.sharedDsActiveMs += gap;
}

function getSharedDsSnapshot({ settings, runtimeState }) {
  return {
    enabled: settings.enabled,
    activeMs: runtimeState.sharedDsActiveMs,
    nextBreakTargetMs: runtimeState.sharedDsNextBreakTargetMs,
    lastBreakOverlayShownAt: runtimeState.lastBreakOverlayShownAt,
  };
}

// -------------------------------------------------------
// RUNTIME STATE RESETS
// -------------------------------------------------------

function resetWaterTimer(runtimeState, nextAt) {
  runtimeState.nextWaterReminderAt = nextAt;
  runtimeState.waterReminderPending = false;
  runtimeState.waterReminderPendingSince = 0;
  runtimeState.waterQueuedForNextBreak = false;
  runtimeState.waterQueuedSince = 0;
}

/** Resets every timer. Session history and the webhook PIN lockout are kept. */
function resetRuntimeState(state, now) {
  const { settings, runtimeState } = state;
  pauseSharedDs(state, now);

  Object.assign(runtimeState, DEFAULT_RUNTIME_STATE, {
    lastSessionEndedAt: runtimeState.lastSessionEndedAt,
    lastSessionSite: runtimeState.lastSessionSite,
    webhookRemovalFailures: runtimeState.webhookRemovalFailures,
    webhookRemovalLockedUntil: runtimeState.webhookRemovalLockedUntil,
  });

  if (!settings.enabled) return;

  runtimeState.nextWaterReminderAt = now + getWaterDelayMs(settings);
  resetBreakCycle(state, now);
  syncGentleTimer(state, now);
}

/** Turns everything off without rolling new timers. Idempotent while disabled. */
function clearRuntimeStateForDisabled(state, now) {
  const { runtimeState } = state;
  const isAlreadyCleared =
    !runtimeState.sharedDsIsActive &&
    !runtimeState.sharedDsNextBreakTargetMs &&
    !runtimeState.nextWaterReminderAt &&
    runtimeState.gentleState === GENTLE_STATES.OFF;
  if (!isAlreadyCleared) resetRuntimeState(state, now);
}

/** Applies a settings change, restarting only the timers the change affects. */
function applySettingsChange(state, previous, now) {
  const { settings, runtimeState } = state;
  if (!settings.enabled) {
    clearRuntimeStateForDisabled(state, now);
    return;
  }

  const turnedOn = !previous.enabled;
  const changed = (...keys) => keys.some((key) => previous[key] !== settings[key]);

  if (
    turnedOn ||
    changed('timingMode', 'reminderIntervalMin', 'reminderIntervalMax', 'sensitivity')
  ) {
    resetBreakCycle(state, now);
  }
  if (
    turnedOn ||
    changed('timingMode', 'subtleReminderMin', 'subtleReminderMax', 'subtleReminderEnabled')
  ) {
    setGentleReminderOff(runtimeState);
  }
  if (turnedOn || changed('hydrationReminderMin')) {
    resetWaterTimer(runtimeState, now + getWaterDelayMs(settings));
  }
  if (isSnoozed(settings, now) || !settings.soundReminderEnabled) {
    runtimeState.nextSoundReminderAt = 0;
  }
  syncGentleTimer(state, now);
}

// -------------------------------------------------------
// TAB MESSAGING
// -------------------------------------------------------

/** Sends a message to a tab; resolves null when nothing answers in time. */
function sendTabMessage(tabId, message) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), TAB_MESSAGE_TIMEOUT_MS);
  });
  const request = chrome.tabs.sendMessage(tabId, message).catch(() => null);
  return Promise.race([request, timeout]).finally(() => clearTimeout(timer));
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab?.id ? tab : null;
}

/** Only tabs on tracked sites keep local timers, so only they need broadcasts. */
async function broadcastToTrackedTabs(message) {
  try {
    const tabs = await chrome.tabs.query({ url: TRACKED_TAB_PATTERNS });
    for (const tab of tabs) {
      if (tab.id) chrome.tabs.sendMessage(tab.id, message).catch(() => {});
    }
  } catch (error) {
    // No matching tabs, or the tabs API is unavailable during shutdown
  }
}

async function getBrowserEnvironment() {
  const [idleState, windows] = await Promise.all([
    chrome.idle.queryState(IDLE_DETECTION_INTERVAL_SECONDS),
    chrome.windows.getAll({ windowTypes: ['normal'] }),
  ]);
  return {
    idleState,
    hasChromeWindow: windows.length > 0,
    chromeFocused: windows.some((windowInfo) => windowInfo.focused),
  };
}

// -------------------------------------------------------
// REMINDER DELIVERY
// -------------------------------------------------------

async function showWaterNotification() {
  try {
    await chrome.notifications.create('eyeflow-water-reminder', {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'EyeFlow water reminder',
      message: 'Take a few sips of water when you get a moment.',
    });
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Picks the right water reminder for where the user is:
 *   'queued'       doom scrolling with an eye break close: merge into that break
 *   'popup'        doom scrolling: fullscreen water break
 *   'gentle'       normal page: small toast
 *   'notification' Chrome not focused, or the page cannot show a toast
 */
async function deliverWaterReminder(settings, environment) {
  if (environment.chromeFocused) {
    const tab = await getActiveTab();
    const context = tab && (await sendTabMessage(tab.id, { type: 'GET_PAGE_REMINDER_CONTEXT' }));

    if (context?.isDoomScrollContext) {
      const msUntilBreak = context.msUntilEyeBreak;
      if (typeof msUntilBreak === 'number' && msUntilBreak <= WATER_EYE_MERGE_WINDOW_MS) {
        return 'queued';
      }
      const response = await sendTabMessage(tab.id, {
        type: 'SHOW_HYDRATION_POPUP',
        settings: buildSettingsForContent(settings),
      });
      if (response?.accepted) return 'popup';
    } else if (context) {
      const response = await sendTabMessage(tab.id, {
        type: 'SHOW_GENTLE_REMINDER',
        variant: 'water',
      });
      if (response?.shown) return 'gentle';
    }
  }

  return (await showWaterNotification()) ? 'notification' : 'failed';
}

async function runWaterReminder(state, now, environment) {
  const { settings, runtimeState } = state;

  // A water break that was never answered (tab closed, page navigated): try again soon.
  if (
    runtimeState.waterReminderPending &&
    now - runtimeState.waterReminderPendingSince >= WATER_PENDING_TIMEOUT_MS
  ) {
    resetWaterTimer(runtimeState, now + WATER_REMIND_SOON_DELAY_MS);
  }

  // The eye break the prompt was waiting for never came: deliver it on its own.
  if (
    runtimeState.waterQueuedForNextBreak &&
    now - runtimeState.waterQueuedSince >= WATER_QUEUE_TIMEOUT_MS
  ) {
    resetWaterTimer(runtimeState, now);
  }

  if (runtimeState.waterReminderPending || runtimeState.waterQueuedForNextBreak) return;

  if (!runtimeState.nextWaterReminderAt) {
    runtimeState.nextWaterReminderAt = now + getWaterDelayMs(settings);
    return;
  }
  if (now < runtimeState.nextWaterReminderAt) return;

  // Nobody is at the computer: hold the reminder until they are back.
  if (environment.idleState !== 'active') return;

  const result = await deliverWaterReminder(settings, environment);
  if (result === 'queued') {
    runtimeState.waterQueuedForNextBreak = true;
    runtimeState.waterQueuedSince = now;
    runtimeState.nextWaterReminderAt = 0;
  } else if (result === 'popup') {
    runtimeState.waterReminderPending = true;
    runtimeState.waterReminderPendingSince = now;
    runtimeState.nextWaterReminderAt = 0;
  } else if (result !== 'failed') {
    resetWaterTimer(runtimeState, now + getWaterDelayMs(settings));
  }
}

async function runGentleReminder(state, now, environment) {
  const { settings, runtimeState } = state;
  syncGentleTimer(state, now);

  const isCounting =
    runtimeState.gentleState === GENTLE_STATES.RUNNING ||
    runtimeState.gentleState === GENTLE_STATES.DUE;
  if (!isCounting || now < runtimeState.nextGentleReminderAt) return;

  // Stays "due" until there is a focused, suitable page to show it on.
  runtimeState.gentleState = GENTLE_STATES.DUE;
  if (!environment.chromeFocused || environment.idleState !== 'active') return;

  const tab = await getActiveTab();
  const response = tab && (await sendTabMessage(tab.id, { type: 'SHOW_GENTLE_REMINDER' }));
  if (response?.shown) scheduleNextGentleReminder(runtimeState, settings, now);
}

/** Chimes while Chrome is open in the background, if the user opted in. */
async function runSoundReminder(state, now, environment) {
  const { settings, runtimeState } = state;
  const eligible =
    settings.soundReminderEnabled &&
    !isSnoozed(settings, now) &&
    environment.hasChromeWindow &&
    !environment.chromeFocused &&
    environment.idleState !== 'locked';

  if (!eligible) {
    runtimeState.nextSoundReminderAt = 0;
    return;
  }
  if (!runtimeState.nextSoundReminderAt) {
    runtimeState.nextSoundReminderAt = now + getSoundDelayMs(settings);
    return;
  }
  if (now < runtimeState.nextSoundReminderAt || environment.idleState !== 'active') return;

  const played = await playReminderSound();
  runtimeState.nextSoundReminderAt =
    now + (played ? getSoundDelayMs(settings) : SOUND_REMINDER_RETRY_MS);
}

async function playReminderSound() {
  try {
    await ensureOffscreenDocument();
    const response = await chrome.runtime.sendMessage({ type: 'PLAY_REMINDER_SOUND' });
    return Boolean(response?.success);
  } catch (error) {
    return false;
  }
}

/** Service workers cannot play audio; a hidden offscreen document does it for us. */
async function ensureOffscreenDocument() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL('offscreen.html')],
  });
  if (contexts.length > 0) return;

  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['AUDIO_PLAYBACK'],
    justification: 'Play a short eye-care reminder chime while Chrome is in the background.',
  });
}

// -------------------------------------------------------
// STATS ROLLOVER & WEEKLY REPORT
// -------------------------------------------------------

/**
 * Resets the daily counters on a new day and the weekly counters on a new week.
 * Returns a weekly report ({ url, payload }) when one is due, built before the reset.
 */
function rollOverStats({ settings, stats }, now) {
  const today = new Date(now).toDateString();
  if (stats.lastResetDate === today) return null;

  // First run after install: there is no previous day to close, only dates to record.
  if (!stats.lastResetDate) {
    stats.lastResetDate = today;
    stats.lastWeekResetDate = stats.lastWeekResetDate || getWeekStartKey(now);
    return null;
  }

  stats.todayDoomScrollsBlocked = 0;
  stats.todayEyeBreaksCompleted = 0;
  stats.todayHydrationBreaksCompleted = 0;
  stats.todayDsSiteTimeSpent = {};
  stats.lastResetDate = today;

  const cutoff = now - DATA_RETENTION_MS;
  stats.doomScrollSessions = stats.doomScrollSessions.filter((s) => s.timestamp >= cutoff);
  stats.moodHistory = stats.moodHistory.filter((m) => m.timestamp >= cutoff);
  pruneAuditLogs(cutoff);

  const weekKey = getWeekStartKey(now);
  if (!stats.lastWeekResetDate) {
    stats.lastWeekResetDate = weekKey;
    return null;
  }
  if (stats.lastWeekResetDate === weekKey) return null;

  const report = settings.webhookUrl
    ? { url: settings.webhookUrl, payload: buildWeeklyReport(stats, now) }
    : null;

  stats.weekDoomScrollsBlocked = 0;
  stats.weekEyeBreaksCompleted = 0;
  stats.weekHydrationBreaksCompleted = 0;
  stats.weekDsSiteTimeSpent = {};
  stats.lastWeekResetDate = weekKey;
  return report;
}

/** Finds the days/hours and sites where doom scrolling happens most. */
function analyzePatterns(sessions) {
  if (!Array.isArray(sessions) || sessions.length < 7) {
    return { hasEnoughData: false, riskTimes: [], topSites: [] };
  }

  const dayHourCounts = {};
  const siteCounts = {};
  for (const session of sessions) {
    const key = `${session.day}-${session.hour}`;
    dayHourCounts[key] = (dayHourCounts[key] || 0) + 1;
    siteCounts[session.site] = (siteCounts[session.site] || 0) + 1;
  }

  const topThree = (counts) =>
    Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);

  return {
    hasEnoughData: true,
    riskTimes: topThree(dayHourCounts).map(([key, count]) => {
      const [day, hour] = key.split('-').map(Number);
      return { day, hour, count, dayName: DAY_NAMES[day], timeLabel: formatHour(hour) };
    }),
    topSites: topThree(siteCounts).map(([site, count]) => ({ site, count })),
  };
}

function buildWeeklyReport(stats, now = Date.now()) {
  const siteTimeLines = Object.entries(stats.weekDsSiteTimeSpent)
    .sort((a, b) => b[1] - a[1])
    .map(([site, minutes]) => `${site}: ${Math.round(minutes)} minutes`)
    .join('\n');

  const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;
  const recentSessions = stats.doomScrollSessions
    .filter((s) => s.timestamp >= oneWeekAgo)
    .sort((a, b) => b.timestamp - a.timestamp);

  const hopTransitions = {};
  let feedHopsCount = 0;
  for (const session of recentSessions) {
    if (!session.swappedFrom) continue;
    feedHopsCount++;
    const key = `${session.swappedFrom} -> ${session.site}`;
    hopTransitions[key] = (hopTransitions[key] || 0) + 1;
  }
  const topTransitions = Object.entries(hopTransitions)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([transition, count]) => `${transition} (${count} times)`)
    .join(', ');

  const sessionLines = recentSessions
    .slice(0, 30)
    .map((s) => {
      const date = new Date(s.timestamp);
      const time = date.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      });
      const duration = s.duration >= 60 ? `${(s.duration / 60).toFixed(1)}m` : `${s.duration}s`;
      const outcome = s.interrupted ? ' [Eye break shown]' : ' [No eye break]';
      const hop = s.swappedFrom ? ` (swapped from ${s.swappedFrom})` : '';
      return `- ${DAY_NAMES[date.getDay()]} ${time} | ${s.site} | Duration: ${duration}${outcome}${hop}`;
    })
    .join('\n');

  const completedShare = stats.weekEyeBreaksCompleted / stats.weekDoomScrollsBlocked;
  const complianceRate =
    stats.weekDoomScrollsBlocked > 0 ? `${Math.min(100, completedShare * 100).toFixed(1)}%` : 'n/a';

  const patterns = analyzePatterns(recentSessions);
  const peakWindow = patterns.riskTimes.length
    ? `${patterns.riskTimes[0].dayName}s around ${patterns.riskTimes[0].timeLabel}`
    : 'No clear peak yet';

  const message = [
    'Here is the weekly doom-scrolling report:',
    '',
    `Eye breaks triggered: ${stats.weekDoomScrollsBlocked}`,
    `Eye breaks completed: ${stats.weekEyeBreaksCompleted}`,
    `Compliance rate: ${complianceRate}`,
    `Water breaks taken: ${stats.weekHydrationBreaksCompleted}`,
    `Peak doom-scrolling window: ${peakWindow}`,
    '',
    'Time spent on doom-scrolling sites:',
    siteTimeLines || 'No doom-scrolling time recorded this week.',
    '',
    'Feed-hopping:',
    `- Total app swaps: ${feedHopsCount}`,
    `- Most common: ${topTransitions || 'None'}`,
    '',
    'Session log (last 30 sessions):',
    sessionLines || 'No sessions recorded.',
  ].join('\n');

  return {
    subject: 'EyeFlow Weekly Report',
    message,
    stats: {
      weekDoomScrollsBlocked: stats.weekDoomScrollsBlocked,
      weekEyeBreaksCompleted: stats.weekEyeBreaksCompleted,
      complianceRate,
      weekHydrationBreaksCompleted: stats.weekHydrationBreaksCompleted,
      peakWindow,
      weekDsSiteTimeSpent: { ...stats.weekDsSiteTimeSpent },
      feedHopsCount,
      topTransitions,
      recentSessions: recentSessions.slice(0, 30),
    },
  };
}

async function postWeeklyReport(url, payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!response.ok) {
      addAuditLog('Weekly Report Failed', `Webhook answered HTTP ${response.status}`);
      return { success: false, error: `Webhook answered HTTP ${response.status}` };
    }
    addAuditLog('Weekly Report Sent', 'Webhook accepted the report');
    return { success: true };
  } catch (error) {
    const reason = error?.name === 'AbortError' ? 'Webhook timed out' : 'Could not reach webhook';
    addAuditLog('Weekly Report Failed', reason);
    return { success: false, error: reason };
  } finally {
    clearTimeout(timer);
  }
}

// -------------------------------------------------------
// WEBHOOK REMOVAL PIN
// -------------------------------------------------------

function generateSecure6DigitPin() {
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  return String(100000 + (array[0] % 900000));
}

function generateSecureSalt() {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Salted SHA-256 stretched over 5,000 rounds; returns a 64-character hex string. */
async function hashPinWithSalt(pin, salt) {
  const encoder = new TextEncoder();
  const safeSalt = String(salt || '').trim();
  const safePin = String(pin || '').trim();

  let hashBuffer = await crypto.subtle.digest(
    'SHA-256',
    encoder.encode(`EyeFlow:${safeSalt}:${safePin}:${safeSalt}`)
  );
  for (let i = 0; i < 5000; i++) {
    hashBuffer = await crypto.subtle.digest('SHA-256', hashBuffer);
  }

  return Array.from(new Uint8Array(hashBuffer), (b) => b.toString(16).padStart(2, '0')).join('');
}

// -------------------------------------------------------
// PERIODIC TICK
// -------------------------------------------------------

async function runTick(state, now) {
  const { settings, runtimeState } = state;

  if (settings.snoozedUntil > 0 && now >= settings.snoozedUntil) {
    settings.snoozedUntil = 0;
  }

  const report = rollOverStats(state, now);

  if (!settings.enabled) {
    clearRuntimeStateForDisabled(state, now);
    return report;
  }

  // The DS tab stopped sending heartbeats without saying goodbye.
  if (
    runtimeState.sharedDsIsActive &&
    now - runtimeState.sharedDsLastUpdateAt > STALE_HEARTBEAT_MS
  ) {
    pauseSharedDs(state, runtimeState.sharedDsLastUpdateAt);
  }
  if (!runtimeState.sharedDsNextBreakTargetMs) resetBreakCycle(state, now);

  const environment = await getBrowserEnvironment();
  await runWaterReminder(state, now, environment);
  await runGentleReminder(state, now, environment);
  await runSoundReminder(state, now, environment);
  return report;
}

// -------------------------------------------------------
// MESSAGE HANDLERS
// -------------------------------------------------------

function isExtensionPage(sender) {
  return sender?.id === chrome.runtime.id && String(sender.url || '').startsWith(EXTENSION_ORIGIN);
}

/** Handlers any EyeFlow context (content script or extension page) may call. */
const MESSAGE_HANDLERS = {
  GET_SETTINGS: (message, sender) =>
    withState(({ settings }) =>
      isExtensionPage(sender) ? buildSettingsForPopup(settings) : buildSettingsForContent(settings)
    ),

  // Everything a tracked tab needs on load, in one round trip.
  GET_CONTENT_BOOTSTRAP: async () => {
    const [idleState, data] = await Promise.all([
      chrome.idle.queryState(IDLE_DETECTION_INTERVAL_SECONDS),
      withState((state) => {
        if (state.settings.enabled && !state.runtimeState.sharedDsNextBreakTargetMs) {
          resetBreakCycle(state, Date.now());
        }
        return {
          settings: buildSettingsForContent(state.settings),
          sharedDs: getSharedDsSnapshot(state),
        };
      }),
    ]);
    return { ...data, idleState };
  },

  GET_SHARED_DS_STATE: () =>
    withState((state) => {
      if (state.settings.enabled && !state.runtimeState.sharedDsNextBreakTargetMs) {
        resetBreakCycle(state, Date.now());
      }
      return getSharedDsSnapshot(state);
    }),

  // Heartbeat from a tab on a tracked site: is the user actively doom scrolling there?
  SYNC_SHARED_DS_STATE: (message, sender) =>
    withState((state) => {
      const { settings, runtimeState } = state;
      const tabId = sender?.tab?.id || 0;
      if (!settings.enabled || !tabId) return getSharedDsSnapshot(state);

      const now = Date.now();
      if (!runtimeState.sharedDsNextBreakTargetMs) resetBreakCycle(state, now);
      advanceSharedDs(state, now);

      if (message.isActive) {
        const site = String(message.site || 'Unknown').slice(0, 40);
        const siteChanged =
          runtimeState.sharedDsIsActive && runtimeState.currentSessionSite !== site;

        if (siteChanged) endDsSession(state, now);
        if (!runtimeState.sharedDsIsActive || siteChanged) {
          runtimeState.currentSessionStartedAt = now;
          runtimeState.currentSessionSite = site;
          runtimeState.currentSessionInterrupted = false;
          addAuditLog('Doom Scroll Session Started', `${site} (tab ${tabId})`);
        }
        runtimeState.sharedDsIsActive = true;
        runtimeState.sharedDsActiveTabId = tabId;
        runtimeState.sharedDsLastTabId = tabId;
        runtimeState.sharedDsContextKey = String(message.contextKey || '').slice(0, 80);
      } else if (runtimeState.sharedDsIsActive && runtimeState.sharedDsActiveTabId === tabId) {
        addAuditLog('Doom Scroll Session Paused', `Tab ${tabId} reported inactive`);
        pauseSharedDs(state, now);
      }

      syncGentleTimer(state, now);
      return getSharedDsSnapshot(state);
    }),

  REPORT_DS_SITE_TIME: (message, sender) =>
    withState(({ settings, stats }) => {
      const site = String(message.site || '').slice(0, 40);
      const minutes = clampNumber(message.minutes, 0, 30, 0);
      if (!settings.enabled || !sender?.tab || !site || minutes <= 0) return { success: false };

      for (const bucket of [stats.todayDsSiteTimeSpent, stats.weekDsSiteTimeSpent]) {
        if (!(site in bucket) && Object.keys(bucket).length >= MAX_TRACKED_SITE_LABELS) continue;
        bucket[site] = (bucket[site] || 0) + minutes;
      }
      return { success: true };
    }),

  // A tab's break timer ran out. Decide whether it may show the eye-break overlay.
  DOOM_SCROLL_DETECTED: (message) =>
    withState((state) => {
      const { settings, stats, runtimeState } = state;
      const now = Date.now();
      const shownRecently = now - runtimeState.lastBreakOverlayShownAt < BREAK_DUPLICATE_GUARD_MS;
      if (!settings.enabled || shownRecently) return { action: 'IGNORE' };

      stats.totalDoomScrollsBlocked++;
      stats.todayDoomScrollsBlocked++;
      stats.weekDoomScrollsBlocked++;
      runtimeState.lastBreakOverlayShownAt = now;
      runtimeState.currentSessionInterrupted = true;
      addAuditLog('Eye Break Triggered', String(message.site || 'unknown site'));

      return {
        action: 'INTERVENE',
        settings: buildSettingsForContent(settings),
        hydrationPrompt: runtimeState.waterQueuedForNextBreak,
      };
    }),

  EYE_BREAK_COMPLETED: () =>
    withState((state) => {
      const { stats, runtimeState } = state;
      const now = Date.now();
      stats.totalEyeBreaksCompleted++;
      stats.todayEyeBreaksCompleted++;
      stats.weekEyeBreaksCompleted++;
      stats.lastBreakTime = now;
      runtimeState.lastBreakCompletedAt = now;
      resetBreakCycle(state, now);
      addAuditLog('Eye Break Completed', 'Exercise finished');
      return { success: true };
    }),

  // The overlay closed: after the post-break screen, or because the break was skipped.
  EYE_BREAK_FLOW_CLOSED: (message) =>
    withState((state) => {
      const { settings, runtimeState } = state;
      const now = Date.now();
      const cycleAlreadyReset =
        runtimeState.sharedDsActiveMs === 0 &&
        runtimeState.lastBreakCompletedAt >= runtimeState.lastBreakOverlayShownAt;
      if (settings.enabled && !cycleAlreadyReset) resetBreakCycle(state, now);

      // The merged water prompt was never answered: ask again shortly.
      if (runtimeState.waterQueuedForNextBreak) {
        resetWaterTimer(runtimeState, now + WATER_REMIND_SOON_DELAY_MS);
      }
      addAuditLog(
        message.completed ? 'Eye Break Closed' : 'Eye Break Skipped',
        message.completed ? 'Post-break screen dismissed' : 'Skipped before the exercise finished'
      );
      return { success: true };
    }),

  HYDRATION_COMPLETED: () =>
    withState(({ settings, stats, runtimeState }) => {
      stats.totalHydrationBreaksCompleted++;
      stats.todayHydrationBreaksCompleted++;
      stats.weekHydrationBreaksCompleted++;
      resetWaterTimer(runtimeState, Date.now() + getWaterDelayMs(settings));
      return { success: true };
    }),

  HYDRATION_REMIND_SOON: () =>
    withState(({ runtimeState }) => {
      resetWaterTimer(runtimeState, Date.now() + WATER_REMIND_SOON_DELAY_MS);
      return { success: true };
    }),

  MOOD_RECORDED: (message) =>
    withState(({ stats }) => {
      if (!VALID_MOODS.has(message.mood)) return { success: false };
      stats.moodHistory.push({
        mood: message.mood,
        timestamp: Date.now(),
        site: String(message.site || 'unknown').slice(0, 40),
      });
      if (stats.moodHistory.length > MAX_MOODS) {
        stats.moodHistory = stats.moodHistory.slice(-MAX_MOODS);
      }
      return { success: true };
    }),

  CLOSE_TAB: async (message, sender) => {
    if (!sender?.tab?.id) return { success: false };
    try {
      await chrome.tabs.remove(sender.tab.id);
      return { success: true };
    } catch (error) {
      return { success: false };
    }
  },
};

/** Handlers only the popup and onboarding page may call. */
const EXTENSION_PAGE_HANDLERS = {
  GET_STATS: () => withState(({ stats }) => stats),

  GET_PATTERN_INSIGHTS: () => withState(({ stats }) => analyzePatterns(stats.doomScrollSessions)),

  SAVE_SETTINGS: (message) =>
    withState(async (state) => {
      const previous = state.settings;
      const incoming = { ...(message.settings || {}) };
      const now = Date.now();
      let createdRemovalPin = null;

      if (previous.webhookUrl) {
        // Locked: the webhook can only be cleared with the removal PIN.
        incoming.webhookUrl = previous.webhookUrl;
        incoming.webhookRemovalHash = previous.webhookRemovalHash;
        incoming.webhookRemovalSalt = previous.webhookRemovalSalt;
      } else if (isValidWebhookUrl(incoming.webhookUrl)) {
        createdRemovalPin = generateSecure6DigitPin();
        incoming.webhookRemovalSalt = generateSecureSalt();
        incoming.webhookRemovalHash = await hashPinWithSalt(
          createdRemovalPin,
          incoming.webhookRemovalSalt
        );
      } else {
        incoming.webhookUrl = '';
      }

      state.settings = mergeSettings(previous, incoming);
      applySettingsChange(state, previous, now);

      return {
        success: true,
        settings: buildSettingsForPopup(state.settings),
        createdRemovalPin, // Shown once by the popup, never stored in readable form
      };
    }),

  REMOVE_WEBHOOK: (message) =>
    withState(async ({ settings, runtimeState }) => {
      const now = Date.now();
      const pin = String(message.removalToken || '').trim();

      if (now < runtimeState.webhookRemovalLockedUntil) {
        const minutes = Math.ceil((runtimeState.webhookRemovalLockedUntil - now) / 60000);
        return { success: false, error: `Too many attempts. Try again in ${minutes} min.` };
      }
      if (!settings.webhookRemovalHash || !settings.webhookRemovalSalt || !pin) {
        return { success: false, error: 'Invalid removal PIN' };
      }

      const inputHash = await hashPinWithSalt(pin, settings.webhookRemovalSalt);
      if (inputHash !== settings.webhookRemovalHash) {
        runtimeState.webhookRemovalFailures++;
        if (runtimeState.webhookRemovalFailures >= WEBHOOK_PIN_MAX_FAILURES) {
          runtimeState.webhookRemovalFailures = 0;
          runtimeState.webhookRemovalLockedUntil = now + WEBHOOK_PIN_LOCKOUT_MS;
        }
        return { success: false, error: 'Invalid removal PIN' };
      }

      settings.webhookUrl = '';
      settings.webhookRemovalHash = '';
      settings.webhookRemovalSalt = '';
      runtimeState.webhookRemovalFailures = 0;
      runtimeState.webhookRemovalLockedUntil = 0;
      return { success: true };
    }),

  SNOOZE: (message) =>
    withState((state) => {
      const now = Date.now();
      const hours = clampNumber(message.hours, 1, 12, 1);
      state.settings.snoozedUntil = now + hours * 60 * 60 * 1000;
      state.runtimeState.nextSoundReminderAt = 0;
      syncGentleTimer(state, now);
      return { success: true, until: state.settings.snoozedUntil };
    }),

  RESUME: () =>
    withState((state) => {
      state.settings.snoozedUntil = 0;
      syncGentleTimer(state, Date.now());
      return { success: true };
    }),

  TEST_REPORT: async () => {
    const report = await withState(({ settings, stats }) =>
      settings.webhookUrl ? { url: settings.webhookUrl, payload: buildWeeklyReport(stats) } : null
    );
    if (!report) return { success: false, error: 'No webhook URL configured' };
    return postWeeklyReport(report.url, report.payload);
  },
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const type = message?.type;
  if (typeof type !== 'string' || sender?.id !== chrome.runtime.id) return false;

  let handler = null;
  if (Object.hasOwn(MESSAGE_HANDLERS, type)) {
    handler = MESSAGE_HANDLERS[type];
  } else if (Object.hasOwn(EXTENSION_PAGE_HANDLERS, type) && isExtensionPage(sender)) {
    handler = EXTENSION_PAGE_HANDLERS[type];
  }
  // Not ours (for example PLAY_REMINDER_SOUND, which the offscreen document answers).
  if (!handler) return false;

  Promise.resolve()
    .then(() => handler(message, sender))
    .then(sendResponse)
    .catch((error) => {
      console.warn(`[EyeFlow] ${type} failed:`, error?.message || error);
      sendResponse({ success: false, error: 'Internal error' });
    });
  return true; // The response is sent asynchronously
});

// -------------------------------------------------------
// CHROME EVENT HOOKS
// -------------------------------------------------------

function startFreshSession() {
  chrome.alarms.create(TICK_ALARM_NAME, { periodInMinutes: TICK_ALARM_PERIOD_MINUTES });
  chrome.idle.setDetectionInterval(IDLE_DETECTION_INTERVAL_SECONDS);
  return withState((state) => resetRuntimeState(state, Date.now()));
}

async function resetSessionAndNotifyTabs() {
  const snapshot = await withState((state) => {
    resetRuntimeState(state, Date.now());
    return getSharedDsSnapshot(state);
  });
  broadcastToTrackedTabs({ type: 'RESET_SESSION_TIMERS', snapshot });
}

chrome.runtime.onInstalled.addListener((details) => {
  startFreshSession();
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('onboarding.html'), active: true });
  }
});

chrome.runtime.onStartup.addListener(startFreshSession);

chrome.idle.setDetectionInterval(IDLE_DETECTION_INTERVAL_SECONDS);

// Alarms normally survive worker restarts; recreate the tick if it ever goes missing.
chrome.alarms.get(TICK_ALARM_NAME).then((alarm) => {
  if (!alarm) {
    chrome.alarms.create(TICK_ALARM_NAME, { periodInMinutes: TICK_ALARM_PERIOD_MINUTES });
  }
});

chrome.idle.onStateChanged.addListener((state) => {
  // Locking the screen ends the session; tabs get the reset snapshot.
  if (state === 'locked') resetSessionAndNotifyTabs();
  broadcastToTrackedTabs({ type: 'SYSTEM_IDLE_STATE_CHANGED', state });
});

// Push settings changes to the tabs that keep local timers.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.settings?.newValue) return;
  const next = buildSettingsForContent(mergeSettings(changes.settings.newValue));
  const previous = buildSettingsForContent(mergeSettings(changes.settings.oldValue));
  if (JSON.stringify(next) === JSON.stringify(previous)) return;
  broadcastToTrackedTabs({ type: 'SETTINGS_UPDATED', settings: next });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== TICK_ALARM_NAME) return;
  const report = await withState((state) => runTick(state, Date.now()));
  if (report) await postWeeklyReport(report.url, report.payload);
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'trigger-eye-break') return;
  const [tab, settings] = await Promise.all([
    getActiveTab(),
    withState((state) => buildSettingsForContent(state.settings)),
  ]);
  if (tab) await sendTabMessage(tab.id, { type: 'SHOW_EYE_BREAK_NOW', settings });
});

// Closing the tab the user was doom scrolling in ends that break cycle. The tab
// usually reports itself inactive just before it closes, hence sharedDsLastTabId.
chrome.tabs.onRemoved.addListener((tabId) => {
  withState((state) => {
    if (state.runtimeState.sharedDsLastTabId !== tabId) return;
    const now = Date.now();
    state.runtimeState.sharedDsLastTabId = 0;
    pauseSharedDs(state, now);
    if (state.settings.enabled) resetBreakCycle(state, now);
    syncGentleTimer(state, now);
  });
});

chrome.windows.onRemoved.addListener(async () => {
  const windows = await chrome.windows.getAll({ windowTypes: ['normal'] });
  if (windows.length === 0) {
    await withState((state) => resetRuntimeState(state, Date.now()));
  }
});
