/**
 * @file popup.js
 * @description EyeFlow Extension Popup Page Controller.
 *
 * @purpose
 * This script runs in the extension popup container (opened when a user clicks
 * the extension icon in the Chrome toolbar). Its responsibilities include:
 *   1. Loading and displaying current settings (Enabled/Disabled status, Sensitivity, Timers).
 *   2. Handling user input changes, validating ranges, and updating local storage.
 *   3. Activating "Work Mode Snooze" (temporarily suspending gentle reminders for 1, 2, or 4 hours).
 *   4. Querying and rendering statistics (such as today's top doom-scrolled sites).
 *   5. Requesting host permissions dynamically when a user configures an administrative Sibling Monitor webhook.
 *   6. Enabling exporting local storage logs or downloading diagnostic logs.
 *
 * @project-fit
 *   - Serves as the UI layer for settings/statistics.
 *   - Communicates with the background Service Worker (`background.js`) using message-passing
 *     `chrome.runtime.sendMessage` to trigger system commands (e.g. trigger test report, update state).
 */

import { clampNumber, TIMER_LIMITS as TIMER_LIMITS_BASE } from './utils.js';

// ============================================================
// POPUP.JS - EyeFlow Extension Popup Logic
// ============================================================
// This handles all the interactive behavior of the popup UI:
//   - Loading settings and stats from Chrome storage
//   - Toggle switches and timer controls
//   - Snooze buttons (work mode pause)
//   - Stats display and pattern insights
//   - Site sensitivity list and redirect suggestions
//   - Saved popup theme switching
// ============================================================

/**
 * DOMContentLoaded Event Listener
 * @description Initializes UI hooks, fetches configuration/stats, binds inputs and buttons.
 *
 * @uses
 *   - document.addEventListener(): Browser API to listen for complete page load.
 */
