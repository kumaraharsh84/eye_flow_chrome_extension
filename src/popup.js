/**
 * @file popup.js
 * @description Controller for the toolbar popup: master switch, advanced timing
 * settings, work-mode snooze, weekly-report webhook and today's stats.
 *
 * The popup never writes settings to storage itself. Everything goes through the
 * service worker (SAVE_SETTINGS, SNOOZE, ...), which validates and persists it.
 */

import { isValidWebhookUrl, TIMER_LIMITS } from './utils.js';

document.addEventListener('DOMContentLoaded', () => {
  const $ = (id) => document.getElementById(id);

  const toggleEnabled = $('toggle-enabled');
  const statusDot = document.querySelector('.status-dot');
  const statusText = $('status-text');
  const sensitivitySlider = $('sensitivity-slider');
  const sensitivityValue = $('sensitivity-value');
  const gentleEnabledInput = $('subtle-reminder-enabled');
  const soundEnabledInput = $('sound-reminder-enabled');
  const eyeBreakDurationInput = $('eye-break-duration-sec');
  const eyeBreakFixedInput = $('eye-break-fixed-min');
  const eyeBreakMinInput = $('doom-reminder-min');
  const eyeBreakMaxInput = $('doom-reminder-max');
  const gentleFixedInput = $('subtle-reminder-fixed');
  const gentleMinInput = $('subtle-reminder-min');
  const gentleMaxInput = $('subtle-reminder-max');
  const hydrationHoursInput = $('hydration-reminder-hours');
  const webhookUrlInput = $('webhook-url-input');
  const timingSummary = $('timing-summary');
  const timingModeFixedButton = $('timing-mode-fixed');
  const timingModeSurpriseButton = $('timing-mode-surprise');
  const saveButton = $('save-advanced-settings');
  const saveStatus = $('advanced-save-status');
  const btnTestReport = $('btn-test-report');
  const testReportStatus = $('test-report-status');
  const webhookPinNotice = $('webhook-token-notice');
  const webhookRemovalBlock = $('webhook-removal-block');
  const webhookRemovalInput = $('webhook-removal-token-input');
  const webhookRemovalStatus = $('webhook-removal-status');
  const btnResume = $('btn-resume');
  const snoozeStatus = $('snooze-status');
  const snoozeUntil = $('snooze-until');
  const snoozeButtons = document.querySelectorAll('.popup-snooze-btn[data-hours]');
  const themeButtons = document.querySelectorAll('.popup-theme-option');

  const FORM_CONTROLS = [
    sensitivitySlider,
    gentleEnabledInput,
    soundEnabledInput,
    eyeBreakDurationInput,
    eyeBreakFixedInput,
    eyeBreakMinInput,
    eyeBreakMaxInput,
    gentleFixedInput,
    gentleMinInput,
    gentleMaxInput,
    hydrationHoursInput,
    webhookUrlInput,
    timingModeFixedButton,
    timingModeSurpriseButton,
  ];

  // Keys the advanced form edits; used to detect unsaved changes.
  const FORM_KEYS = [
    'timingMode',
    'sensitivity',
    'subtleReminderEnabled',
    'soundReminderEnabled',
    'eyeBreakDurationSec',
    'reminderIntervalMin',
    'reminderIntervalMax',
    'subtleReminderMin',
    'subtleReminderMax',
    'hydrationReminderMin',
    'webhookUrl',
  ];

  const STATUS_IDLE = 'Changes apply after you save.';
  const STATUS_SAVED = 'Settings saved';

  let settings = null; // Last settings confirmed by the service worker
  let timingMode = 'fixed'; // Mode currently selected in the form

  // -------------------------------------------------------
  // HELPERS
  // -------------------------------------------------------

  /** Sends a message to the service worker; resolves null if it cannot be reached. */
  function send(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          resolve(chrome.runtime.lastError ? null : (response ?? null));
        });
      } catch (error) {
        resolve(null);
      }
    });
  }

  function isWebhookLocked() {
    return Boolean(settings?.webhookUrl);
  }

  /** Parses a whole number within [min, max]; returns null for anything else. */
  function parseInRange(rawValue, { min, max }) {
    const text = String(rawValue).trim();
    if (!/^\d+$/.test(text)) return null;
    const value = Number(text);
    return value >= min && value <= max ? value : null;
  }

  function rangeMessage({ min, max }, unit) {
    return `Enter a value between ${min} and ${max} ${unit}`;
  }

  function downloadFile(filename, content, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function todayStamp() {
    return new Date().toISOString().slice(0, 10);
  }

  function setSectionOpen(name, open) {
    const header = $(`toggle-${name}`);
    const content = $(`${name}-content`);
    content.style.display = open ? 'block' : 'none';
    header.setAttribute('aria-expanded', String(open));
    header.querySelector('.popup-collapse-icon')?.classList.toggle('open', open);
  }

  // -------------------------------------------------------
  // RENDERING
  // -------------------------------------------------------

  function renderStatusBar() {
    const snoozed = settings.snoozedUntil > 0 && Date.now() < settings.snoozedUntil;
    if (!settings.enabled) {
      statusDot.className = 'status-dot off';
      statusText.textContent = 'Inactive';
    } else if (snoozed) {
      statusDot.className = 'status-dot snoozed';
      statusText.textContent = 'Snoozed - gentle reminders paused';
    } else {
      statusDot.className = 'status-dot active';
      statusText.textContent = isWebhookLocked()
        ? 'Active - Locked by Sibling Monitor'
        : 'Active - gentle reminders on';
    }
  }

  function renderTheme() {
    const theme = settings?.popupTheme === 'light' ? 'light' : 'dark';
    document.body.dataset.theme = theme;
    themeButtons.forEach((button) => {
      const isActive = button.dataset.theme === theme;
      button.classList.toggle('active', isActive);
      button.setAttribute('aria-pressed', String(isActive));
    });
  }

  function renderSnooze() {
    const snoozed = settings.snoozedUntil > 0 && Date.now() < settings.snoozedUntil;
    snoozeStatus.style.display = snoozed ? 'block' : 'none';
    btnResume.style.display = snoozed ? 'flex' : 'none';
    snoozeButtons.forEach((button) => {
      button.style.display = snoozed ? 'none' : 'flex';
    });
    if (snoozed) {
      snoozeUntil.textContent = new Date(settings.snoozedUntil).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      });
      setSectionOpen('work-mode', true);
    }
  }

  function renderTimingMode() {
    const isFixed = timingMode === 'fixed';
    timingModeFixedButton.classList.toggle('active', isFixed);
    timingModeFixedButton.setAttribute('aria-pressed', String(isFixed));
    timingModeSurpriseButton.classList.toggle('active', !isFixed);
    timingModeSurpriseButton.setAttribute('aria-pressed', String(!isFixed));

    $('custom-timing-content').style.display = 'grid';
    document.querySelectorAll('[data-timing-field]').forEach((field) => {
      field.style.display = field.dataset.timingField === timingMode ? 'grid' : 'none';
    });
    timingSummary.textContent = isFixed
      ? 'The same interval will repeat each cycle.'
      : 'A random time within your range will be chosen each cycle.';
  }

  /** Fills every control from the confirmed settings. */
  function renderSettings() {
    const locked = isWebhookLocked();
    timingMode = settings.timingMode;

    toggleEnabled.checked = settings.enabled;
    toggleEnabled.disabled = locked;
    toggleEnabled.title = locked ? 'Locked by Sibling Monitor / Admin webhook' : '';

    sensitivitySlider.value = settings.sensitivity;
    sensitivityValue.textContent = `${settings.sensitivity}%`;
    gentleEnabledInput.checked = settings.subtleReminderEnabled;
    soundEnabledInput.checked = settings.soundReminderEnabled;
    eyeBreakDurationInput.value = settings.eyeBreakDurationSec;
    eyeBreakFixedInput.value = settings.reminderIntervalMin;
    eyeBreakMinInput.value = settings.reminderIntervalMin;
    eyeBreakMaxInput.value = settings.reminderIntervalMax;
    gentleFixedInput.value = settings.subtleReminderMin;
    gentleMinInput.value = settings.subtleReminderMin;
    gentleMaxInput.value = settings.subtleReminderMax;
    hydrationHoursInput.value = Math.round(settings.hydrationReminderMin / 60);
    webhookUrlInput.value = settings.webhookUrl || '';

    // While the sibling-monitor webhook is active, nothing can be changed without the PIN.
    FORM_CONTROLS.forEach((control) => {
      control.disabled = locked;
    });
    webhookUrlInput.title = locked
      ? 'Locked by Sibling Monitor. Enter Removal PIN below to unlock.'
      : '';
    webhookRemovalBlock.style.display = locked ? 'block' : 'none';
    btnTestReport.disabled = !locked;
    $('toggle-advanced').title = locked
      ? 'Settings are locked while Sibling Monitor is active'
      : '';

    renderTimingMode();
    renderTheme();
    renderSnooze();
    renderStatusBar();
    renderIncognitoCard();
    updateFormState();
  }

  /** With a webhook active, tracking must also cover incognito windows. */
  function renderIncognitoCard() {
    const card = $('incognito-card');
    if (!isWebhookLocked() || !chrome.extension?.isAllowedIncognitoAccess) {
      card.style.display = 'none';
      return;
    }

    chrome.extension.isAllowedIncognitoAccess((allowed) => {
      card.style.display = 'block';
      $('incognito-status-icon').textContent = allowed ? '✅' : '❌';
      $('incognito-status-desc').textContent = allowed
        ? 'Incognito tracking is currently enabled.'
        : 'Allow in incognito to track time and eye breaks.';
      $('btn-enable-incognito').style.display = allowed ? 'none' : 'inline-block';
    });
  }

  // -------------------------------------------------------
  // ADVANCED FORM
  // -------------------------------------------------------

  /**
   * Reads and validates the advanced form.
   * @returns {{ values: Object, errors: Object }} values use settings keys;
   * errors are keyed by input id.
   */
  function readForm() {
    const errors = {};
    const values = {
      timingMode,
      sensitivity: Number(sensitivitySlider.value),
      subtleReminderEnabled: gentleEnabledInput.checked,
      soundReminderEnabled: soundEnabledInput.checked,
      webhookUrl: webhookUrlInput.value.trim(),
    };

    const read = (input, limits, unit) => {
      const value = parseInRange(input.value, limits);
      if (value === null) errors[input.id] = rangeMessage(limits, unit);
      return value;
    };

    values.eyeBreakDurationSec = read(
      eyeBreakDurationInput,
      TIMER_LIMITS.eyeBreakDurationSec,
      'sec'
    );

    const hours = read(hydrationHoursInput, { min: 1, max: 4 }, 'hours');
    values.hydrationReminderMin = hours === null ? null : hours * 60;

    if (timingMode === 'fixed') {
      values.reminderIntervalMin = read(eyeBreakFixedInput, TIMER_LIMITS.doomReminderMin, 'min');
      values.reminderIntervalMax = values.reminderIntervalMin;
      values.subtleReminderMin = read(gentleFixedInput, TIMER_LIMITS.subtleReminderMin, 'min');
      values.subtleReminderMax = values.subtleReminderMin;
    } else {
      const readRange = (minInput, maxInput, limits) => {
        const min = read(minInput, limits, 'min');
        let max = parseInRange(maxInput.value, limits);
        if (max === null) {
          errors[maxInput.id] = rangeMessage(limits, 'min');
        } else if (min !== null && max < min) {
          errors[maxInput.id] = 'Min cannot be greater than max';
          max = null;
        }
        return [min, max];
      };
      [values.reminderIntervalMin, values.reminderIntervalMax] = readRange(
        eyeBreakMinInput,
        eyeBreakMaxInput,
        TIMER_LIMITS.doomReminderMin
      );
      [values.subtleReminderMin, values.subtleReminderMax] = readRange(
        gentleMinInput,
        gentleMaxInput,
        TIMER_LIMITS.subtleReminderMin
      );
    }

    if (values.webhookUrl && !isWebhookLocked() && !isValidWebhookUrl(values.webhookUrl)) {
      errors['webhook-url-input'] = 'Enter a valid https URL (e.g. https://formspree.io/f/...)';
    }

    return { values, errors };
  }

  function showErrors(errors) {
    document.querySelectorAll('[data-error-for]').forEach((errorElement) => {
      const inputId = errorElement.dataset.errorFor;
      const message = errors[inputId] || '';
      errorElement.textContent = message;
      errorElement.style.display = message ? 'block' : 'none';

      const input = $(inputId);
      if (!input) return;
      input.setAttribute('aria-invalid', String(Boolean(message)));
      input.closest('.popup-inline-input')?.classList.toggle('error', Boolean(message));
    });
  }

  /** Shows validation errors and enables Save only for valid, unsaved changes. */
  function updateFormState({ keepStatus = false } = {}) {
    if (!settings) return;
    const { values, errors } = readForm();
    const isValid = Object.keys(errors).length === 0;
    const isDirty = FORM_KEYS.some((key) => values[key] !== (settings[key] ?? ''));

    showErrors(errors);
    saveButton.disabled = isWebhookLocked() || !isValid || !isDirty;
    if (keepStatus) return;

    saveStatus.classList.remove('saved');
    saveStatus.classList.toggle('dirty', !isValid || isDirty);
    if (!isValid) saveStatus.textContent = 'Fix the highlighted fields.';
    else if (isDirty) saveStatus.textContent = 'Unsaved changes.';
    else saveStatus.textContent = STATUS_IDLE;
  }

  function setTimingMode(mode) {
    if (mode === timingMode) return;
    timingMode = mode;

    // Carry the visible values across so switching modes never loses what was typed.
    if (mode === 'surprise') {
      eyeBreakMinInput.value = eyeBreakFixedInput.value;
      eyeBreakMaxInput.value = Math.max(
        Number(eyeBreakFixedInput.value) || 0,
        Number(eyeBreakMaxInput.value) || 0
      );
      gentleMinInput.value = gentleFixedInput.value;
      gentleMaxInput.value = Math.max(
        Number(gentleFixedInput.value) || 0,
        Number(gentleMaxInput.value) || 0
      );
    } else {
      eyeBreakFixedInput.value = eyeBreakMinInput.value;
      gentleFixedInput.value = gentleMinInput.value;
    }

    renderTimingMode();
    updateFormState();
  }

  /** Asks Chrome for permission to post to the webhook's host. */
  function requestWebhookPermission(url) {
    return new Promise((resolve) => {
      try {
        const origin = `${new URL(url).origin}/*`;
        chrome.permissions.request({ origins: [origin] }, (granted) => {
          resolve(!chrome.runtime.lastError && Boolean(granted));
        });
      } catch (error) {
        resolve(false);
      }
    });
  }

  function showRemovalPin(pin) {
    const pinElement = document.createElement('b');
    pinElement.textContent = pin;
    const hint = document.createElement('span');
    hint.className = 'popup-pin-hint';
    hint.textContent = 'Write this PIN down! It is shown once and is needed to remove the webhook.';

    webhookPinNotice.replaceChildren(
      document.createTextNode('🔒 Webhook activated. Your Removal PIN: '),
      pinElement,
      document.createElement('br'),
      hint
    );
    webhookPinNotice.style.display = 'block';
  }

  async function saveAdvancedSettings() {
    const { values, errors } = readForm();
    if (Object.keys(errors).length > 0 || isWebhookLocked()) {
      updateFormState();
      return;
    }

    // Must run directly in the click handler: Chrome only shows the prompt on a user gesture.
    if (values.webhookUrl && !(await requestWebhookPermission(values.webhookUrl))) {
      showErrors({
        'webhook-url-input': 'Host permission denied. The webhook URL cannot be saved.',
      });
      return;
    }

    saveButton.disabled = true;
    const response = await send({ type: 'SAVE_SETTINGS', settings: values });
    if (!response?.success) {
      saveStatus.textContent = 'Could not save. Try again.';
      saveStatus.classList.add('dirty');
      updateFormState({ keepStatus: true });
      return;
    }

    settings = response.settings;
    renderSettings();
    saveStatus.textContent = STATUS_SAVED;
    saveStatus.classList.remove('dirty');
    saveStatus.classList.add('saved');

    if (response.createdRemovalPin) {
      // Keep the section open: the PIN is only ever shown here, once.
      showRemovalPin(response.createdRemovalPin);
    } else {
      window.setTimeout(() => setSectionOpen('advanced', false), 2000);
    }
  }

  // -------------------------------------------------------
  // QUICK ACTIONS
  // -------------------------------------------------------

  /** Saves a small change immediately (master switch, theme). */
  async function saveQuickSetting(patch) {
    if (!settings) return;
    if (patch.popupTheme) {
      settings.popupTheme = patch.popupTheme;
      renderTheme();
    }

    const response = await send({ type: 'SAVE_SETTINGS', settings: patch });
    if (response?.success) {
      // Only the saved keys are taken, so unsaved edits in the form stay untouched.
      Object.keys(patch).forEach((key) => {
        settings[key] = response.settings[key];
      });
    }
    toggleEnabled.checked = settings.enabled;
    renderTheme();
    renderStatusBar();
  }

  async function removeWebhook() {
    const pin = webhookRemovalInput.value.trim();
    if (!pin) {
      webhookRemovalStatus.textContent = 'Please enter the PIN.';
      return;
    }

    webhookRemovalStatus.textContent = 'Verifying...';
    const response = await send({ type: 'REMOVE_WEBHOOK', removalToken: pin });
    if (!response?.success) {
      webhookRemovalStatus.textContent = response?.error || 'Could not verify the PIN.';
      return;
    }

    webhookRemovalInput.value = '';
    webhookRemovalStatus.textContent = '';
    webhookPinNotice.style.display = 'none';
    await loadSettings();
    saveStatus.textContent = 'Webhook removed.';
  }

  async function sendTestReport() {
    btnTestReport.disabled = true;
    testReportStatus.textContent = 'Sending...';
    const response = await send({ type: 'TEST_REPORT' });
    btnTestReport.disabled = !isWebhookLocked();

    if (response?.success) {
      testReportStatus.textContent = 'Sent!';
      window.setTimeout(() => {
        testReportStatus.textContent = '';
      }, 3000);
    } else {
      testReportStatus.textContent = `Error: ${response?.error || 'Extension error'}`;
    }
  }

  async function snooze(hours) {
    const response = await send({ type: 'SNOOZE', hours });
    if (!response?.success) return;
    settings.snoozedUntil = response.until;
    renderSnooze();
    renderStatusBar();
  }

  async function resume() {
    const response = await send({ type: 'RESUME' });
    if (!response?.success) return;
    settings.snoozedUntil = 0;
    renderSnooze();
    renderStatusBar();
  }

  // -------------------------------------------------------
  // STATS
  // -------------------------------------------------------

  function formatMinutes(minutes) {
    const total = Math.max(0, Math.round(Number(minutes) || 0));
    if (total < 60) return `${total}m`;
    const hours = Math.floor(total / 60);
    const rest = total % 60;
    return rest > 0 ? `${hours}h ${rest}m` : `${hours}h`;
  }

  function buildTopSiteCard({ rank, site, minutes, modifier = '', subline = '' }) {
    const card = document.createElement('div');
    card.className = `popup-top-site ${modifier}`.trim();

    const row = document.createElement('div');
    row.className = 'popup-top-site-row';
    [
      ['popup-top-site-rank', rank],
      ['popup-top-site-name', site],
      ['popup-top-site-time', formatMinutes(minutes)],
    ].forEach(([className, text]) => {
      const cell = document.createElement('span');
      cell.className = className;
      cell.textContent = text;
      row.appendChild(cell);
    });
    card.appendChild(row);

    if (subline) {
      const sublineElement = document.createElement('div');
      sublineElement.className = 'popup-top-site-subline';
      sublineElement.textContent = subline;
      card.appendChild(sublineElement);
    }
    return card;
  }

  /** Top three sites by time today, with the rest folded into one "Others" card. */
  function renderTopSites(siteMinutes) {
    const ranked = Object.entries(siteMinutes || {})
      .filter(([, minutes]) => Number(minutes) > 0)
      .sort((a, b) => Number(b[1]) - Number(a[1]));

    $('stats-empty-helper').style.display = ranked.length ? 'none' : 'block';
    $('top-sites-section').style.display = ranked.length ? 'block' : 'none';
    if (!ranked.length) return;

    const cards = ranked.slice(0, 3).map(([site, minutes], index) =>
      buildTopSiteCard({
        rank: String(index + 1),
        site,
        minutes,
        modifier: index === 0 ? 'is-primary' : '',
      })
    );

    const others = ranked.slice(3);
    if (others.length) {
      const names = others.slice(0, 2).map(([site]) => site);
      const extra = others.length - names.length;
      cards.push(
        buildTopSiteCard({
          rank: '4',
          site: 'Others',
          minutes: others.reduce((sum, [, minutes]) => sum + Number(minutes || 0), 0),
          modifier: 'is-others',
          subline: extra > 0 ? `${names.join(', ')} + ${extra} more` : names.join(', '),
        })
      );
    }

    $('top-sites-list').replaceChildren(...cards);
  }

  async function loadStats() {
    const [stats, insights] = await Promise.all([
      send({ type: 'GET_STATS' }),
      send({ type: 'GET_PATTERN_INSIGHTS' }),
    ]);
    if (stats) renderTopSites(stats.todayDsSiteTimeSpent);

    const note = $('insights-note');
    const topRisk = insights?.hasEnoughData ? insights.riskTimes?.[0] : null;
    note.style.display = topRisk ? 'block' : 'none';
    if (topRisk) {
      note.textContent = `Peak pattern so far: ${topRisk.dayName}s around ${topRisk.timeLabel}.`;
    }
  }

  /** Exports stats and logs. Settings are left out so webhook details never leak. */
  function exportStats() {
    chrome.storage.local.get(['stats', 'runtimeState', 'auditLogs'], (data) => {
      if (chrome.runtime.lastError) return;
      downloadFile(
        `eyeflow-export-${todayStamp()}.json`,
        JSON.stringify(data || {}, null, 2),
        'application/json'
      );
    });
  }

  function downloadDebugLogs() {
    chrome.storage.local.get(['auditLogs'], (data) => {
      if (chrome.runtime.lastError) return;
      const logs = Array.isArray(data.auditLogs) ? data.auditLogs : [];
      const header = [
        '=== EYEFLOW DEBUG LOG ===',
        `Generated: ${new Date().toLocaleString()}`,
        `Version: ${chrome.runtime.getManifest().version}`,
        `Active: ${Boolean(settings?.enabled)}`,
        `Timing mode: ${settings?.timingMode}`,
        `Eye break interval: ${settings?.reminderIntervalMin}-${settings?.reminderIntervalMax} min`,
        `Sensitivity: ${settings?.sensitivity}%`,
        '-------------------------------------------------------------',
        '',
      ];
      const lines = logs.length
        ? logs.map((entry) => `[${entry.timeString}] ${entry.event}: ${entry.details}`)
        : ['No log entries yet.'];
      downloadFile(
        `eyeflow-debug-logs-${todayStamp()}.txt`,
        [...header, ...lines].join('\n'),
        'text/plain'
      );
    });
  }

  // -------------------------------------------------------
  // INIT
  // -------------------------------------------------------

  async function loadSettings() {
    const loaded = await send({ type: 'GET_SETTINGS' });
    if (!loaded) {
      statusText.textContent = 'Could not load settings. Reopen the popup.';
      return;
    }
    settings = loaded;
    renderSettings();
  }

  function attachHandlers() {
    toggleEnabled.addEventListener('change', () =>
      saveQuickSetting({ enabled: toggleEnabled.checked })
    );
    themeButtons.forEach((button) => {
      button.addEventListener('click', () =>
        saveQuickSetting({ popupTheme: button.dataset.theme })
      );
    });

    timingModeFixedButton.addEventListener('click', () => setTimingMode('fixed'));
    timingModeSurpriseButton.addEventListener('click', () => setTimingMode('surprise'));
    sensitivitySlider.addEventListener('input', () => {
      sensitivityValue.textContent = `${sensitivitySlider.value}%`;
    });
    FORM_CONTROLS.filter((control) => control.tagName === 'INPUT').forEach((input) => {
      input.addEventListener('input', () => updateFormState());
      input.addEventListener('change', () => updateFormState());
    });
    saveButton.addEventListener('click', saveAdvancedSettings);

    btnTestReport.addEventListener('click', sendTestReport);
    $('btn-remove-webhook').addEventListener('click', removeWebhook);
    $('btn-enable-incognito').addEventListener('click', () => {
      chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` });
    });

    snoozeButtons.forEach((button) => {
      button.addEventListener('click', () => snooze(Number(button.dataset.hours)));
    });
    btnResume.addEventListener('click', resume);

    $('btn-export-stats').addEventListener('click', exportStats);
    $('btn-download-audit').addEventListener('click', downloadDebugLogs);

    ['advanced', 'work-mode', 'stats'].forEach((name) => {
      const header = $(`toggle-${name}`);
      const toggle = () => setSectionOpen(name, $(`${name}-content`).style.display === 'none');
      header.addEventListener('click', toggle);
      header.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        toggle();
      });
    });
  }

  document.querySelector('.popup-version').textContent = `v${chrome.runtime.getManifest().version}`;
  attachHandlers();
  loadSettings();
  loadStats();
});
