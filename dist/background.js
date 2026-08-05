(() => {
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __esm = (fn, res, err) =>
    function __init() {
      if (err) throw err[0];
      try {
        return (fn && (res = (0, fn[__getOwnPropNames(fn)[0]])((fn = 0))), res);
      } catch (e) {
        throw ((err = [e]), e);
      }
    };
  var __commonJS = (cb, mod) =>
    function __require() {
      try {
        return (
          mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod),
          mod.exports
        );
      } catch (e) {
        throw ((mod = 0), e);
      }
    };

  // src/utils.js
  function clampNumber(value, min, max, fallback = min) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return fallback;
    return Math.min(max, Math.max(min, Math.round(numericValue)));
  }
  var TIMER_LIMITS, GENTLE_REMINDER_DUPLICATE_GUARD_MS;
  var init_utils = __esm({
    'src/utils.js'() {
      TIMER_LIMITS = {
        // Range (in minutes) for warning triggers on doom scrolling
        doomReminderMin: { min: 5, max: 30, fallback: 5 },
        doomReminderMax: { min: 5, max: 30, fallback: 5 },
        // Duration (in seconds) that the guided eye exercise screen stays active
        eyeBreakDurationSec: { min: 15, max: 40, fallback: 20 },
        // Delay (in minutes) before triggering a hydration reminder check
        hydrationReminderMin: { min: 60, max: 240, fallback: 60 },
        // Lower bound for work/productivity gentle reminder interval (in minutes)
        subtleReminderMin: { min: 20, max: 60, fallback: 20 },
        // Upper bound for work/productivity gentle reminder interval (in minutes)
        subtleReminderMax: { min: 20, max: 60, fallback: 35 },
      };
      GENTLE_REMINDER_DUPLICATE_GUARD_MS = 15 * 1e3;
    },
  });

  // src/background.js
  var require_background = __commonJS({
    'src/background.js'() {
      init_utils();
      var DEFAULT_SETTINGS = {
        enabled: true,
        // Is the extension active?
        snoozedUntil: 0,
        // Timestamp when snooze ends (0 = not snoozed)
        sensitivity: 50,
        // Doom-scroll sensitivity (0-100). Higher = triggers faster
        eyeBreakDurationSec: 20,
        // How long the eye exercise lasts (seconds)
        hydrationBreakDurationSec: 40,
        // Hydration reset countdown duration
        reminderIntervalMin: 5,
        // Main eye reminder interval (in minutes)
        reminderIntervalMax: 5,
        // Main eye reminder interval (in minutes)
        hydrationReminderMin: 60,
        // Show a hydration reset after this much continuous time
        subtleReminderEnabled: true,
        // Show a soft corner reminder during normal work in Chrome
        subtleReminderMin: 25,
        // Soft reminder interval (in minutes)
        subtleReminderMax: 25,
        // Soft reminder interval (in minutes)
        timingMode: 'fixed',
        // fixed = exact intervals, surprise = random ranges
        customTimingEnabled: false,
        // Let advanced users override reminder timing from the popup
        soundReminderEnabled: false,
        // Keep background audio opt-in for a calmer first-run experience
        soundReminderMin: 20,
        // Minimum gap for the background sound reminder
        soundReminderMax: 30,
        // Maximum gap for the background sound reminder
        popupTheme: 'dark',
        // Popup theme preference: dark or light
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
        webhookUrl: '',
        // URL for weekly email reports
        webhookRemovalHash: '',
        // Stretched salted SHA-256 hash of 6-digit removal PIN
        webhookRemovalSalt: '',
        // 128-bit random salt for PBKDF/stretching protection
      };
      Object.freeze(DEFAULT_SETTINGS);
      function generateSecure6DigitPin() {
        const array = new Uint32Array(1);
        crypto.getRandomValues(array);
        const pinNum = 1e5 + (array[0] % 9e5);
        return String(pinNum);
      }
      function generateSecureSalt() {
        const array = new Uint8Array(16);
        crypto.getRandomValues(array);
        return Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('');
      }
      async function hashPinWithSalt(pin, salt) {
        const encoder = new TextEncoder();
        const safeSalt = String(salt || '').trim();
        const safePin = String(pin || '').trim();
        let hashBuffer = await crypto.subtle.digest(
          'SHA-256',
          encoder.encode(`EyeFlow:${safeSalt}:${safePin}:${safeSalt}`)
        );
        for (let i = 0; i < 5e3; i++) {
          hashBuffer = await crypto.subtle.digest('SHA-256', hashBuffer);
        }
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
      }
      var DEFAULT_STATS = {
        totalDoomScrollsBlocked: 0,
        // Total interruptions ever
        totalEyeBreaksCompleted: 0,
        // Total eye exercises done
        totalHydrationBreaksCompleted: 0,
        // Total water breaks done
        todayDoomScrollsBlocked: 0,
        // Interruptions today
        todayEyeBreaksCompleted: 0,
        // Eye exercises today
        todayHydrationBreaksCompleted: 0,
        // Water breaks today
        weekDoomScrollsBlocked: 0,
        // Interruptions this week
        weekEyeBreaksCompleted: 0,
        // Eye exercises this week
        weekHydrationBreaksCompleted: 0,
        // Water breaks this week
        lastBreakTime: 0,
        // Timestamp of last eye break
        lastResetDate: '',
        // The date when daily counters were last reset
        moodHistory: [],
        // Array of { mood, timestamp, site }
        doomScrollSessions: [],
        // Array of { site, day, hour, duration, scrollCount }
        siteTimeSpent: {},
        // Legacy aggregate site-time bucket
        todayDsSiteTimeSpent: {},
        // { 'Instagram': totalMinutes, ... } persisted across reload/restart, resets only on a new day
        weekDsSiteTimeSpent: {},
        // Persists across the week, resets on Monday
      };
      var DEFAULT_RUNTIME_STATE = {
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
        lastBreakOverlayShownAt: 0,
        currentSessionStartedAt: 0,
        currentSessionSite: '',
        currentSessionInterrupted: false,
        lastSessionEndedAt: 0,
        lastSessionSite: '',
      };
      var GENTLE_TIMER_STATES = Object.freeze({
        OFF: 'off',
        RUNNING: 'running',
        PAUSED: 'paused',
        DUE: 'due',
      });
      var GENTLE_PAUSE_REASONS = Object.freeze({
        NONE: 'none',
        SNOOZE: 'snooze',
        DS_ACTIVE: 'ds_active',
        INACTIVE: 'inactive',
        NO_WINDOW: 'no_window',
        DISABLED: 'disabled',
        FEATURE_OFF: 'feature_off',
      });
      var SHARED_DS_TIMER_STATES = Object.freeze({
        OFF: 'off',
        RUNNING: 'running',
        PAUSED: 'paused',
      });
      var SHARED_DS_PAUSE_REASONS = Object.freeze({
        NONE: 'none',
        INACTIVE: 'inactive',
        SESSION_TIMEOUT: 'session_timeout',
        DISABLED: 'disabled',
        BREAK_FLOW: 'break_flow',
      });
      var SOUND_REMINDER_FOLLOWUP_MS = 10 * 60 * 1e3;
      var WATER_REMIND_SOON_DELAY_MS = 3 * 60 * 1e3;
      var WATER_PENDING_TIMEOUT_MS = 2 * 60 * 1e3;
      var SESSION_RESET_INACTIVITY_MS = 15 * 60 * 1e3;
      var TICK_ALARM_PERIOD_MINUTES = 0.5;
      var IDLE_DETECTION_INTERVAL_SECONDS = 60;
      var DOOM_SCROLL_HOSTS = /* @__PURE__ */ new Set([
        'instagram.com',
        'tiktok.com',
        'reddit.com',
        'facebook.com',
        'twitter.com',
        'x.com',
      ]);
      function safeStorageSet(data) {
        return new Promise((resolve) => {
          chrome.storage.local.set(data, () => {
            if (chrome.runtime.lastError) {
              console.warn('[EyeFlow] storage write failed:', chrome.runtime.lastError.message);
            }
            resolve();
          });
        });
      }
      function addAuditLog(event, details) {
        return new Promise((resolve) => {
          chrome.storage.local.get(['auditLogs'], (result) => {
            const logs = Array.isArray(result.auditLogs) ? result.auditLogs : [];
            const now = Date.now();
            const timeString = new Date(now).toLocaleTimeString('en-US', { hour12: false });
            const entry = {
              timestamp: now,
              timeString,
              event,
              details: details || '',
            };
            logs.push(entry);
            const trimmedLogs = logs.slice(-500);
            chrome.storage.local.set({ auditLogs: trimmedLogs }, () => {
              resolve();
            });
          });
        });
      }
      function finalizeCurrentSession(runtimeState, stats, now = Date.now()) {
        const start = runtimeState.currentSessionStartedAt;
        const site = runtimeState.currentSessionSite;
        if (start > 0 && site) {
          const durationSec = Math.round((now - start) / 1e3);
          if (durationSec >= 5) {
            let swappedFrom = null;
            if (
              runtimeState.lastSessionEndedAt > 0 &&
              now - runtimeState.lastSessionEndedAt < 60 * 1e3
            ) {
              if (runtimeState.lastSessionSite && runtimeState.lastSessionSite !== site) {
                swappedFrom = runtimeState.lastSessionSite;
                addAuditLog(
                  'Feed-Hop Detected',
                  `User swapped directly from ${swappedFrom} to ${site}`
                );
              }
            }
            const sessionData = {
              site,
              day: new Date(start).getDay(),
              hour: new Date(start).getHours(),
              duration: durationSec,
              timestamp: start,
              interrupted: Boolean(runtimeState.currentSessionInterrupted),
              swappedFrom,
            };
            stats.doomScrollSessions.push(sessionData);
            if (stats.doomScrollSessions.length > 200) {
              stats.doomScrollSessions = stats.doomScrollSessions.slice(-200);
            }
            runtimeState.lastSessionEndedAt = now;
            runtimeState.lastSessionSite = site;
          }
        }
        runtimeState.currentSessionStartedAt = 0;
        runtimeState.currentSessionSite = '';
        runtimeState.currentSessionInterrupted = false;
      }
      function buildSafeSettingsForContent(settings) {
        const {
          webhookUrl,
          webhookRemovalHash,
          webhookRemovalSalt,
          webhookRemovalToken,
          ...safeSettings
        } = settings;
        return safeSettings;
      }
      chrome.runtime.onInstalled.addListener((details) => {
        ensureDefaults({ freshSession: true });
        ensureTickAlarm();
        ensureIdleDetection();
        if (details.reason === 'install') {
          chrome.tabs.create({
            url: chrome.runtime.getURL('onboarding.html'),
            active: true,
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
          settings: buildSafeSettingsForContent(changes.settings.newValue),
        });
      });
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
        if (settings.snoozedUntil > 0 && now >= settings.snoozedUntil) {
          settings.snoozedUntil = 0;
          settingsChanged = true;
        }
        const today = new Date(now).toDateString();
        if (stats.lastResetDate !== today) {
          stats.todayDoomScrollsBlocked = 0;
          stats.todayEyeBreaksCompleted = 0;
          stats.todayHydrationBreaksCompleted = 0;
          stats.todayDsSiteTimeSpent = {};
          stats.lastResetDate = today;
          statsChanged = true;
          const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1e3;
          if (Array.isArray(stats.doomScrollSessions)) {
            stats.doomScrollSessions = stats.doomScrollSessions.filter(
              (s) => s.timestamp >= thirtyDaysAgo
            );
          }
          if (Array.isArray(stats.moodHistory)) {
            stats.moodHistory = stats.moodHistory.filter((m) => m.timestamp >= thirtyDaysAgo);
          }
          chrome.storage.local.get(['auditLogs'], (resultLogs) => {
            const logs = Array.isArray(resultLogs.auditLogs) ? resultLogs.auditLogs : [];
            const prunedLogs = logs.filter((l) => l.timestamp >= thirtyDaysAgo).slice(-500);
            chrome.storage.local.set({ auditLogs: prunedLogs });
          });
          if (new Date(now).getDay() === 1) {
            if (settings.webhookUrl) {
              sendWeeklyReport(stats, settings.webhookUrl);
            }
            stats.weekDoomScrollsBlocked = 0;
            stats.weekEyeBreaksCompleted = 0;
            stats.weekHydrationBreaksCompleted = 0;
            stats.weekDsSiteTimeSpent = {};
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
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === 'ADD_AUDIT_LOG') {
          addAuditLog(message.event, message.details).then(() => {
            sendResponse({ success: true });
          });
          return true;
        }
        if (message.type === 'GET_SETTINGS') {
          chrome.storage.local.get(['settings'], (result) => {
            const full = mergeSettings(result.settings);
            const isContentScript = Boolean(sender?.tab);
            sendResponse(isContentScript ? buildSafeSettingsForContent(full) : full);
          });
          return true;
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
              safeStorageSet({ runtimeState });
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
              safeStorageSet({ runtimeState });
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
          chrome.storage.local.get(['settings', 'stats', 'runtimeState'], (result) => {
            const settings = mergeSettings(result.settings);
            const stats = mergeStats(result.stats);
            const runtimeState = mergeRuntimeState(result.runtimeState);
            const now = Date.now();
            const senderTabId = sender?.tab?.id || 0;
            const senderTabIsActive = Boolean(sender?.tab?.active);
            const isSnoozed = settings.snoozedUntil > 0 && now < settings.snoozedUntil;
            if (!runtimeState.sharedDsNextBreakTargetMs) {
              runtimeState.sharedDsNextBreakTargetMs = getNextSharedBreakTargetMs(settings);
            }
            advanceSharedDsState(runtimeState, now);
            if (message.isActive) {
              const incomingSite = message.contextKey || 'unknown';
              const siteChanged =
                runtimeState.sharedDsIsActive &&
                runtimeState.currentSessionSite &&
                runtimeState.currentSessionSite !== incomingSite;
              if (!runtimeState.sharedDsIsActive || siteChanged) {
                if (siteChanged) {
                  finalizeCurrentSession(runtimeState, stats, now);
                }
                addAuditLog(
                  'Doom Scroll Session Started',
                  `Site context: ${incomingSite} (tab: ${senderTabId})`
                );
                runtimeState.currentSessionStartedAt = now;
                runtimeState.currentSessionSite = incomingSite;
                runtimeState.currentSessionInterrupted = false;
              }
              runtimeState.sharedDsIsActive = true;
              runtimeState.sharedDsActiveTabId = senderTabId;
              runtimeState.sharedDsContextKey = message.contextKey || '';
              runtimeState.sharedDsLastUpdateAt = now;
              runtimeState.sharedDsState = SHARED_DS_TIMER_STATES.RUNNING;
              runtimeState.sharedDsPauseReason = SHARED_DS_PAUSE_REASONS.NONE;
            } else if (runtimeState.sharedDsActiveTabId === senderTabId || senderTabIsActive) {
              if (runtimeState.sharedDsIsActive) {
                addAuditLog(
                  'Doom Scroll Session Paused/Ended',
                  `Tab ${senderTabId} reported inactive`
                );
                finalizeCurrentSession(runtimeState, stats, now);
              }
              runtimeState.sharedDsIsActive = false;
              runtimeState.sharedDsActiveTabId = 0;
              runtimeState.sharedDsContextKey = '';
              runtimeState.sharedDsLastUpdateAt = now;
              runtimeState.sharedDsState = SHARED_DS_TIMER_STATES.PAUSED;
              runtimeState.sharedDsPauseReason = SHARED_DS_PAUSE_REASONS.INACTIVE;
            }
            if (runtimeState.sharedDsIsActive) {
              pauseGentleReminder(runtimeState, GENTLE_PAUSE_REASONS.DS_ACTIVE, now);
            } else if (!isSnoozed && settings.subtleReminderEnabled) {
              if (runtimeState.gentleState === GENTLE_TIMER_STATES.PAUSED) {
                resumeGentleReminder(runtimeState, now);
              }
              if (!runtimeState.nextGentleReminderAt) {
                runtimeState.nextGentleReminderAt = now + getGentleDelayMs(settings);
              }
            }
            const runImmediateGentleCheck = async () => {
              if (
                !runtimeState.sharedDsIsActive &&
                !isSnoozed &&
                settings.subtleReminderEnabled &&
                runtimeState.nextGentleReminderAt > 0 &&
                now >= runtimeState.nextGentleReminderAt
              ) {
                runtimeState.gentleState = GENTLE_TIMER_STATES.DUE;
                const reminderShown = await sendGentleReminderToActiveTab();
                if (reminderShown) {
                  scheduleNextGentleReminder(runtimeState, settings, now);
                  runtimeState.lastGentleReminderAt = now;
                } else {
                  runtimeState.gentleState = GENTLE_TIMER_STATES.DUE;
                  runtimeState.gentlePauseReason = GENTLE_PAUSE_REASONS.INACTIVE;
                }
              }
            };
            runImmediateGentleCheck().then(() => {
              safeStorageSet({ stats, runtimeState }).then(() => {
                sendResponse(getSharedDsSnapshot(runtimeState));
              });
            });
          });
          return true;
        }
        if (message.type === 'SAVE_SETTINGS') {
          chrome.storage.local.get(['settings', 'runtimeState'], async (result) => {
            const previousSettings = mergeSettings(result.settings);
            const incomingSettings = { ...message.settings };
            let createdRemovalPin = null;
            if (previousSettings.webhookUrl && previousSettings.webhookUrl.trim() !== '') {
              incomingSettings.webhookUrl = previousSettings.webhookUrl;
              incomingSettings.webhookRemovalHash = previousSettings.webhookRemovalHash;
              incomingSettings.webhookRemovalSalt = previousSettings.webhookRemovalSalt;
            } else if (incomingSettings.webhookUrl && incomingSettings.webhookUrl.trim() !== '') {
              createdRemovalPin = generateSecure6DigitPin();
              const salt = generateSecureSalt();
              incomingSettings.webhookRemovalSalt = salt;
              incomingSettings.webhookRemovalHash = await hashPinWithSalt(createdRemovalPin, salt);
            }
            delete incomingSettings.webhookRemovalToken;
            const settings = mergeSettings(result.settings, incomingSettings);
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
            safeStorageSet({ settings, runtimeState }).then(() => {
              const {
                webhookRemovalHash,
                webhookRemovalSalt,
                webhookRemovalToken,
                ...safeResponseSettings
              } = settings;
              sendResponse({
                success: true,
                settings: safeResponseSettings,
                createdRemovalPin,
                // Transmitted ONCE to popup upon creation
              });
            });
          });
          return true;
        }
        if (message.type === 'REMOVE_WEBHOOK') {
          const { removalToken } = message;
          chrome.storage.local.get(['settings', 'runtimeState'], async (result) => {
            const settings = mergeSettings(result.settings);
            if (!settings.webhookRemovalHash || !settings.webhookRemovalSalt || !removalToken) {
              sendResponse({ success: false, error: 'Invalid removal PIN' });
              return;
            }
            const inputHash = await hashPinWithSalt(removalToken, settings.webhookRemovalSalt);
            if (inputHash === settings.webhookRemovalHash) {
              settings.webhookUrl = '';
              settings.webhookRemovalHash = '';
              settings.webhookRemovalSalt = '';
              delete settings.webhookRemovalToken;
              const runtimeState = mergeRuntimeState(result.runtimeState);
              safeStorageSet({ settings, runtimeState }).then(() => {
                sendResponse({ success: true });
              });
            } else {
              sendResponse({ success: false, error: 'Invalid removal PIN' });
            }
          });
          return true;
        }
        if (message.type === 'GET_STATS') {
          chrome.storage.local.get(['stats'], (result) => {
            sendResponse(mergeStats(result.stats));
          });
          return true;
        }
        if (message.type === 'DOOM_SCROLL_DETECTED') {
          chrome.storage.local.get(['settings', 'stats', 'runtimeState'], (result) => {
            const settings = mergeSettings(result.settings);
            const stats = mergeStats(result.stats);
            const runtimeState = mergeRuntimeState(result.runtimeState);
            if (!settings.enabled) {
              sendResponse({ action: 'IGNORE' });
              return;
            }
            stats.totalDoomScrollsBlocked++;
            stats.todayDoomScrollsBlocked++;
            stats.weekDoomScrollsBlocked++;
            runtimeState.lastPrimaryInterventionAt = 0;
            runtimeState.nextSoundReminderAt = 0;
            if (message.stage === 'break') {
              runtimeState.lastBreakOverlayShownAt = Date.now();
              runtimeState.currentSessionInterrupted = true;
              addAuditLog(
                'Break Interruption Triggered',
                `Requested break overlay on ${message.site || 'unknown site'}`
              );
            } else {
              addAuditLog(
                'Nudge/Warning Triggered',
                `Stage: ${message.stage} on ${message.site || 'unknown site'}`
              );
            }
            safeStorageSet({ stats, runtimeState });
            const safeSettings = buildSafeSettingsForContent(settings);
            sendResponse({
              action: 'INTERVENE',
              stage: 'break',
              settings: safeSettings,
            });
          });
          return true;
        }
        if (message.type === 'EYE_BREAK_COMPLETED') {
          chrome.storage.local.get(['settings', 'stats', 'runtimeState'], (result) => {
            const settings = mergeSettings(result.settings);
            const stats = mergeStats(result.stats);
            const runtimeState = mergeRuntimeState(result.runtimeState);
            stats.totalEyeBreaksCompleted++;
            stats.todayEyeBreaksCompleted++;
            stats.weekEyeBreaksCompleted++;
            stats.lastBreakTime = Date.now();
            runtimeState.lastPrimaryInterventionAt = 0;
            runtimeState.nextSoundReminderAt = 0;
            runtimeState.sharedDsActiveMs = 0;
            runtimeState.sharedDsNextBreakTargetMs = getNextSharedBreakTargetMs(settings);
            runtimeState.sharedDsLastUpdateAt = Date.now();
            runtimeState.sharedDsState = SHARED_DS_TIMER_STATES.PAUSED;
            runtimeState.sharedDsPauseReason = SHARED_DS_PAUSE_REASONS.BREAK_FLOW;
            addAuditLog('Eye Break Completed', `Eye exercise completed successfully`);
            safeStorageSet({ stats, runtimeState });
            sendResponse({ success: true });
          });
          return true;
        }
        if (message.type === 'EYE_BREAK_FLOW_CLOSED') {
          chrome.storage.local.get(['settings', 'runtimeState'], (result) => {
            const settings = mergeSettings(result.settings);
            const runtimeState = mergeRuntimeState(result.runtimeState);
            runtimeState.lastPrimaryInterventionAt = 0;
            runtimeState.nextSoundReminderAt = 0;
            runtimeState.sharedDsActiveMs = 0;
            runtimeState.sharedDsNextBreakTargetMs = getNextSharedBreakTargetMs(settings);
            runtimeState.sharedDsLastUpdateAt = Date.now();
            runtimeState.sharedDsState = SHARED_DS_TIMER_STATES.PAUSED;
            runtimeState.sharedDsPauseReason = SHARED_DS_PAUSE_REASONS.BREAK_FLOW;
            addAuditLog('Eye Break Closed', `Post-break flow dismissed/closed`);
            safeStorageSet({ runtimeState });
            sendResponse({ success: true });
          });
          return true;
        }
        if (message.type === 'HYDRATION_COMPLETED') {
          chrome.storage.local.get(['settings', 'stats', 'runtimeState'], (result) => {
            const settings = mergeSettings(result.settings);
            const stats = mergeStats(result.stats);
            const runtimeState = mergeRuntimeState(result.runtimeState);
            const now = Date.now();
            stats.totalHydrationBreaksCompleted = (stats.totalHydrationBreaksCompleted || 0) + 1;
            stats.todayHydrationBreaksCompleted = (stats.todayHydrationBreaksCompleted || 0) + 1;
            stats.weekHydrationBreaksCompleted = (stats.weekHydrationBreaksCompleted || 0) + 1;
            runtimeState.nextWaterReminderAt = now + getWaterDelayMs(settings);
            runtimeState.waterReminderPending = false;
            runtimeState.waterReminderPendingSince = 0;
            runtimeState.waterQueuedForNextBreak = false;
            safeStorageSet({ stats, runtimeState });
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
            safeStorageSet({ runtimeState });
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
            safeStorageSet({ runtimeState });
            sendResponse({ success: true });
          });
          return true;
        }
        if (message.type === 'MOOD_RECORDED') {
          chrome.storage.local.get(['stats'], (result) => {
            const stats = mergeStats(result.stats);
            stats.moodHistory.push({
              mood: message.mood,
              timestamp: Date.now(),
              site: message.site || 'unknown',
            });
            if (stats.moodHistory.length > 100) {
              stats.moodHistory = stats.moodHistory.slice(-100);
            }
            safeStorageSet({ stats });
            sendResponse({ success: true });
          });
          return true;
        }
        if (message.type === 'SNOOZE') {
          chrome.storage.local.get(['settings'], (result) => {
            const settings = mergeSettings(result.settings);
            const now = Date.now();
            settings.snoozedUntil = now + message.hours * 60 * 60 * 1e3;
            chrome.storage.local.get(['runtimeState'], (runtimeResult) => {
              const runtimeState = mergeRuntimeState(runtimeResult.runtimeState);
              pauseGentleReminder(runtimeState, GENTLE_PAUSE_REASONS.SNOOZE, now);
              runtimeState.nextSoundReminderAt = 0;
              safeStorageSet({ settings, runtimeState });
              broadcastToAllTabs({ type: 'SNOOZE_STARTED', until: settings.snoozedUntil });
              sendResponse({ success: true, until: settings.snoozedUntil });
            });
          });
          return true;
        }
        if (message.type === 'RESUME') {
          chrome.storage.local.get(['settings', 'runtimeState'], (result) => {
            const settings = mergeSettings(result.settings);
            const runtimeState = mergeRuntimeState(result.runtimeState);
            const now = Date.now();
            settings.snoozedUntil = 0;
            if (!runtimeState.sharedDsIsActive) {
              resumeGentleReminder(runtimeState, now);
            }
            safeStorageSet({ settings, runtimeState });
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
        if (message.type === 'GET_PATTERN_INSIGHTS') {
          chrome.storage.local.get(['stats'], (result) => {
            const stats = mergeStats(result.stats);
            const insights = analyzePatterns(stats.doomScrollSessions);
            sendResponse(insights);
          });
          return true;
        }
        if (message.type === 'TEST_REPORT') {
          chrome.storage.local.get(['stats', 'settings'], (result) => {
            const stats = mergeStats(result.stats);
            const settings = mergeSettings(result.settings);
            if (settings.webhookUrl) {
              sendWeeklyReport(stats, settings.webhookUrl);
              sendResponse({ success: true });
            } else {
              sendResponse({ success: false, error: 'No Webhook URL configured' });
            }
          });
          return true;
        }
        if (!message.type.startsWith('GET_')) {
          sendResponse({ success: true, unhandled: true });
        }
        return true;
      });
      chrome.commands.onCommand.addListener(async (command) => {
        if (command !== 'trigger-eye-break') return;
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) return;
        try {
          await chrome.tabs.sendMessage(tab.id, { type: 'SHOW_EYE_BREAK_NOW' });
        } catch (_) {}
      });
      async function runAmbientReminderTick(settings, runtimeState, now) {
        if (!settings.enabled) {
          clearRuntimeStateForDisabled(runtimeState);
          await safeStorageSet({ runtimeState });
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
          await safeStorageSet({ runtimeState });
          return;
        }
        if (!settings.subtleReminderEnabled) {
          setGentleReminderOff(runtimeState, GENTLE_PAUSE_REASONS.FEATURE_OFF);
        } else if (runtimeState.sharedDsIsActive) {
          pauseGentleReminder(runtimeState, GENTLE_PAUSE_REASONS.DS_ACTIVE, now);
        } else {
          if (runtimeState.gentleState === GENTLE_TIMER_STATES.PAUSED) {
            resumeGentleReminder(runtimeState, now);
          }
          if (!runtimeState.nextGentleReminderAt) {
            scheduleNextGentleReminder(runtimeState, settings, now);
          } else if (now >= runtimeState.nextGentleReminderAt) {
            runtimeState.gentleState = GENTLE_TIMER_STATES.DUE;
            runtimeState.gentlePauseReason = GENTLE_PAUSE_REASONS.NONE;
            const reminderShown = await sendGentleReminderToActiveTab();
            if (reminderShown) {
              scheduleNextGentleReminder(runtimeState, settings, now);
              runtimeState.lastGentleReminderAt = now;
            } else {
              runtimeState.gentleState = GENTLE_TIMER_STATES.DUE;
              runtimeState.gentlePauseReason = GENTLE_PAUSE_REASONS.INACTIVE;
            }
          } else {
            runtimeState.gentleState = GENTLE_TIMER_STATES.RUNNING;
            runtimeState.gentlePauseReason = GENTLE_PAUSE_REASONS.NONE;
          }
        }
        const chromeState = await getChromeWindowState();
        if (chromeState.hasChromeWindow && !chromeState.chromeFocused) {
          if (!settings.soundReminderEnabled) {
            runtimeState.nextSoundReminderAt = 0;
          } else {
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
        } else {
          runtimeState.nextSoundReminderAt = 0;
        }
        await safeStorageSet({ runtimeState });
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
          runtimeState.gentlePausedRemainingMs = Math.max(
            1e3,
            runtimeState.nextGentleReminderAt - now
          );
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
      function sendWeeklyReport(stats, webhookUrl) {
        if (!webhookUrl) return;
        const totalTimeEntries = Object.entries(stats.weekDsSiteTimeSpent || {})
          .sort((a, b) => b[1] - a[1])
          .map(([site, minutes]) => `${site}: ${Math.round(minutes)} minutes`)
          .join('\n');
        const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1e3;
        const recentSessions = (stats.doomScrollSessions || [])
          .filter((s) => s.timestamp >= oneWeekAgo)
          .sort((a, b) => b.timestamp - a.timestamp);
        let feedHopsCount = 0;
        const hopTransitions = {};
        recentSessions.forEach((s) => {
          if (s.swappedFrom) {
            feedHopsCount++;
            const key = `${s.swappedFrom} -> ${s.site}`;
            hopTransitions[key] = (hopTransitions[key] || 0) + 1;
          }
        });
        const topTransitions = Object.entries(hopTransitions)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([trans, count]) => `${trans} (${count} times)`)
          .join(', ');
        const daysOfWeek = [
          'Sunday',
          'Monday',
          'Tuesday',
          'Wednesday',
          'Thursday',
          'Friday',
          'Saturday',
        ];
        const sessionEntries = recentSessions
          .slice(0, 30)
          .map((s) => {
            const date = new Date(s.timestamp);
            const dayName = daysOfWeek[date.getDay()];
            const timeStr = date.toLocaleTimeString('en-US', {
              hour: '2-digit',
              minute: '2-digit',
              hour12: true,
            });
            const durationStr =
              s.duration >= 60 ? `${(s.duration / 60).toFixed(1)}m` : `${s.duration}s`;
            const hopStr = s.swappedFrom ? ` (swapped from ${s.swappedFrom})` : '';
            const interruptedStr = s.interrupted ? ' [Exercise Completed]' : ' [No exercise]';
            return `- ${dayName} ${timeStr} | ${s.site} | Duration: ${durationStr}${interruptedStr}${hopStr}`;
          })
          .join('\n');
        const complianceRate =
          stats.weekDoomScrollsBlocked > 0
            ? `${((stats.weekEyeBreaksCompleted / stats.weekDoomScrollsBlocked) * 100).toFixed(1)}%`
            : '100%';
        const hydrationCount = stats.weekHydrationBreaksCompleted || 0;
        const patterns = analyzePatterns(stats.doomScrollSessions || recentSessions);
        const peakWindow =
          patterns.riskTimes && patterns.riskTimes.length > 0
            ? `${patterns.riskTimes[0].dayName}s around ${patterns.riskTimes[0].timeLabel}`
            : 'No clear peak yet';
        const reportPayload = {
          subject: 'EyeFlow Weekly Report',
          message: `Here is the weekly doom-scrolling report:

Doom Scrolls Blocked: ${stats.weekDoomScrollsBlocked}
Eye Breaks Completed: ${stats.weekEyeBreaksCompleted}
Compliance Rate: ${complianceRate}
Water Breaks Taken: ${hydrationCount} times
\u26A0\uFE0F Peak Doom-Scrolling Window: ${peakWindow}

Time Spent on Doom Scrolling Sites:
${totalTimeEntries || 'No doom scrolling time recorded this week!'}

\u{1F504} Feed-Hopping Patterns:
- Total app-swaps: ${feedHopsCount} times
- Most common transitions: ${topTransitions || 'None'}

\u{1F4C5} Detailed Session Activity Log (Last 30 Sessions):
${sessionEntries || 'No individual sessions recorded.'}`,
          stats: {
            weekDoomScrollsBlocked: stats.weekDoomScrollsBlocked,
            weekEyeBreaksCompleted: stats.weekEyeBreaksCompleted,
            complianceRate,
            weekHydrationBreaksCompleted: hydrationCount,
            peakWindow,
            weekDsSiteTimeSpent: stats.weekDsSiteTimeSpent,
            feedHopsCount,
            topTransitions: topTransitions || '',
            recentSessions: recentSessions.slice(0, 30),
          },
        };
        fetch(webhookUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(reportPayload),
        }).catch((err) => console.error('Failed to send weekly report:', err));
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
        if (isLikelyDoomScrollUrl(activeTab.url || '')) {
          return false;
        }
        try {
          const pageContext = await chrome.tabs.sendMessage(activeTab.id, {
            type: 'CAN_SHOW_GENTLE_REMINDER',
          });
          if (!pageContext || !pageContext.allow) {
            return false;
          }
          await chrome.tabs.sendMessage(activeTab.id, { type: 'SHOW_GENTLE_REMINDER' });
          return true;
        } catch (e) {
          return false;
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
            if ((pageContext.msUntilEyeBreak || Infinity) <= 3 * 60 * 1e3) {
              await chrome.tabs.sendMessage(activeTab.id, {
                type: 'QUEUE_HYDRATION_FOR_NEXT_BREAK',
              });
              return 'queued';
            }
            await chrome.tabs.sendMessage(activeTab.id, { type: 'SHOW_HYDRATION_POPUP' });
            return 'popup';
          }
          if (pageContext?.canShowGentleReminder) {
            await chrome.tabs.sendMessage(activeTab.id, { type: 'SHOW_WATER_GENTLE_REMINDER' });
            return 'gentle';
          }
        } catch (e) {}
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
        } catch (e) {}
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
          justification:
            'Play a short eye-care reminder sound when Chrome is open in the background.',
        });
      }
      function getRandomDelayMs(minMinutes, maxMinutes) {
        const min = Math.max(1, Math.min(minMinutes, maxMinutes));
        const max = Math.max(min, Math.max(minMinutes, maxMinutes));
        const randomMinutes = Math.floor(Math.random() * (max - min + 1)) + min;
        return randomMinutes * 60 * 1e3;
      }
      function getNextSharedBreakTargetMs(settings) {
        return getEyeBreakDelayMs(settings);
      }
      function getWaterDelayMs(settings) {
        const minutes = settings?.hydrationReminderMin || DEFAULT_SETTINGS.hydrationReminderMin;
        const jitterMinutes = Math.floor(Math.random() * 6);
        return (minutes + jitterMinutes) * 60 * 1e3;
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
          lastBreakOverlayShownAt: runtimeState.lastBreakOverlayShownAt || 0,
        };
      }
      function normalizeTimingMode(timingMode, customTimingEnabled) {
        if (timingMode === 'fixed' || timingMode === 'surprise') {
          return timingMode;
        }
        return customTimingEnabled ? 'surprise' : 'fixed';
      }
      function isSurpriseTiming(settings) {
        return (
          normalizeTimingMode(settings?.timingMode, settings?.customTimingEnabled) === 'surprise'
        );
      }
      function getEyeBreakDelayMs(settings) {
        const isSurprise = isSurpriseTiming(settings);
        let delayMs;
        let detailMsg;
        if (isSurprise) {
          const min = Math.max(
            5,
            settings?.reminderIntervalMin || DEFAULT_SETTINGS.reminderIntervalMin
          );
          const max = Math.max(
            min,
            settings?.reminderIntervalMax || DEFAULT_SETTINGS.reminderIntervalMax
          );
          delayMs = getRandomDelayMs(min, max);
          detailMsg = `Mode: surprise (random), Range: [${min}, ${max}] min, Generated Target: ${(delayMs / 6e4).toFixed(1)} min (${delayMs} ms)`;
        } else {
          const exactMinutes = clampNumber(
            settings?.reminderIntervalMin,
            5,
            TIMER_LIMITS.doomReminderMin.max,
            TIMER_LIMITS.doomReminderMin.fallback
          );
          delayMs = exactMinutes * 60 * 1e3;
          detailMsg = `Mode: fixed, Fixed Target: ${exactMinutes} min (${delayMs} ms)`;
        }
        if (delayMs < 5 * 60 * 1e3) {
          delayMs = 5 * 60 * 1e3;
          detailMsg += ` (clamped to 5m minimum)`;
        }
        addAuditLog('Break Target Generated', detailMsg);
        return delayMs;
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
        return exactMinutes * 60 * 1e3;
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
            if (/^\/[^/]+\/likes\/?$/.test(pathname)) return true;
            if (/^\/[^/]+\/media\/?$/.test(pathname)) return true;
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
        };
        sources.filter(Boolean).forEach((source) => {
          Object.assign(merged, source);
          if (source.siteTiers) {
            merged.siteTiers = { ...merged.siteTiers, ...source.siteTiers };
          }
        });
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
        if (merged.webhookUrl && merged.webhookUrl.trim() !== '') {
          merged.enabled = true;
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
          weekDsSiteTimeSpent: source?.weekDsSiteTimeSpent
            ? { ...source.weekDsSiteTimeSpent }
            : { ...DEFAULT_STATS.weekDsSiteTimeSpent },
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
          sharedDsState: settings.enabled
            ? SHARED_DS_TIMER_STATES.PAUSED
            : SHARED_DS_TIMER_STATES.OFF,
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
          safeStorageSet({
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
        const result = await chrome.storage.local.get(['settings', 'stats', 'runtimeState']);
        const settings = mergeSettings(result.settings);
        const stats = mergeStats(result.stats);
        const runtimeState = mergeRuntimeState(result.runtimeState);
        const now = Date.now();
        if (runtimeState.sharedDsIsActive) {
          finalizeCurrentSession(runtimeState, stats, now);
        }
        resetRuntimeStateFields(runtimeState, settings, now);
        await safeStorageSet({ stats, runtimeState });
        broadcastRuntimeReset(runtimeState);
      }
      function analyzePatterns(sessions) {
        if (!sessions || sessions.length < 7) {
          return { hasEnoughData: false, riskTimes: [], topSites: [] };
        }
        const dayHourCounts = {};
        const siteCounts = {};
        sessions.forEach((session) => {
          const key = `${session.day}-${session.hour}`;
          dayHourCounts[key] = (dayHourCounts[key] || 0) + 1;
          siteCounts[session.site] = (siteCounts[session.site] || 0) + 1;
        });
        const riskTimes = Object.entries(dayHourCounts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([key, count]) => {
            const [day, hour] = key.split('-').map(Number);
            return {
              day,
              hour,
              count,
              dayName: [
                'Sunday',
                'Monday',
                'Tuesday',
                'Wednesday',
                'Thursday',
                'Friday',
                'Saturday',
              ][day],
              timeLabel: formatHour(hour),
            };
          });
        const topSites = Object.entries(siteCounts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([site, count]) => ({ site, count }));
        return { hasEnoughData: true, riskTimes, topSites };
      }
      function formatHour(hour) {
        if (hour === 0) return '12 AM';
        if (hour < 12) return `${hour} AM`;
        if (hour === 12) return '12 PM';
        return `${hour - 12} PM`;
      }
      function broadcastToAllTabs(message) {
        chrome.tabs.query({}, (tabs) => {
          tabs.forEach((tab) => {
            if (tab.id && tab.url && !tab.url.startsWith('chrome://')) {
              chrome.tabs.sendMessage(tab.id, message).catch(() => {});
            }
          });
        });
      }
      chrome.tabs.onRemoved.addListener((tabId) => {
        chrome.storage.local.get(['settings', 'stats', 'runtimeState'], (result) => {
          const settings = mergeSettings(result.settings);
          const stats = mergeStats(result.stats);
          const runtimeState = mergeRuntimeState(result.runtimeState);
          if (runtimeState.sharedDsActiveTabId !== tabId) return;
          if (runtimeState.sharedDsIsActive) {
            finalizeCurrentSession(runtimeState, stats, Date.now());
          }
          runtimeState.sharedDsActiveMs = 0;
          runtimeState.sharedDsNextBreakTargetMs = getNextSharedBreakTargetMs(settings);
          runtimeState.sharedDsLastUpdateAt = 0;
          runtimeState.sharedDsActiveTabId = 0;
          runtimeState.sharedDsIsActive = false;
          runtimeState.sharedDsContextKey = '';
          runtimeState.sharedDsState = SHARED_DS_TIMER_STATES.PAUSED;
          runtimeState.sharedDsPauseReason = SHARED_DS_PAUSE_REASONS.INACTIVE;
          safeStorageSet({ stats, runtimeState });
        });
      });
      chrome.windows.onRemoved.addListener(async () => {
        const windows = await chrome.windows.getAll({ windowTypes: ['normal'] });
        if (windows.length === 0) {
          await resetRuntimeStateForFreshSession('all-windows-closed');
        }
      });
    },
  });
  require_background();
})();