document.addEventListener('DOMContentLoaded', () => {
  // TIMER_LIMITS is imported from utils.js (shared with background.js).
  // We extend it locally with hydrationReminderHours, which is a display-unit
  // alias (hours) for the underlying storage value (minutes).
  const TIMER_LIMITS = {
    ...TIMER_LIMITS_BASE,
    hydrationReminderHours: { min: 1, max: 4, fallback: 1 },
  };

  // --- DOM Element Selection References ---
  const toggleEnabled = document.getElementById('toggle-enabled');
  const sensitivitySlider = document.getElementById('sensitivity-slider');
  const sensitivityValue = document.getElementById('sensitivity-value');
  const eyeBreakDurationInput = document.getElementById('eye-break-duration-sec');
  const eyeBreakFixedInput = document.getElementById('eye-break-fixed-min');
  const doomReminderInput = document.getElementById('doom-reminder-min');
  const doomReminderMaxInput = document.getElementById('doom-reminder-max');
  const gentleReminderFixedInput = document.getElementById('subtle-reminder-fixed');
  const hydrationReminderInput = document.getElementById('hydration-reminder-hours');
  const subtleReminderMinInput = document.getElementById('subtle-reminder-min');
  const subtleReminderMaxInput = document.getElementById('subtle-reminder-max');
  const timingSummary = document.getElementById('timing-summary');
  const customTimingContent = document.getElementById('custom-timing-content');
  const timingModeFixedButton = document.getElementById('timing-mode-fixed');
  const timingModeSurpriseButton = document.getElementById('timing-mode-surprise');
  const saveAdvancedSettingsButton = document.getElementById('save-advanced-settings');
  const advancedSaveStatus = document.getElementById('advanced-save-status');
  const statusDot = document.querySelector('.status-dot');
  const statusText = document.getElementById('status-text');
  const btnResume = document.getElementById('btn-resume');
  const snoozeStatus = document.getElementById('snooze-status');
  const snoozeUntil = document.getElementById('snooze-until');
  const statsEmptyHelper = document.getElementById('stats-empty-helper');
  const topSitesSection = document.getElementById('top-sites-section');
  const topSitesList = document.getElementById('top-sites-list');
  const insightsNote = document.getElementById('insights-note');
  const webhookUrlInput = document.getElementById('webhook-url-input');
  const btnTestReport = document.getElementById('btn-test-report');
  const testReportStatus = document.getElementById('test-report-status');
  const webhookTokenNotice = document.getElementById('webhook-token-notice');
  const webhookRemovalBlock = document.getElementById('webhook-removal-block');
  const webhookRemovalTokenInput = document.getElementById('webhook-removal-token-input');
  const btnRemoveWebhook = document.getElementById('btn-remove-webhook');
  const webhookRemovalStatus = document.getElementById('webhook-removal-status');

  // --- UI State Tracking Variables ---
  let themeLightButton = null;
  let themeDarkButton = null;
  let currentSettings = null; // Stored settings dictionary
  let currentSnoozeUntil = 0; // Expiry timestamp for active snooze
  let currentTimingMode = 'fixed'; // Active mode: 'fixed' or 'surprise'
  let advancedSettingsDirty = false; // Flag checks if UI inputs match stored parameters

  // DOM elements mapped to display error messages when validations fail
  const fieldErrorMap = {
    'eye-break-duration-sec': document.querySelector('[data-error-for="eye-break-duration-sec"]'),
    'eye-break-fixed-min': document.querySelector('[data-error-for="eye-break-fixed-min"]'),
    'doom-reminder-min': document.querySelector('[data-error-for="doom-reminder-min"]'),
    'doom-reminder-max': document.querySelector('[data-error-for="doom-reminder-max"]'),
    'subtle-reminder-fixed': document.querySelector('[data-error-for="subtle-reminder-fixed"]'),
    'subtle-reminder-min': document.querySelector('[data-error-for="subtle-reminder-min"]'),
    'subtle-reminder-max': document.querySelector('[data-error-for="subtle-reminder-max"]'),
    'hydration-reminder-hours': document.querySelector(
      '[data-error-for="hydration-reminder-hours"]'
    ),
    'webhook-url-input': document.querySelector('[data-error-for="webhook-url-input"]'),
  };

  /**
   * @function runtimeCallbackFailed
   * @description Checks if the latest Chrome API call yielded an error.
   * @returns {boolean} True if an error occurred.
   */
  function runtimeCallbackFailed() {
    return Boolean(chrome.runtime?.lastError);
  }

  // --- Initializer sequence calls ---
  injectThemeSwitcher();
  attachPersistentHandlers();
  loadSettings();
  loadStats();
  loadInsights();

  /**
   * @function checkIncognitoStatus
   * @description Queries if the extension has permissions to run in Incognito mode.
   * If a Webhook is configured, incognito access is crucial so that monitoring can't
   * be bypassed by simply opening an incognito browser tab.
   *
   * @returns {void}
   * @side-effects Updates visibility and options of the Incognito warning card inside the DOM.
   *
   * @uses
   *   - chrome.extension.isAllowedIncognitoAccess(): Chrome Extension API to audit private tab access permission.
   *   - chrome.tabs.create(): Opens the Chrome extension configuration dashboard.
   */
  function checkIncognitoStatus() {
    const isWebhookActive =
      currentSettings && currentSettings.webhookUrl && currentSettings.webhookUrl.trim() !== '';
    const incognitoCard = document.getElementById('incognito-card');
    if (!incognitoCard) return;

    // Only force this check if an administrator Sibling Monitor webhook is configured
    if (!isWebhookActive) {
      incognitoCard.style.display = 'none';
      return;
    }

    if (chrome.extension && chrome.extension.isAllowedIncognitoAccess) {
      chrome.extension.isAllowedIncognitoAccess((isAllowedAccess) => {
        const statusIcon = document.getElementById('incognito-status-icon');
        const statusDesc = document.getElementById('incognito-status-desc');
        const btnEnable = document.getElementById('btn-enable-incognito');

        incognitoCard.style.display = 'block';
        if (isAllowedAccess) {
          statusIcon.textContent = '✅';
          statusDesc.textContent = 'Incognito tracking is currently enabled.';
          btnEnable.style.display = 'none';
        } else {
          statusIcon.textContent = '❌';
          statusDesc.textContent = 'Allow in incognito to track time and eye breaks.';
          btnEnable.style.display = 'inline-block';
          btnEnable.onclick = () => {
            // Direct the user directly to this extension's permission configuration page
            chrome.tabs.create({ url: 'chrome://extensions/?id=' + chrome.runtime.id });
          };
        }
      });
    }
  }

  /**
   * @function injectThemeSwitcher
   * @description Dynamically appends the Light/Dark mode toggler in the header region of the popup.
   * @returns {void}
   * @side-effects Modifies header HTML structure and caches buttons.
   */
  function injectThemeSwitcher() {
    const header = document.querySelector('.popup-header');
    const versionBadge = document.querySelector('.popup-version');
    if (!header || !versionBadge || document.getElementById('theme-switch')) return;

    const headerControls = document.createElement('div');
    headerControls.className = 'popup-header-controls';
    headerControls.innerHTML = `
      <div class="popup-theme-switch popup-theme-switch-compact" id="theme-switch" role="group" aria-label="Popup theme">
        <button class="popup-theme-option popup-theme-option-compact" id="theme-light" type="button" data-theme="light" aria-label="Light mode">L</button>
        <button class="popup-theme-option popup-theme-option-compact" id="theme-dark" type="button" data-theme="dark" aria-label="Dark mode">D</button>
      </div>
    `;

    header.insertBefore(headerControls, versionBadge);
    themeLightButton = headerControls.querySelector('#theme-light');
    themeDarkButton = headerControls.querySelector('#theme-dark');

    // Click handler for theme selections
    headerControls.querySelectorAll('.popup-theme-option').forEach((button) => {
      button.addEventListener('click', () => {
        const nextTheme = button.dataset.theme || 'dark';
        applyPopupTheme(nextTheme);
        currentSettings = { ...(currentSettings || {}), popupTheme: nextTheme };
        saveSettings();
      });
    });
  }

  /**
   * @function attachPersistentHandlers
   * @description Binds standard DOM events (inputs, clicks, slides, state triggers)
   * to their respective logic engines.
   * @returns {void}
   */
  function attachPersistentHandlers() {
    // Primary enable switch
    toggleEnabled.addEventListener('change', saveSettings);

    // Timing Mode button tabs
    timingModeFixedButton.addEventListener('click', () => setTimingMode('fixed'));
    timingModeSurpriseButton.addEventListener('click', () => setTimingMode('surprise'));

    // Sensitivity slider
    sensitivitySlider.addEventListener('input', () => {
      sensitivityValue.textContent = `${sensitivitySlider.value}%`;
      markAdvancedSettingsDirty();
    });
    sensitivitySlider.addEventListener('change', markAdvancedSettingsDirty);

    // Bind clean bounds checking to all numerical inputs
    [
      eyeBreakDurationInput,
      eyeBreakFixedInput,
      doomReminderInput,
      doomReminderMaxInput,
      gentleReminderFixedInput,
      hydrationReminderInput,
      subtleReminderMinInput,
      subtleReminderMaxInput,
    ].forEach((input) => {
      input.addEventListener('input', markAdvancedSettingsDirty);
      input.addEventListener('change', markAdvancedSettingsDirty);
    });

    // Mirrors: Adjusting Fixed mode input mirrors to Surprise fields so ranges stay consistent
    eyeBreakFixedInput.addEventListener('input', () => syncModeMirrorValues('fixed'));
    gentleReminderFixedInput.addEventListener('input', () => syncModeMirrorValues('fixed'));
    doomReminderInput.addEventListener('input', () => syncModeMirrorValues('surprise'));
    doomReminderMaxInput.addEventListener('input', () => syncModeMirrorValues('surprise'));
    subtleReminderMinInput.addEventListener('input', () => syncModeMirrorValues('surprise'));
    subtleReminderMaxInput.addEventListener('input', () => syncModeMirrorValues('surprise'));

    if (webhookUrlInput) {
      webhookUrlInput.addEventListener('input', markAdvancedSettingsDirty);
      webhookUrlInput.addEventListener('change', markAdvancedSettingsDirty);
    }

    // Webhook Test Dispatch Trigger
    if (btnTestReport) {
      btnTestReport.addEventListener('click', () => {
        btnTestReport.disabled = true;
        testReportStatus.textContent = 'Sending...';

        // Dispatches command message to background worker requesting immediate report push
        chrome.runtime.sendMessage({ type: 'TEST_REPORT' }, (response) => {
          btnTestReport.disabled = false;
          if (runtimeCallbackFailed()) {
            testReportStatus.textContent = 'Extension error.';
            return;
          }
          if (response?.success) {
            testReportStatus.textContent = 'Sent!';
            setTimeout(() => (testReportStatus.textContent = ''), 3000);
          } else {
            testReportStatus.textContent = 'Error: ' + (response?.error || 'Unknown');
          }
        });
      });
    }

    // Webhook Removal Handler
    if (btnRemoveWebhook) {
      btnRemoveWebhook.addEventListener('click', () => {
        const token = webhookRemovalTokenInput ? webhookRemovalTokenInput.value.trim() : '';
        if (!token) {
          if (webhookRemovalStatus) webhookRemovalStatus.textContent = 'Please enter PIN.';
          return;
        }
        if (webhookRemovalStatus) webhookRemovalStatus.textContent = 'Verifying...';

        chrome.runtime.sendMessage({ type: 'REMOVE_WEBHOOK', removalToken: token }, (response) => {
          if (runtimeCallbackFailed()) {
            if (webhookRemovalStatus) webhookRemovalStatus.textContent = 'Extension error.';
            return;
          }
          if (response?.success) {
            if (webhookRemovalStatus) webhookRemovalStatus.textContent = 'Webhook removed!';
            if (webhookUrlInput) {
              webhookUrlInput.value = '';
              webhookUrlInput.disabled = false;
              webhookUrlInput.title = '';
            }
            if (webhookRemovalTokenInput) webhookRemovalTokenInput.value = '';
            if (webhookRemovalBlock) webhookRemovalBlock.style.display = 'none';
            if (webhookTokenNotice) webhookTokenNotice.style.display = 'none';

            toggleEnabled.disabled = false;
            toggleEnabled.title = '';

            if (currentSettings) {
              currentSettings.webhookUrl = '';
              currentSettings.webhookRemovalToken = '';
            }
            updateStatusBar(currentSettings);
            checkIncognitoStatus();
            clearAdvancedSettingsDirty('Webhook removed.');
          } else {
            if (webhookRemovalStatus) {
              webhookRemovalStatus.textContent = response?.error || 'Invalid Removal PIN.';
            }
          }
        });
      });
    }

    // Advanced Section save
    saveAdvancedSettingsButton.addEventListener('click', saveAdvancedSettings);

    // JSON Statistics Data Export (Scoped strictly to safe non-credential metrics)
    const btnExportStats = document.getElementById('btn-export-stats');
    if (btnExportStats) {
      btnExportStats.addEventListener('click', () => {
        // Query safe metrics (stats, runtimeState, auditLogs) — excluding settings/webhook credentials
        chrome.storage.local.get(['stats', 'runtimeState', 'auditLogs'], (data) => {
          if (runtimeCallbackFailed()) return;
          const blob = new Blob([JSON.stringify(data || {}, null, 2)], {
            type: 'application/json',
          });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `eyeflow-export-${new Date().toISOString().slice(0, 10)}.json`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        });
      });
    }

    // TXT Diagnostic Audit Log Download
    const btnDownloadAudit = document.getElementById('btn-download-audit');
    if (btnDownloadAudit) {
      btnDownloadAudit.addEventListener('click', () => {
        chrome.storage.local.get(['auditLogs', 'settings'], (data) => {
          if (runtimeCallbackFailed()) return;
          const logs = data.auditLogs || [];
          const settings = data.settings || {};

          let content = '=== EYEFLOW DEBUG AUDIT LOG ===\n';
          content += `Generated: ${new Date().toLocaleString()}\n`;
          content += `Active: ${settings.enabled !== false}\n`;
          content += `Timing Mode: ${settings.timingMode || 'fixed'}\n`;
          content += `Reminder Range: [${settings.reminderIntervalMin || 5}, ${settings.reminderIntervalMax || 5}] min\n`;
          content += `Sensitivity: ${settings.sensitivity !== undefined ? settings.sensitivity : 50}%\n`;
          content += '-------------------------------------------------------------\n\n';

          if (logs.length === 0) {
            content += 'No audit logs recorded yet. Start doom scrolling to generate logs!\n';
          } else {
            content += logs.map((l) => `[${l.timeString}] ${l.event}: ${l.details}`).join('\n');
          }

          const blob = new Blob([content], { type: 'text/plain' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `eyeflow-debug-logs-${new Date().toISOString().slice(0, 10)}.txt`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        });
      });
    }

    // Snooze Hours Selection click triggers
    document.querySelectorAll('.popup-snooze-btn[data-hours]').forEach((button) => {
      button.addEventListener('click', () => {
        const hours = parseInt(button.dataset.hours, 10);
        // Message background service worker to update alarms and state
        chrome.runtime.sendMessage({ type: 'SNOOZE', hours }, (response) => {
          if (runtimeCallbackFailed()) return;
          if (!response?.success) return;
          currentSnoozeUntil = response.until;
          showSnoozeState(response.until);
          updateStatusBar({
            enabled: toggleEnabled.checked,
            snoozedUntil: response.until,
          });
        });
      });
    });

    // Resume/Cancel Snooze trigger
    btnResume.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'RESUME' }, (response) => {
        if (runtimeCallbackFailed()) return;
        if (!response?.success) return;
        currentSnoozeUntil = 0;
        hideSnoozeState();
        updateStatusBar({
          enabled: toggleEnabled.checked,
          snoozedUntil: 0,
        });
      });
    });

    // Accordion Toggle Collapse Actions
    document
      .getElementById('toggle-advanced')
      .addEventListener('click', () =>
        toggleSection('advanced-content', '#toggle-advanced .popup-collapse-icon')
      );
    document
      .getElementById('toggle-work-mode')
      .addEventListener('click', () =>
        toggleSection('work-mode-content', '#toggle-work-mode .popup-collapse-icon')
      );
    document
      .getElementById('toggle-stats')
      .addEventListener('click', () =>
        toggleSection('stats-content', '#toggle-stats .popup-collapse-icon')
      );
  }

  /**
   * @function loadSettings
   * @description Fetches the current preferences dictionary from background context storage.
   * Maps fields to UI nodes and applies active themes.
   */
  function loadSettings() {
    chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (settings) => {
      if (runtimeCallbackFailed()) return;
      if (!settings) return;
      currentSettings = normalizeSettingsForPopup(settings);
      currentTimingMode = inferTimingMode(currentSettings);

      // Lock main toggle switch disabled if Sibling Monitor webhook is active (prevents unauthorized disabling)
      toggleEnabled.checked = currentSettings.enabled;
      if (currentSettings.webhookUrl && currentSettings.webhookUrl.trim() !== '') {
        toggleEnabled.checked = true;
        toggleEnabled.disabled = true;
        toggleEnabled.title = 'Locked by Sibling Monitor / Admin webhook';
        if (webhookUrlInput) {
          webhookUrlInput.disabled = true;
          webhookUrlInput.title = 'Locked by Sibling Monitor. Enter Removal PIN below to unlock.';
        }
        if (webhookRemovalBlock) webhookRemovalBlock.style.display = 'block';
      } else {
        toggleEnabled.disabled = false;
        toggleEnabled.title = '';
        if (webhookUrlInput) {
          webhookUrlInput.disabled = false;
          webhookUrlInput.title = '';
        }
        if (webhookRemovalBlock) webhookRemovalBlock.style.display = 'none';
      }

      sensitivitySlider.value = currentSettings.sensitivity;
      sensitivityValue.textContent = `${currentSettings.sensitivity}%`;

      syncAdvancedInputsFromSettings(currentSettings, currentTimingMode);
      setTimingMode(currentTimingMode, { silent: true });

      updateStatusBar(currentSettings);
      applyPopupTheme(currentSettings.popupTheme || 'dark');
      syncAdvancedUiState();
      clearAdvancedSettingsDirty('Changes apply after you save.');

      // Check if active snooze is pending and render state
      if (currentSettings.snoozedUntil > 0 && Date.now() < currentSettings.snoozedUntil) {
        showSnoozeState(currentSettings.snoozedUntil);
      } else {
        hideSnoozeState();
      }

      checkIncognitoStatus();
    });
  }

  /**
   * @function loadStats
   * @description Fetches statistics dictionary from background storage to render today's active sites cards.
   */
  function loadStats() {
    chrome.runtime.sendMessage({ type: 'GET_STATS' }, (stats) => {
      if (runtimeCallbackFailed()) return;
      if (!stats) return;

      if (statsEmptyHelper) {
        // Toggle empty stats placeholder visual depending on recorded site times
        const hasMeaningfulStats = Object.values(stats.todayDsSiteTimeSpent || {}).some(
          (minutes) => Number(minutes) > 0
        );
        statsEmptyHelper.style.display = hasMeaningfulStats ? 'none' : 'block';
      }

      renderTopDsSites(stats.todayDsSiteTimeSpent || {});
    });
  }

  /**
   * @function loadInsights
   * @description Fetches time-pattern analytical calculations and presents them on the popup dashboard.
   */
  function loadInsights() {
    chrome.runtime.sendMessage({ type: 'GET_PATTERN_INSIGHTS' }, (insights) => {
      if (runtimeCallbackFailed()) return;
      if (!insightsNote) return;
      if (!insights || !insights.hasEnoughData || !insights.riskTimes?.length) {
        insightsNote.style.display = 'none';
        return;
      }

      const topRisk = insights.riskTimes[0];
      insightsNote.textContent = `Peak pattern so far: ${topRisk.dayName}s around ${topRisk.timeLabel}.`;
      insightsNote.style.display = 'block';
    });
  }

  /**
   * @function renderTopDsSites
   * @description Renders visual bar cards showing usage duration of different target social media platforms.
   *
   * @param {Object} siteMinutesMap - Object mapping hostname keys to numerical minutes spent.
   * @returns {void}
   */
  function renderTopDsSites(siteMinutesMap) {
    if (!topSitesSection || !topSitesList) return;

    // Filter sites with time > 0 and sort highest-to-lowest duration
    const rankedSites = Object.entries(siteMinutesMap || {})
      .filter(([, minutes]) => Number(minutes) > 0)
      .sort((a, b) => Number(b[1]) - Number(a[1]));

    if (!rankedSites.length) {
      topSitesSection.style.display = 'none';
      return;
    }

    // Display primary detail cards for top 3 sites, merge any extra sites into a consolidated "Others" card
    const topThree = rankedSites.slice(0, 3);
    const remainingSites = rankedSites.slice(3);
    const cards = topThree.map(([site, minutes], index) =>
      buildTopSiteCard({
        rank: index + 1,
        site,
        minutes,
        isPrimary: index === 0,
      })
    );

    if (remainingSites.length) {
      const otherMinutes = remainingSites.reduce(
        (sum, [, minutes]) => sum + Number(minutes || 0),
        0
      );
      const otherNames = remainingSites.slice(0, 2).map(([site]) => site);
      const extraCount = Math.max(0, remainingSites.length - otherNames.length);
      const label =
        extraCount > 0 ? `${otherNames.join(', ')} + ${extraCount} more` : otherNames.join(', ');

      cards.push(
        buildTopSiteCard({
          rank: '4',
          site: 'Others',
          minutes: otherMinutes,
          isOthers: true,
          subline: label,
        })
      );
    }

    topSitesList.innerHTML = cards.join('');
    topSitesSection.style.display = 'block';
  }

  /**
   * @function buildTopSiteCard
   * @description Renders HTML string structure for a single site's statistics card.
   */
  function buildTopSiteCard({
    rank,
    site,
    minutes,
    isPrimary = false,
    isOthers = false,
    subline = '',
  }) {
    const card = document.createElement('div');
    card.className = `popup-top-site${isPrimary ? ' is-primary' : ''}${isOthers ? ' is-others' : ''}`;

    const row = document.createElement('div');
    row.className = 'popup-top-site-row';

    const rankEl = document.createElement('span');
    rankEl.className = 'popup-top-site-rank';
    rankEl.textContent = rank;

    const nameEl = document.createElement('span');
    nameEl.className = 'popup-top-site-name';
    nameEl.textContent = site; // Safe assign avoids DOM XSS injection

    const timeEl = document.createElement('span');
    timeEl.className = 'popup-top-site-time';
    timeEl.textContent = formatSiteMinutes(minutes);

    row.appendChild(rankEl);
    row.appendChild(nameEl);
    row.appendChild(timeEl);
    card.appendChild(row);

    if (subline) {
      const subEl = document.createElement('div');
      subEl.className = 'popup-top-site-subline';
      subEl.textContent = subline;
      card.appendChild(subEl);
    }

    return card.outerHTML;
  }

  /**
   * @function formatSiteMinutes
   * @description Formatting helper converting total raw minutes to hours + minutes human string.
   */
  function formatSiteMinutes(minutes) {
    const totalMinutes = Math.max(0, Math.round(Number(minutes) || 0));
    if (totalMinutes >= 60) {
      const hours = Math.floor(totalMinutes / 60);
      const remainingMinutes = totalMinutes % 60;
      return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
    }

    return `${totalMinutes}m`;
  }

  /**
   * @function updateStatusBar
   * @description Dynamically alters the visual status indicator region depending on current states.
   */
  function updateStatusBar(settings) {
    const isWebhookActive = settings.webhookUrl && settings.webhookUrl.trim() !== '';
    if (!settings.enabled && !isWebhookActive) {
      statusDot.className = 'status-dot off';
      statusText.textContent = 'Inactive';
    } else if (settings.snoozedUntil > 0 && Date.now() < settings.snoozedUntil) {
      statusDot.className = 'status-dot snoozed';
      statusText.textContent = 'Snoozed - gentle reminders paused';
    } else {
      statusDot.className = 'status-dot active';
      statusText.textContent = isWebhookActive
        ? 'Active - Locked by Sibling Monitor'
        : 'Active - gentle reminders on';
    }
  }

  /**
   * @function saveSettings
   * @description Normalizes current local UI states and saves them to local storage,
   * triggering system events in background.js.
   */
  function saveSettings(options = {}) {
    const onSuccess = typeof options.onSuccess === 'function' ? options.onSuccess : null;
    const nextSettings = normalizeSettingsForPopup({
      ...(currentSettings || {}),
      enabled: toggleEnabled.checked,
      timingMode: currentSettings?.timingMode || currentTimingMode,
      customTimingEnabled: Boolean(currentSettings?.customTimingEnabled),
      sensitivity: currentSettings?.sensitivity,
      eyeBreakDurationSec: currentSettings?.eyeBreakDurationSec,
      reminderIntervalMin: currentSettings?.reminderIntervalMin,
      reminderIntervalMax: currentSettings?.reminderIntervalMax,
      hydrationReminderMin: currentSettings?.hydrationReminderMin,
      subtleReminderMin: currentSettings?.subtleReminderMin,
      subtleReminderMax: currentSettings?.subtleReminderMax,
      popupTheme: currentSettings?.popupTheme ?? document.body.dataset.theme ?? 'dark',
      hydrationBreakDurationSec: currentSettings?.hydrationBreakDurationSec ?? 40,
      subtleReminderEnabled: currentSettings?.subtleReminderEnabled ?? true,
      soundReminderEnabled: currentSettings?.soundReminderEnabled ?? false,
      soundReminderMin: currentSettings?.soundReminderMin ?? 20,
      soundReminderMax: currentSettings?.soundReminderMax ?? 30,
      snoozedUntil: currentSnoozeUntil || 0,
      // Keep silent sensitive tiers intact
      siteTiers: currentSettings?.siteTiers || {},
    });

    currentSettings = nextSettings;
    chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings: nextSettings }, (response) => {
      if (runtimeCallbackFailed()) return;
      if (response?.success && onSuccess) {
        onSuccess(nextSettings);
      }
    });
    updateStatusBar(nextSettings);
    return nextSettings;
  }

  /**
   * @function saveAdvancedSettings
   * @description Parses, validates, and processes inputs inside the advanced collapsed accordion form.
   * If a new monitor webhook is specified, requests host permissions dynamically first.
   *
   * @returns {void}
   *
   * @uses
   *   - chrome.permissions.request(): Chrome Extension permission API required to perform network calls
   *     to arbitrary third-party endpoints (webhook URL host origins) in Manifest V3.
   */
  function saveAdvancedSettings() {
    const formState = collectAdvancedFormState();
    const validation = validateAdvancedFormState(formState);
    applyAdvancedValidation(validation.errors);

    if (!validation.valid) {
      syncAdvancedUiState();
      return;
    }

    const nextSettings = buildAdvancedSettingsFromForm(formState, validation.normalized);

    // Storage write closure executing after permission request resolution
    const saveSettingsToStorage = () => {
      currentSettings = nextSettings;
      currentTimingMode = formState.timingMode;
      syncAdvancedInputsFromSettings(nextSettings, currentTimingMode);
      syncModeButtons();
      syncAdvancedUiState();

      if (nextSettings.webhookUrl && nextSettings.webhookUrl.trim() !== '') {
        toggleEnabled.checked = true;
        toggleEnabled.disabled = true;
        toggleEnabled.title = 'Locked by Sibling Monitor / Admin webhook';
      } else {
        toggleEnabled.disabled = false;
        toggleEnabled.title = '';
      }
      updateStatusBar(nextSettings);
      checkIncognitoStatus();

      chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings: nextSettings }, (response) => {
        if (runtimeCallbackFailed()) return;
        if (!response?.success) return;

        if (response.settings) {
          currentSettings = normalizeSettingsForPopup(response.settings);
          if (response.settings.webhookRemovalToken && response.settings.webhookUrl) {
            if (webhookTokenNotice) {
              webhookTokenNotice.style.display = 'block';
              webhookTokenNotice.innerHTML = `🔒 Webhook active! Removal PIN: <b>${response.settings.webhookRemovalToken}</b> (Save this PIN to unlock/remove)`;
            }
          }
        }
        syncAdvancedInputsFromSettings(currentSettings, currentTimingMode);
        clearAdvancedSettingsDirty('Settings saved');
        window.setTimeout(() => {
          collapseSection('advanced-content', '#toggle-advanced .popup-collapse-icon');
        }, 2000);
      });
    };

    const newWebhookUrl = nextSettings.webhookUrl;
    // Check if user set or modified the Sibling Monitor webhook URL
    if (newWebhookUrl && newWebhookUrl !== (currentSettings?.webhookUrl || '')) {
      try {
        const urlObj = new URL(newWebhookUrl);
        // Build wildcard match origin for the target host endpoint (e.g. "https://discord.com/*")
        const origin = `${urlObj.protocol}//${urlObj.hostname}/*`;

        // Request user approval to access network endpoint
        chrome.permissions.request({ origins: [origin] }, (granted) => {
          if (runtimeCallbackFailed()) {
            applyAdvancedValidation({ 'webhook-url-input': 'Extension permission error.' });
            return;
          }
          if (!granted) {
            applyAdvancedValidation({
              'webhook-url-input': 'Host permission denied. Webhook URL cannot be saved.',
            });
            return;
          }
          saveSettingsToStorage();
        });
      } catch (e) {
        applyAdvancedValidation({ 'webhook-url-input': 'Invalid URL format.' });
      }
    } else {
      saveSettingsToStorage();
    }
  }

  /**
   * @function normalizeSettingsForPopup
   * @description Clamps raw fields to safe ranges before processing.
   */
  function normalizeSettingsForPopup(settings) {
    const subtleReminderMin = clampNumber(
      settings.subtleReminderMin,
      TIMER_LIMITS.subtleReminderMin.min,
      TIMER_LIMITS.subtleReminderMin.max,
      TIMER_LIMITS.subtleReminderMin.fallback
    );
    const subtleReminderMax = clampNumber(
      settings.subtleReminderMax,
      subtleReminderMin,
      TIMER_LIMITS.subtleReminderMax.max,
      Math.max(subtleReminderMin, TIMER_LIMITS.subtleReminderMax.fallback)
    );

    const doomReminderMin = clampNumber(
      settings.reminderIntervalMin,
      TIMER_LIMITS.doomReminderMin.min,
      TIMER_LIMITS.doomReminderMin.max,
      TIMER_LIMITS.doomReminderMin.fallback
    );
    const doomReminderMax = clampNumber(
      settings.reminderIntervalMax,
      doomReminderMin,
      TIMER_LIMITS.doomReminderMax.max,
      Math.max(doomReminderMin, TIMER_LIMITS.doomReminderMax.fallback)
    );

    const isWebhookActive = settings.webhookUrl && settings.webhookUrl.trim() !== '';

    return {
      ...settings,
      enabled: isWebhookActive ? true : Boolean(settings.enabled),
      timingMode: settings.timingMode || null,
      customTimingEnabled: Boolean(settings.customTimingEnabled),
      sensitivity: clampNumber(settings.sensitivity, 0, 100, 50),
      eyeBreakDurationSec: clampNumber(
        settings.eyeBreakDurationSec,
        TIMER_LIMITS.eyeBreakDurationSec.min,
        TIMER_LIMITS.eyeBreakDurationSec.max,
        TIMER_LIMITS.eyeBreakDurationSec.fallback
      ),
      reminderIntervalMin: doomReminderMin,
      reminderIntervalMax: doomReminderMax,
      hydrationReminderMin: clampNumber(
        settings.hydrationReminderMin,
        TIMER_LIMITS.hydrationReminderHours.min * 60,
        TIMER_LIMITS.hydrationReminderHours.max * 60,
        TIMER_LIMITS.hydrationReminderHours.fallback * 60
      ),
      subtleReminderMin,
      subtleReminderMax,
    };
  }

  /**
   * @function inferTimingMode
   * @description Deduces if active settings represent a static ('fixed') timing pattern
   * or a variable ('surprise') range timing pattern.
   */
  function inferTimingMode(settings) {
    if (settings?.timingMode === 'fixed' || settings?.timingMode === 'surprise') {
      return settings.timingMode;
    }

    if ((settings?.reminderIntervalMin || 0) !== (settings?.reminderIntervalMax || 0)) {
      return 'surprise';
    }

    if ((settings?.subtleReminderMin || 0) !== (settings?.subtleReminderMax || 0)) {
      return 'surprise';
    }

    return 'fixed';
  }

  /**
   * @function syncAdvancedInputsFromSettings
   * @description Refreshes advanced form field values to align with settings values.
   */
  function syncAdvancedInputsFromSettings(settings, timingMode = inferTimingMode(settings)) {
    eyeBreakDurationInput.value = settings.eyeBreakDurationSec;
    eyeBreakFixedInput.value = getRepresentativeSingleValue(
      settings.reminderIntervalMin,
      settings.reminderIntervalMax
    );
    doomReminderInput.value = settings.reminderIntervalMin;
    doomReminderMaxInput.value = settings.reminderIntervalMax;
    gentleReminderFixedInput.value = getRepresentativeSingleValue(
      settings.subtleReminderMin,
      settings.subtleReminderMax
    );
    hydrationReminderInput.value = minutesToHours(settings.hydrationReminderMin);
    subtleReminderMinInput.value = settings.subtleReminderMin;
    subtleReminderMaxInput.value = settings.subtleReminderMax;
    if (webhookUrlInput) {
      webhookUrlInput.value = settings.webhookUrl || '';
      const isWebhookActive = Boolean(settings.webhookUrl && settings.webhookUrl.trim() !== '');
      webhookUrlInput.disabled = isWebhookActive;
      webhookUrlInput.title = isWebhookActive
        ? 'Locked by Sibling Monitor. Enter Removal PIN below to unlock.'
        : '';
      if (webhookRemovalBlock)
        webhookRemovalBlock.style.display = isWebhookActive ? 'block' : 'none';
    }
    setTimingMode(timingMode, { silent: true });
  }

  /**
   * @function setTimingMode
   * @description Toggles CSS layouts showing single inputs (Fixed) or ranges (Surprise/Random).
   */
  function setTimingMode(mode, options = {}) {
    currentTimingMode = mode === 'surprise' ? 'surprise' : 'fixed';

    if (timingModeFixedButton) {
      timingModeFixedButton.classList.toggle('active', currentTimingMode === 'fixed');
      timingModeFixedButton.setAttribute('aria-pressed', String(currentTimingMode === 'fixed'));
    }

    if (timingModeSurpriseButton) {
      timingModeSurpriseButton.classList.toggle('active', currentTimingMode === 'surprise');
      timingModeSurpriseButton.setAttribute(
        'aria-pressed',
        String(currentTimingMode === 'surprise')
      );
    }

    customTimingContent.style.display = 'grid';
    document.querySelectorAll('[data-timing-field="fixed"]').forEach((field) => {
      field.style.display = currentTimingMode === 'fixed' ? 'grid' : 'none';
    });
    document.querySelectorAll('[data-timing-field="surprise"]').forEach((field) => {
      field.style.display = currentTimingMode === 'surprise' ? 'grid' : 'none';
    });

    timingSummary.textContent =
      currentTimingMode === 'fixed'
        ? 'The same interval will repeat each cycle.'
        : 'A random time within your range will be chosen each cycle.';

    if (!options.silent) {
      syncAdvancedUiState();
    }
  }

  /**
   * @function markAdvancedSettingsDirty
   * @description Sets dirty flag and refreshes button save states.
   */
  function markAdvancedSettingsDirty() {
    advancedSettingsDirty = true;
    syncAdvancedUiState();
  }

  /**
   * @function clearAdvancedSettingsDirty
   * @description Resets status dirty flags.
   */
  function clearAdvancedSettingsDirty(message) {
    advancedSettingsDirty = false;
    advancedSaveStatus.textContent = message;
    advancedSaveStatus.classList.remove('dirty');
    advancedSaveStatus.classList.toggle('saved', message === 'Settings saved');
  }

  /**
   * @function syncModeButtons
   * @description Updates visual timing buttons.
   */
  function syncModeButtons() {
    setTimingMode(currentTimingMode, { silent: true });
  }

  /**
   * @function syncModeMirrorValues
   * @description Synchronizes and updates mirrored value settings when switching views.
   */
  function syncModeMirrorValues(mode) {
    if (mode === 'fixed') {
      const fixedEyeValue = clampNumber(
        eyeBreakFixedInput.value,
        TIMER_LIMITS.doomReminderMin.min,
        TIMER_LIMITS.doomReminderMin.max,
        TIMER_LIMITS.doomReminderMin.fallback
      );
      doomReminderInput.value = fixedEyeValue;
      doomReminderMaxInput.value = fixedEyeValue;

      const fixedGentleValue = clampNumber(
        gentleReminderFixedInput.value,
        TIMER_LIMITS.subtleReminderMin.min,
        TIMER_LIMITS.subtleReminderMax.max,
        TIMER_LIMITS.subtleReminderMin.fallback
      );
      subtleReminderMinInput.value = fixedGentleValue;
      subtleReminderMaxInput.value = fixedGentleValue;
    } else {
      const eyeBreakMin = clampNumber(
        doomReminderInput.value,
        TIMER_LIMITS.doomReminderMin.min,
        TIMER_LIMITS.doomReminderMin.max,
        TIMER_LIMITS.doomReminderMin.fallback
      );
      const eyeBreakMax = clampNumber(
        doomReminderMaxInput.value,
        eyeBreakMin,
        TIMER_LIMITS.doomReminderMax.max,
        Math.max(eyeBreakMin, TIMER_LIMITS.doomReminderMax.fallback)
      );
      eyeBreakFixedInput.value = getRepresentativeSingleValue(eyeBreakMin, eyeBreakMax);

      const gentleMin = clampNumber(
        subtleReminderMinInput.value,
        TIMER_LIMITS.subtleReminderMin.min,
        TIMER_LIMITS.subtleReminderMin.max,
        TIMER_LIMITS.subtleReminderMin.fallback
      );
      const gentleMax = clampNumber(
        subtleReminderMaxInput.value,
        gentleMin,
        TIMER_LIMITS.subtleReminderMax.max,
        Math.max(gentleMin, TIMER_LIMITS.subtleReminderMax.fallback)
      );
      gentleReminderFixedInput.value = getRepresentativeSingleValue(gentleMin, gentleMax);
    }
  }

  /**
   * @function getRepresentativeSingleValue
   * @description Averages range boundaries to represent a single fallback value.
   */
  function getRepresentativeSingleValue(minValue, maxValue) {
    const min = Number(minValue);
    const max = Number(maxValue);
    if (!Number.isFinite(min) && !Number.isFinite(max))
      return TIMER_LIMITS.doomReminderMin.fallback;
    if (!Number.isFinite(min))
      return clampNumber(
        max,
        TIMER_LIMITS.doomReminderMin.min,
        TIMER_LIMITS.doomReminderMin.max,
        TIMER_LIMITS.doomReminderMin.fallback
      );
    if (!Number.isFinite(max))
      return clampNumber(
        min,
        TIMER_LIMITS.doomReminderMin.min,
        TIMER_LIMITS.doomReminderMin.max,
        TIMER_LIMITS.doomReminderMin.fallback
      );
    return clampNumber(
      Math.round((min + max) / 2),
      TIMER_LIMITS.doomReminderMin.min,
      TIMER_LIMITS.doomReminderMin.max,
      TIMER_LIMITS.doomReminderMin.fallback
    );
  }

  /**
   * @function collectAdvancedFormState
   * @description Pulls and compiles all values from popup form fields.
   */
  function collectAdvancedFormState() {
    const state = {
      timingMode: currentTimingMode,
      enabled: toggleEnabled.checked,
      sensitivity: clampNumber(sensitivitySlider.value, 0, 100, 50),
      eyeBreakDurationSec: eyeBreakDurationInput.value,
      hydrationReminderMin: hoursToMinutes(hydrationReminderInput.value),
      popupTheme: currentSettings?.popupTheme ?? document.body.dataset.theme ?? 'dark',
      hydrationBreakDurationSec: currentSettings?.hydrationBreakDurationSec ?? 40,
      subtleReminderEnabled: currentSettings?.subtleReminderEnabled ?? true,
      soundReminderEnabled: currentSettings?.soundReminderEnabled ?? false,
      soundReminderMin: currentSettings?.soundReminderMin ?? 20,
      soundReminderMax: currentSettings?.soundReminderMax ?? 30,
      snoozedUntil: currentSnoozeUntil || 0,
      siteTiers: currentSettings?.siteTiers || {},

      webhookUrl: webhookUrlInput ? webhookUrlInput.value.trim() : '',
    };

    if (currentTimingMode === 'fixed') {
      state.reminderIntervalMin = eyeBreakFixedInput.value;
      state.reminderIntervalMax = eyeBreakFixedInput.value;
      state.subtleReminderMin = gentleReminderFixedInput.value;
      state.subtleReminderMax = gentleReminderFixedInput.value;
      state.customTimingEnabled = true;
    } else {
      state.reminderIntervalMin = doomReminderInput.value;
      state.reminderIntervalMax = doomReminderMaxInput.value;
      state.subtleReminderMin = subtleReminderMinInput.value;
      state.subtleReminderMax = subtleReminderMaxInput.value;
      state.customTimingEnabled = true;
    }

    return state;
  }

  /**
   * @function buildAdvancedSettingsFromForm
   * @description Compiles final form values into a validated settings dictionary.
   */
  function buildAdvancedSettingsFromForm(formState, normalized = {}) {
    const nextSettings = normalizeSettingsForPopup({
      ...(currentSettings || {}),
      enabled: formState.enabled,
      customTimingEnabled: true,
      timingMode: formState.timingMode,
      sensitivity: formState.sensitivity,
      eyeBreakDurationSec: formState.eyeBreakDurationSec,
      reminderIntervalMin: formState.reminderIntervalMin,
      reminderIntervalMax: formState.reminderIntervalMax,
      hydrationReminderMin: formState.hydrationReminderMin,
      subtleReminderMin: formState.subtleReminderMin,
      subtleReminderMax: formState.subtleReminderMax,
      popupTheme: formState.popupTheme,
      hydrationBreakDurationSec: formState.hydrationBreakDurationSec,
      subtleReminderEnabled: formState.subtleReminderEnabled,
      soundReminderEnabled: formState.soundReminderEnabled,
      soundReminderMin: formState.soundReminderMin,
      soundReminderMax: formState.soundReminderMax,
      webhookUrl: formState.webhookUrl,
      snoozedUntil: formState.snoozedUntil,
      siteTiers: formState.siteTiers,
    });

    nextSettings.eyeBreakDurationSec = normalized.eyeBreakDurationSec;
    nextSettings.reminderIntervalMin = normalized.reminderIntervalMin;
    nextSettings.reminderIntervalMax = normalized.reminderIntervalMax;
    nextSettings.hydrationReminderMin = normalized.hydrationReminderMin;
    nextSettings.subtleReminderMin = normalized.subtleReminderMin;
    nextSettings.subtleReminderMax = normalized.subtleReminderMax;

    return nextSettings;
  }

  /**
   * @function validateAdvancedFormState
   * @description Audits inputs against ranges inside `TIMER_LIMITS` and lists error keys.
   */
  function validateAdvancedFormState(formState) {
    const errors = {};

    const eyeBreakDuration = clampNumber(
      formState.eyeBreakDurationSec,
      TIMER_LIMITS.eyeBreakDurationSec.min,
      TIMER_LIMITS.eyeBreakDurationSec.max,
      TIMER_LIMITS.eyeBreakDurationSec.fallback
    );
    const hydrationHours = clampNumber(
      hydrationReminderInput.value,
      TIMER_LIMITS.hydrationReminderHours.min,
      TIMER_LIMITS.hydrationReminderHours.max,
      TIMER_LIMITS.hydrationReminderHours.fallback
    );

    if (Number(formState.eyeBreakDurationSec) !== eyeBreakDuration) {
      errors['eye-break-duration-sec'] = 'Enter a value between 15 and 40 sec';
    }

    if (Number(hydrationReminderInput.value) !== hydrationHours) {
      errors['hydration-reminder-hours'] = 'Enter a value between 1 and 4 hours';
    }

    if (formState.timingMode === 'fixed') {
      const eyeBreakFixed = clampNumber(
        eyeBreakFixedInput.value,
        TIMER_LIMITS.doomReminderMin.min,
        TIMER_LIMITS.doomReminderMin.max,
        TIMER_LIMITS.doomReminderMin.fallback
      );
      const gentleFixed = clampNumber(
        gentleReminderFixedInput.value,
        TIMER_LIMITS.subtleReminderMin.min,
        TIMER_LIMITS.subtleReminderMax.max,
        TIMER_LIMITS.subtleReminderMin.fallback
      );

      if (Number(eyeBreakFixedInput.value) !== eyeBreakFixed) {
        errors['eye-break-fixed-min'] = 'Enter a value between 5 and 30 min';
      }
      if (Number(gentleReminderFixedInput.value) !== gentleFixed) {
        errors['subtle-reminder-fixed'] = 'Enter a value between 20 and 60 min';
      }

      return {
        valid: Object.keys(errors).length === 0,
        errors,
        normalized: {
          eyeBreakDurationSec: eyeBreakDuration,
          hydrationReminderMin: hydrationHours * 60,
          reminderIntervalMin: eyeBreakFixed,
          reminderIntervalMax: eyeBreakFixed,
          subtleReminderMin: gentleFixed,
          subtleReminderMax: gentleFixed,
        },
      };
    }

    const eyeBreakMin = clampNumber(
      doomReminderInput.value,
      TIMER_LIMITS.doomReminderMin.min,
      TIMER_LIMITS.doomReminderMin.max,
      TIMER_LIMITS.doomReminderMin.fallback
    );
    const eyeBreakMax = clampNumber(
      doomReminderMaxInput.value,
      eyeBreakMin,
      TIMER_LIMITS.doomReminderMax.max,
      Math.max(eyeBreakMin, TIMER_LIMITS.doomReminderMax.fallback)
    );
    const gentleMin = clampNumber(
      subtleReminderMinInput.value,
      TIMER_LIMITS.subtleReminderMin.min,
      TIMER_LIMITS.subtleReminderMin.max,
      TIMER_LIMITS.subtleReminderMin.fallback
    );
    const gentleMax = clampNumber(
      subtleReminderMaxInput.value,
      gentleMin,
      TIMER_LIMITS.subtleReminderMax.max,
      Math.max(gentleMin, TIMER_LIMITS.subtleReminderMax.fallback)
    );

    if (Number(doomReminderInput.value) !== eyeBreakMin) {
      errors['doom-reminder-min'] = 'Enter a value between 5 and 30 min';
    }
    if (Number(doomReminderMaxInput.value) !== eyeBreakMax) {
      if (Number(doomReminderMaxInput.value) < eyeBreakMin) {
        errors['doom-reminder-max'] = 'Min cannot be greater than max';
      } else {
        errors['doom-reminder-max'] = 'Enter a value between 5 and 30 min';
      }
    }

    if (Number(subtleReminderMinInput.value) !== gentleMin) {
      errors['subtle-reminder-min'] = 'Enter a value between 20 and 60 min';
    }
    if (Number(subtleReminderMaxInput.value) !== gentleMax) {
      if (Number(subtleReminderMaxInput.value) < gentleMin) {
        errors['subtle-reminder-max'] = 'Min cannot be greater than max';
      } else {
        errors['subtle-reminder-max'] = 'Enter a value between 20 and 60 min';
      }
    }

    // Verify webhook is format-compliant if configured
    if (formState.webhookUrl) {
      try {
        new URL(formState.webhookUrl);
      } catch (e) {
        errors['webhook-url-input'] = 'Enter a valid URL (e.g. https://formspree.io/f/...)';
      }
    }

    return {
      valid: Object.keys(errors).length === 0,
      errors,
      normalized: {
        eyeBreakDurationSec: eyeBreakDuration,
        hydrationReminderMin: hydrationHours * 60,
        reminderIntervalMin: eyeBreakMin,
        reminderIntervalMax: eyeBreakMax,
        subtleReminderMin: gentleMin,
        subtleReminderMax: gentleMax,
      },
    };
  }

  /**
   * @function applyAdvancedValidation
   * @description Renders visual error descriptions next to invalid input fields.
   */
  function applyAdvancedValidation(errors) {
    Object.entries(fieldErrorMap).forEach(([fieldName, el]) => {
      if (!el) return;
      const message = errors[fieldName] || '';
      el.textContent = message;
      el.style.display = message ? 'block' : 'none';
      const input = document.getElementById(fieldName);
      if (input) {
        input.classList.toggle('has-error', Boolean(message));
        input.setAttribute('aria-invalid', String(Boolean(message)));
        const inputWrapper = input.closest('.popup-inline-input');
        if (inputWrapper) {
          inputWrapper.classList.toggle('error', Boolean(message));
        }
      }
    });
  }

  /**
   * @function isAdvancedSettingsDirty
   * @description Compares current form input states with stored configurations.
   */
  function isAdvancedSettingsDirty(formState) {
    if (!currentSettings) return true;
    const currentSnapshot = {
      enabled: currentSettings.enabled,
      timingMode: inferTimingMode(currentSettings),
      sensitivity: currentSettings.sensitivity,
      eyeBreakDurationSec: currentSettings.eyeBreakDurationSec,
      reminderIntervalMin: currentSettings.reminderIntervalMin,
      reminderIntervalMax: currentSettings.reminderIntervalMax,
      hydrationReminderMin: currentSettings.hydrationReminderMin,
      subtleReminderMin: currentSettings.subtleReminderMin,
      subtleReminderMax: currentSettings.subtleReminderMax,
      webhookUrl: currentSettings.webhookUrl || '',
    };

    const nextSnapshot = {
      enabled: formState.enabled,
      timingMode: formState.timingMode,
      sensitivity: formState.sensitivity,
      eyeBreakDurationSec: Number(formState.eyeBreakDurationSec),
      reminderIntervalMin: Number(formState.reminderIntervalMin),
      reminderIntervalMax: Number(formState.reminderIntervalMax),
      hydrationReminderMin: formState.hydrationReminderMin,
      subtleReminderMin: Number(formState.subtleReminderMin),
      subtleReminderMax: Number(formState.subtleReminderMax),
      webhookUrl: formState.webhookUrl || '',
    };

    return JSON.stringify(currentSnapshot) !== JSON.stringify(nextSnapshot);
  }

  /**
   * @function syncAdvancedUiState
   * @description Controls active statuses, enabling or disabling the Advanced Save button.
   */
  function syncAdvancedUiState() {
    const formState = collectAdvancedFormState();
    const validation = validateAdvancedFormState(formState);
    applyAdvancedValidation(validation.errors);

    const dirty = isAdvancedSettingsDirty(formState);
    advancedSettingsDirty = dirty;

    if (!validation.valid) {
      saveAdvancedSettingsButton.disabled = true;
      advancedSaveStatus.textContent = 'Fix the highlighted fields.';
      advancedSaveStatus.classList.add('dirty');
      advancedSaveStatus.classList.remove('saved');
      return;
    }

    saveAdvancedSettingsButton.disabled = !dirty;
    if (dirty) {
      advancedSaveStatus.textContent = 'Unsaved changes.';
      advancedSaveStatus.classList.add('dirty');
      advancedSaveStatus.classList.remove('saved');
    } else {
      advancedSaveStatus.textContent = 'Changes apply after you save.';
      advancedSaveStatus.classList.remove('dirty');
      advancedSaveStatus.classList.remove('saved');
    }
  }

  /**
   * @function applyPopupTheme
   * @description Sets the active dataset attribute on the body tag to toggle CSS visual styling.
   */
  function applyPopupTheme(theme) {
    const resolvedTheme = theme === 'light' ? 'light' : 'dark';
    document.body.dataset.theme = resolvedTheme;

    if (themeLightButton) {
      themeLightButton.classList.toggle('active', resolvedTheme === 'light');
      themeLightButton.setAttribute('aria-pressed', String(resolvedTheme === 'light'));
    }

    if (themeDarkButton) {
      themeDarkButton.classList.toggle('active', resolvedTheme === 'dark');
      themeDarkButton.setAttribute('aria-pressed', String(resolvedTheme === 'dark'));
    }
  }

  /**
   * @function showSnoozeState
   * @description Renders UI overlays denoting an active Snooze mode, hiding standard buttons.
   */
  function showSnoozeState(until) {
    currentSnoozeUntil = until;
    const date = new Date(until);
    snoozeUntil.textContent = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    snoozeStatus.style.display = 'block';
    btnResume.style.display = 'flex';
    btnResume.textContent = 'Cancel Snooze';
    document.querySelectorAll('.popup-snooze-btn[data-hours]').forEach((button) => {
      button.style.display = 'none';
    });
    openSection('work-mode-content', '#toggle-work-mode .popup-collapse-icon');
  }

  /**
   * @function hideSnoozeState
   * @description Cleans up Snooze indicators and reveals standard Snooze option buttons.
   */
  function hideSnoozeState() {
    snoozeStatus.style.display = 'none';
    btnResume.style.display = 'none';
    document.querySelectorAll('.popup-snooze-btn[data-hours]').forEach((button) => {
      button.style.display = 'flex';
    });
  }

  /**
   * @function toggleSection
   * @description Collapses or expands accordion components.
   */
  function toggleSection(contentId, iconSelector) {
    const content = document.getElementById(contentId);
    const icon = document.querySelector(iconSelector);
    const isOpen = content.style.display !== 'none';

    content.style.display = isOpen ? 'none' : 'block';
    icon.classList.toggle('open', !isOpen);
  }

  /**
   * @function collapseSection
   * @description Shuts accordion components.
   */
  function collapseSection(contentId, iconSelector) {
    const content = document.getElementById(contentId);
    const icon = document.querySelector(iconSelector);
    if (content) content.style.display = 'none';
    if (icon) icon.classList.remove('open');
  }

  /**
   * @function openSection
   * @description Launches accordion components.
   */
  function openSection(contentId, iconSelector) {
    const content = document.getElementById(contentId);
    const icon = document.querySelector(iconSelector);
    if (content) content.style.display = 'block';
    if (icon) icon.classList.add('open');
  }

  /**
   * @function hoursToMinutes
   * @description Utility translating display hours value into storage minutes.
   */
  function hoursToMinutes(value) {
    return (
      clampNumber(
        value,
        TIMER_LIMITS.hydrationReminderHours.min,
        TIMER_LIMITS.hydrationReminderHours.max,
        TIMER_LIMITS.hydrationReminderHours.fallback
      ) * 60
    );
  }

  /**
   * @function minutesToHours
   * @description Utility translating storage minutes value into display hours.
   */
  function minutesToHours(value) {
    const roundedHours = Math.round(Number(value) / 60);
    return clampNumber(
      roundedHours,
      TIMER_LIMITS.hydrationReminderHours.min,
      TIMER_LIMITS.hydrationReminderHours.max,
      TIMER_LIMITS.hydrationReminderHours.fallback
    );
  }
});
