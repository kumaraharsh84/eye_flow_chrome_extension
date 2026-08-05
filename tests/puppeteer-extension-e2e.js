/**
 * @file puppeteer-extension-e2e.js
 * @description End-to-end browser tests for EyeFlow extension workflows.
 *
 * @purpose
 * Exercises the built extension in a real Chromium session. These tests validate
 * popup controls, onboarding persistence, content-script behavior on target
 * sites, and extension messaging/storage flows that cannot be trusted from unit
 * tests alone.
 *
 * @responsibilities
 *   - Launch the unpacked dist/ extension in Puppeteer.
 *   - Interact with extension pages and online doom-scroll surfaces.
 *   - Read/write chrome.storage from extension pages for setup and assertions.
 *   - Generate an HTML test report for review.
 *
 * @dependents
 *   - package.json test:e2e, test:online, test:onboarding, test:popup, and test:sites scripts.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer');

const extensionPath = path.resolve(__dirname, '..', 'dist');
const args = process.argv.slice(2);
const holdOpen = args.includes('--hold-open');
const suiteArg = args.find((arg) => arg.startsWith('--suite='));
const selectedSuite = suiteArg ? suiteArg.split('=')[1] : 'all';
const reportPath = path.join(extensionPath, 'tests', 'artifacts', 'eyeflow-test-report.html');

const SITE_CASES = [
  {
    name: 'YouTube Shorts',
    url: 'https://www.youtube.com/shorts/aqz-KE-bpKQ',
    expectedHost: 'www.youtube.com',
  },
  {
    name: 'Instagram Reels',
    url: 'https://www.instagram.com/reels/',
    expectedHost: 'www.instagram.com',
  },
  {
    name: 'Reddit Popular',
    url: 'https://www.reddit.com/popular/',
    expectedHost: 'www.reddit.com',
  },
];

function resolveBrowserPath() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    'Chrome/Edge was not found. Set CHROME_PATH to your browser executable, then rerun "npm.cmd run test:e2e".'
  );
}

function expect(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function writeHtmlReport(results) {
  const artifactsDir = path.dirname(reportPath);
  fs.mkdirSync(artifactsDir, { recursive: true });

  const passed = results.filter((result) => result.status === 'passed').length;
  const failed = results.filter((result) => result.status === 'failed').length;
  const skipped = results.filter((result) => result.status === 'skipped').length;
  const generatedAt = new Date().toISOString();

  const rows = results
    .map((result) => {
      const message = result.message
        ? `<div class="message">${escapeHtml(result.message)}</div>`
        : '';
      return `
        <tr>
          <td>${escapeHtml(result.suite || 'general')}</td>
          <td>${escapeHtml(result.name)}</td>
          <td><span class="status status-${escapeHtml(result.status)}">${escapeHtml(result.status)}</span></td>
          <td>${message}</td>
        </tr>
      `;
    })
    .join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>EyeFlow Test Report</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f5efe5;
      --panel: #fffaf3;
      --ink: #2f2418;
      --muted: #6f6457;
      --border: #dbcab4;
      --pass: #2d7d46;
      --fail: #b63c3c;
      --skip: #8a6d1f;
      --accent: #b45c2f;
    }
    body {
      margin: 0;
      font-family: Georgia, "Times New Roman", serif;
      background: linear-gradient(180deg, #f6efe6 0%, #f1e7d9 100%);
      color: var(--ink);
    }
    main {
      max-width: 980px;
      margin: 0 auto;
      padding: 32px 20px 48px;
    }
    .hero, .panel {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 18px;
      box-shadow: 0 14px 30px rgba(77, 54, 27, 0.08);
    }
    .hero {
      padding: 24px;
      margin-bottom: 20px;
    }
    h1 {
      margin: 0 0 8px;
      font-size: 32px;
    }
    .meta {
      color: var(--muted);
      font-size: 14px;
    }
    .summary {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      margin-top: 18px;
    }
    .pill {
      padding: 10px 14px;
      border-radius: 999px;
      background: #f2e6d5;
      border: 1px solid var(--border);
      font-size: 14px;
    }
    .panel {
      overflow: hidden;
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    th, td {
      padding: 14px 16px;
      border-bottom: 1px solid #eadfce;
      text-align: left;
      vertical-align: top;
      font-size: 14px;
    }
    th {
      background: #fcf6ee;
      font-size: 13px;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--muted);
    }
    .status {
      display: inline-block;
      padding: 4px 10px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .status-passed {
      background: rgba(45, 125, 70, 0.12);
      color: var(--pass);
    }
    .status-failed {
      background: rgba(182, 60, 60, 0.12);
      color: var(--fail);
    }
    .status-skipped {
      background: rgba(138, 109, 31, 0.12);
      color: var(--skip);
    }
    .message {
      white-space: pre-wrap;
      color: var(--muted);
      line-height: 1.45;
    }
    .footer {
      margin-top: 14px;
      font-size: 13px;
      color: var(--muted);
    }
  </style>
</head>
<body>
  <main>
    <section class="hero">
      <h1>EyeFlow Test Report</h1>
      <div class="meta">Generated at ${escapeHtml(generatedAt)} for suite: ${escapeHtml(selectedSuite)}</div>
      <div class="summary">
        <div class="pill">Passed: ${passed}</div>
        <div class="pill">Failed: ${failed}</div>
        <div class="pill">Skipped: ${skipped}</div>
        <div class="pill">Total: ${results.length}</div>
      </div>
    </section>
    <section class="panel">
      <table>
        <thead>
          <tr>
            <th>Suite</th>
            <th>Test</th>
            <th>Status</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </section>
    <div class="footer">Saved to ${escapeHtml(reportPath)}</div>
  </main>
</body>
</html>`;

  fs.writeFileSync(reportPath, html, 'utf8');
}

async function waitForExtensionId(browser) {
  const target = await browser.waitForTarget(
    (candidate) =>
      candidate.type() === 'service_worker' && candidate.url().startsWith('chrome-extension://'),
    { timeout: 30000 }
  );

  return new URL(target.url()).host;
}

async function getServiceWorker(browser) {
  const target = await browser.waitForTarget(
    (candidate) =>
      candidate.type() === 'service_worker' && candidate.url().startsWith('chrome-extension://'),
    { timeout: 30000 }
  );

  const worker = await target.worker();
  expect(worker, 'Extension service worker is not available.');
  return worker;
}

async function openExtensionPage(browser, extensionId, relativePath) {
  const page = await browser.newPage();
  page.setDefaultTimeout(30000);
  await page.goto(`chrome-extension://${extensionId}/${relativePath}`, {
    waitUntil: 'domcontentloaded',
  });
  return page;
}

async function storageGet(page, keys = null) {
  return page.evaluate(
    (requestedKeys) => new Promise((resolve) => chrome.storage.local.get(requestedKeys, resolve)),
    keys
  );
}

async function storageSet(page, payload) {
  await page.evaluate(
    (nextPayload) => new Promise((resolve) => chrome.storage.local.set(nextPayload, resolve)),
    payload
  );
}

async function patchSettings(page, patch) {
  const { settings = {} } = await storageGet(page, ['settings']);
  await storageSet(page, { settings: { ...settings, ...patch } });
}

async function resetPopupState(page) {
  await patchSettings(page, {
    enabled: true,
    snoozedUntil: 0,
    sensitivity: 50,
    eyeBreakDurationSec: 20,
    reminderIntervalMin: 5,
    reminderIntervalMax: 5,
    hydrationReminderMin: 60,
    subtleReminderMin: 25,
    subtleReminderMax: 25,
    timingMode: 'fixed',
    customTimingEnabled: false,
  });
  await storageSet(page, { onboardingComplete: false });
}

async function sendMessageToActiveTab(worker, page, message) {
  await page.bringToFront();
  await delay(600);

  return worker.evaluate(
    async (payload) => {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (!tab) {
        return { ok: false, error: 'No active tab was found.' };
      }

      try {
        const response = await chrome.tabs.sendMessage(tab.id, payload.message);
        return { ok: true, response, tabId: tab.id, url: tab.url || '' };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          tabId: tab.id,
          url: tab.url || '',
        };
      }
    },
    { message }
  );
}

async function navigateOnline(page, url) {
  try {
    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 45000,
    });
    await delay(2000);
    return {
      ok: true,
      status: response ? response.status() : null,
      finalUrl: page.url(),
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      finalUrl: page.url(),
    };
  }
}

function matchesExpectedHost(finalUrl, expectedHost) {
  try {
    return new URL(finalUrl).host === expectedHost;
  } catch (error) {
    return false;
  }
}

function isAuthSurface(finalUrl) {
  try {
    const url = new URL(finalUrl);
    const combined = `${url.pathname} ${url.search}`.toLowerCase();
    return ['login', 'signin', 'signup', 'verify', 'auth', 'accounts'].some((token) =>
      combined.includes(token)
    );
  } catch (error) {
    return false;
  }
}

async function assertPopupValues(page, expected) {
  await page.waitForSelector('#toggle-enabled');
  const state = await page.evaluate(() => ({
    enabled: document.getElementById('toggle-enabled').checked,
    sensitivity: Number(document.getElementById('sensitivity-slider').value),
    eyeBreakFixed: Number(document.getElementById('eye-break-fixed-min').value),
    gentleFixed: Number(document.getElementById('subtle-reminder-fixed').value),
    statusText: document.getElementById('status-text').textContent.trim(),
  }));

  if ('enabled' in expected)
    expect(state.enabled === expected.enabled, `Expected enabled=${expected.enabled}.`);
  if ('sensitivity' in expected)
    expect(
      state.sensitivity === expected.sensitivity,
      `Expected sensitivity ${expected.sensitivity}.`
    );
  if ('eyeBreakFixed' in expected)
    expect(
      state.eyeBreakFixed === expected.eyeBreakFixed,
      `Expected eye break ${expected.eyeBreakFixed}.`
    );
  if ('gentleFixed' in expected)
    expect(
      state.gentleFixed === expected.gentleFixed,
      `Expected gentle reminder ${expected.gentleFixed}.`
    );
  if ('statusText' in expected)
    expect(
      state.statusText === expected.statusText,
      `Expected status text "${expected.statusText}".`
    );
}

async function ensurePopupSectionOpen(page, toggleSelector, contentSelector) {
  await page.waitForSelector(toggleSelector);
  await page.waitForSelector(contentSelector);

  const isOpen = await page.$eval(contentSelector, (node) => node.style.display !== 'none');
  if (isOpen) return;

  await page.$eval(toggleSelector, (node) => node.click());
  await page.waitForFunction(
    (selector) => {
      const node = document.querySelector(selector);
      return Boolean(node) && node.style.display !== 'none';
    },
    {},
    contentSelector
  );
}

async function runTest(suite, name, fn, results) {
  process.stdout.write(`\n[TEST] ${name}\n`);
  try {
    await fn();
    results.push({ suite, name, status: 'passed' });
    process.stdout.write(`[PASS] ${name}\n`);
  } catch (error) {
    results.push({
      suite,
      name,
      status: 'failed',
      message: error instanceof Error ? error.message : String(error),
    });
    process.stdout.write(
      `[FAIL] ${name}: ${error instanceof Error ? error.message : String(error)}\n`
    );
  }
}

async function runSkippableTest(suite, name, fn, results) {
  process.stdout.write(`\n[TEST] ${name}\n`);
  try {
    const skipReason = await fn();
    if (skipReason) {
      results.push({ suite, name, status: 'skipped', message: skipReason });
      process.stdout.write(`[SKIP] ${name}: ${skipReason}\n`);
      return;
    }

    results.push({ suite, name, status: 'passed' });
    process.stdout.write(`[PASS] ${name}\n`);
  } catch (error) {
    results.push({
      suite,
      name,
      status: 'failed',
      message: error instanceof Error ? error.message : String(error),
    });
    process.stdout.write(
      `[FAIL] ${name}: ${error instanceof Error ? error.message : String(error)}\n`
    );
  }
}

async function main() {
  const browserPath = resolveBrowserPath();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eyeflow-puppeteer-e2e-'));
  const results = [];
  let browser;

  try {
    console.log(`Launching browser: ${browserPath}`);
    browser = await puppeteer.launch({
      headless: false,
      pipe: true,
      enableExtensions: [extensionPath],
      executablePath: browserPath,
      userDataDir,
      args: ['--no-first-run', '--no-default-browser-check'],
      defaultViewport: { width: 1440, height: 960 },
    });

    const extensionId = await waitForExtensionId(browser);
    const worker = await getServiceWorker(browser);
    console.log(`Loaded EyeFlow extension: ${extensionId}`);
    console.log(`Running suite: ${selectedSuite}`);

    const controlPage = await openExtensionPage(browser, extensionId, 'popup.html');
    await resetPopupState(controlPage);

    if (selectedSuite === 'all' || selectedSuite === 'onboarding') {
      await runTest(
        'onboarding',
        'Onboarding presets save the expected values',
        async () => {
          const onboardingPage = await openExtensionPage(browser, extensionId, 'onboarding.html');
          await onboardingPage.click('#btn-start-onboarding');
          await onboardingPage.click('#btn-save-mode');
          await onboardingPage.waitForSelector('#screen-2.active');

          const summary = await onboardingPage.evaluate(() => ({
            eyeBreak: Number(document.getElementById('summary-eye-break').textContent.trim()),
            gentle: Number(document.getElementById('summary-gentle').textContent.trim()),
          }));
          const { settings = {} } = await storageGet(onboardingPage, ['settings']);

          expect(summary.eyeBreak === 5, `Expected eye break summary 5, got ${summary.eyeBreak}.`);
          expect(summary.gentle === 25, `Expected gentle summary 25, got ${summary.gentle}.`);
          expect(
            settings.sensitivity === 50,
            `Expected sensitivity 50, got ${settings.sensitivity}.`
          );
          expect(
            settings.reminderIntervalMin === 5,
            `Expected reminder min 5, got ${settings.reminderIntervalMin}.`
          );
          expect(
            settings.reminderIntervalMax === 5,
            `Expected reminder max 5, got ${settings.reminderIntervalMax}.`
          );
          expect(
            settings.subtleReminderMin === 25,
            `Expected subtle min 25, got ${settings.subtleReminderMin}.`
          );
          expect(
            settings.subtleReminderMax === 25,
            `Expected subtle max 25, got ${settings.subtleReminderMax}.`
          );

          await onboardingPage.click('#btn-finish-onboarding');
          await delay(600);
          const completed = await storageGet(controlPage, ['onboardingComplete']);
          expect(
            completed.onboardingComplete === true,
            'Expected onboardingComplete to be true after finishing.'
          );
          if (!onboardingPage.isClosed()) {
            await onboardingPage.close();
          }
        },
        results
      );
    }

    if (selectedSuite === 'all' || selectedSuite === 'popup') {
      await runTest(
        'popup',
        'Popup toggle and snooze controls update saved state',
        async () => {
          await resetPopupState(controlPage);

          let popupPage = await openExtensionPage(browser, extensionId, 'popup.html');
          await assertPopupValues(popupPage, {
            enabled: true,
            sensitivity: 50,
            eyeBreakFixed: 5,
            gentleFixed: 25,
            statusText: 'Active - gentle reminders on',
          });

          // 1. Try to toggle disabled
          await popupPage.$eval('#toggle-enabled', (input) => {
            input.click();
            input.dispatchEvent(new Event('change', { bubbles: true }));
          });

          await popupPage.waitForFunction(
            () => document.getElementById('status-text').textContent.trim() === 'Inactive'
          );

          let stored = await storageGet(popupPage, ['settings']);
          expect(stored.settings.enabled === false, 'Expected toggle to save enabled=false.');

          // 2. Toggle it back ON
          await popupPage.$eval('#toggle-enabled', (input) => {
            input.click();
            input.dispatchEvent(new Event('change', { bubbles: true }));
          });
          await popupPage.waitForFunction(
            () =>
              document.getElementById('status-text').textContent.trim() ===
              'Active - gentle reminders on'
          );

          await ensurePopupSectionOpen(popupPage, '#toggle-work-mode', '#work-mode-content');
          await popupPage.click('.popup-snooze-btn[data-hours="1"]');
          await popupPage.waitForFunction(
            () =>
              document.getElementById('status-text').textContent.trim() ===
              'Snoozed - gentle reminders paused'
          );
          stored = await storageGet(popupPage, ['settings']);
          expect(
            stored.settings.snoozedUntil > Date.now(),
            'Expected snoozedUntil to be in the future.'
          );

          await popupPage.click('#btn-resume');
          await popupPage.waitForFunction(
            () =>
              document.getElementById('status-text').textContent.trim() ===
              'Active - gentle reminders on'
          );
          stored = await storageGet(popupPage, ['settings']);
          expect(stored.settings.snoozedUntil === 0, 'Expected snooze to clear after resume.');

          await popupPage.close();
          popupPage = await openExtensionPage(browser, extensionId, 'popup.html');
          await assertPopupValues(popupPage, {
            enabled: true,
            statusText: 'Active - gentle reminders on',
          });
          await popupPage.close();
        },
        results
      );

      await runTest(
        'popup',
        'Popup advanced controls save, persist, and validate',
        async () => {
          await resetPopupState(controlPage);
          let popupPage = await openExtensionPage(browser, extensionId, 'popup.html');

          await ensurePopupSectionOpen(popupPage, '#toggle-advanced', '#advanced-content');

          await popupPage.focus('#sensitivity-slider');
          await popupPage.$eval('#sensitivity-slider', (input) => {
            input.value = '65';
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
          });
          await popupPage.click('#timing-mode-surprise');
          await popupPage.focus('#eye-break-duration-sec');
          await popupPage.$eval('#eye-break-duration-sec', (input) => {
            input.value = '30';
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
          });
          await popupPage.$eval('#doom-reminder-min', (input) => {
            input.value = '7';
            input.dispatchEvent(new Event('input', { bubbles: true }));
          });
          await popupPage.$eval('#doom-reminder-max', (input) => {
            input.value = '11';
            input.dispatchEvent(new Event('input', { bubbles: true }));
          });
          await popupPage.$eval('#subtle-reminder-min', (input) => {
            input.value = '24';
            input.dispatchEvent(new Event('input', { bubbles: true }));
          });
          await popupPage.$eval('#subtle-reminder-max', (input) => {
            input.value = '39';
            input.dispatchEvent(new Event('input', { bubbles: true }));
          });
          await popupPage.$eval('#hydration-reminder-hours', (input) => {
            input.value = '3';
            input.dispatchEvent(new Event('input', { bubbles: true }));
          });
          await popupPage.click('#save-advanced-settings');
          await popupPage.waitForFunction(
            () =>
              document.getElementById('advanced-save-status').textContent.trim() ===
              'Settings saved'
          );

          let stored = await storageGet(popupPage, ['settings']);
          expect(
            stored.settings.timingMode === 'surprise',
            'Expected surprise timing mode to persist.'
          );
          expect(stored.settings.sensitivity === 65, 'Expected sensitivity 65.');
          expect(stored.settings.eyeBreakDurationSec === 30, 'Expected eye break duration 30.');
          expect(stored.settings.reminderIntervalMin === 7, 'Expected reminderIntervalMin 7.');
          expect(stored.settings.reminderIntervalMax === 11, 'Expected reminderIntervalMax 11.');
          expect(stored.settings.subtleReminderMin === 24, 'Expected subtleReminderMin 24.');
          expect(stored.settings.subtleReminderMax === 39, 'Expected subtleReminderMax 39.');
          expect(
            stored.settings.hydrationReminderMin === 180,
            'Expected hydrationReminderMin 180.'
          );

          await popupPage.close();
          popupPage = await openExtensionPage(browser, extensionId, 'popup.html');
          await ensurePopupSectionOpen(popupPage, '#toggle-advanced', '#advanced-content');

          const persisted = await popupPage.evaluate(() => ({
            sensitivity: Number(document.getElementById('sensitivity-slider').value),
            timingMode: document
              .getElementById('timing-mode-surprise')
              .getAttribute('aria-pressed'),
            eyeBreakDuration: Number(document.getElementById('eye-break-duration-sec').value),
            doomMin: Number(document.getElementById('doom-reminder-min').value),
            doomMax: Number(document.getElementById('doom-reminder-max').value),
            subtleMin: Number(document.getElementById('subtle-reminder-min').value),
            subtleMax: Number(document.getElementById('subtle-reminder-max').value),
            hydrationHours: Number(document.getElementById('hydration-reminder-hours').value),
          }));

          expect(persisted.sensitivity === 65, 'Expected persisted sensitivity 65.');
          expect(persisted.timingMode === 'true', 'Expected surprise button to stay selected.');
          expect(persisted.eyeBreakDuration === 30, 'Expected persisted eye break duration 30.');
          expect(
            persisted.doomMin === 7 && persisted.doomMax === 11,
            'Expected persisted doom reminder range 7-11.'
          );
          expect(
            persisted.subtleMin === 24 && persisted.subtleMax === 39,
            'Expected persisted subtle range 24-39.'
          );
          expect(persisted.hydrationHours === 3, 'Expected persisted hydration reminder 3 hours.');

          await popupPage.$eval('#doom-reminder-min', (input) => {
            input.value = '14';
            input.dispatchEvent(new Event('input', { bubbles: true }));
          });
          await popupPage.$eval('#doom-reminder-max', (input) => {
            input.value = '10';
            input.dispatchEvent(new Event('input', { bubbles: true }));
          });
          await popupPage.waitForFunction(() => {
            const error = document.querySelector('[data-error-for="doom-reminder-max"]');
            const saveButton = document.getElementById('save-advanced-settings');
            return (
              error &&
              error.textContent.includes('Min cannot be greater than max') &&
              saveButton.disabled
            );
          });

          await popupPage.close();
        },
        results
      );
    }

    if (selectedSuite === 'all' || selectedSuite === 'sites') {
      for (const siteCase of SITE_CASES) {
        await runSkippableTest(
          'sites',
          `Content script responds on ${siteCase.name}`,
          async () => {
            const sitePage = await browser.newPage();
            sitePage.setDefaultTimeout(45000);

            const navigation = await navigateOnline(sitePage, siteCase.url);
            if (!navigation.ok) {
              await sitePage.close();
              return `Navigation failed: ${navigation.error}`;
            }

            const contextResponse = await sendMessageToActiveTab(worker, sitePage, {
              type: 'GET_PAGE_REMINDER_CONTEXT',
            });
            if (!contextResponse.ok) {
              await sitePage.close();
              return `Content script did not respond: ${contextResponse.error}`;
            }

            expect(
              typeof contextResponse.response.isDoomScrollContext === 'boolean',
              'Expected isDoomScrollContext boolean.'
            );
            expect(
              typeof contextResponse.response.canShowGentleReminder === 'boolean',
              'Expected canShowGentleReminder boolean.'
            );
            expect(
              typeof contextResponse.response.hasPassiveVideoPresence === 'boolean',
              'Expected hasPassiveVideoPresence boolean.'
            );
            if (!matchesExpectedHost(navigation.finalUrl, siteCase.expectedHost)) {
              await sitePage.close();
              return `Site redirected away from ${siteCase.expectedHost}: ${navigation.finalUrl}`;
            }

            const initialUi = await sitePage.evaluate(() => ({
              overlay: Boolean(document.getElementById('eyeflow-overlay')),
              gentle: Boolean(document.getElementById('eyeflow-gentle-reminder')),
              nudge: Boolean(document.getElementById('eyeflow-nudge')),
              warning: Boolean(document.getElementById('eyeflow-warning')),
            }));
            expect(
              !initialUi.overlay && !initialUi.gentle && !initialUi.nudge && !initialUi.warning,
              'Expected no EyeFlow UI to be shown immediately on page load.'
            );

            if (isAuthSurface(navigation.finalUrl)) {
              console.log(
                `[INFO] ${siteCase.name} landed on an auth surface: ${navigation.finalUrl}`
              );
              await sitePage.close();
              return null;
            }

            const gentleResponse = await sendMessageToActiveTab(worker, sitePage, {
              type: 'SHOW_GENTLE_REMINDER',
              force: true,
            });
            expect(
              gentleResponse.ok,
              `Expected SHOW_GENTLE_REMINDER to succeed on ${siteCase.name}.`
            );

            await sitePage.waitForSelector('#eyeflow-gentle-reminder', { timeout: 10000 });
            const gentleText = await sitePage.$eval(
              '#eyeflow-gentle-reminder .eyeflow-gentle-reminder-title',
              (node) => node.textContent.trim()
            );
            expect(gentleText.length > 0, 'Expected gentle reminder title text.');

            console.log(
              `[INFO] ${siteCase.name} context: doom=${contextResponse.response.isDoomScrollContext}, gentle=${contextResponse.response.canShowGentleReminder}, passive=${contextResponse.response.hasPassiveVideoPresence}`
            );

            await sitePage.close();
            return null;
          },
          results
        );
      }
    }

    if (results.length === 0) {
      throw new Error(
        `Unknown suite "${selectedSuite}". Use one of: all, onboarding, popup, sites.`
      );
    }

    const passed = results.filter((result) => result.status === 'passed').length;
    const failed = results.filter((result) => result.status === 'failed').length;
    const skipped = results.filter((result) => result.status === 'skipped').length;

    console.log('\nSummary');
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    console.log(`Skipped: ${skipped}`);
    writeHtmlReport(results);
    console.log(`HTML report: ${reportPath}`);

    if (holdOpen) {
      console.log(
        'Browser left open for manual verification. Press Ctrl+C in the terminal when finished.'
      );
      await new Promise(() => {});
    }

    if (failed > 0) {
      process.exitCode = 1;
    }
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
