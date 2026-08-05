/**
 * @file puppeteer-extension-smoke.js
 * @description Browser smoke test that loads the built extension and verifies the popup can render.
 *
 * @purpose
 * Launches Chrome or Edge with dist/ installed as an unpacked extension. This
 * checks that the build artifact is loadable, the Manifest V3 service worker
 * starts, and the popup HTML/JS can execute in a real extension context.
 *
 * @responsibilities
 *   - Resolve an installed Chromium browser path.
 *   - Launch Puppeteer with extension support.
 *   - Discover the generated extension ID from its service worker target.
 *   - Open popup.html and one online target page for a basic integration check.
 *
 * @dependents
 *   - package.json test and test:extension scripts.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer');

const extensionPath = path.resolve(__dirname, '..', 'dist');
const args = process.argv.slice(2);
const holdOpen = args.includes('--hold-open');
const targetUrl = args.find((arg) => !arg.startsWith('--')) || 'https://www.youtube.com/';

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
    'Chrome/Edge was not found. Set CHROME_PATH to your browser executable, then rerun "npm test".'
  );
}

async function waitForExtensionId(browser) {
  const existingTarget = browser
    .targets()
    .find(
      (target) =>
        target.type() === 'service_worker' && target.url().startsWith('chrome-extension://')
    );

  if (existingTarget) {
    return new URL(existingTarget.url()).host;
  }

  const target = await browser.waitForTarget(
    (candidate) =>
      candidate.type() === 'service_worker' && candidate.url().startsWith('chrome-extension://'),
    { timeout: 30000 }
  );

  return new URL(target.url()).host;
}

async function run() {
  const browserPath = resolveBrowserPath();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eyeflow-puppeteer-'));
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

    console.log('Waiting for extension service worker...');
    const extensionId = await waitForExtensionId(browser);
    console.log(`Loaded EyeFlow extension: ${extensionId}`);

    const popupPage = await browser.newPage();
    popupPage.setDefaultTimeout(10000);
    await popupPage.goto(`chrome-extension://${extensionId}/popup.html`, {
      waitUntil: 'domcontentloaded',
    });

    await popupPage.waitForSelector('#status-text', { timeout: 10000 });
    const popupTitle = await popupPage.title();
    const statusText = await popupPage.$eval('#status-text', (node) => node.textContent.trim());

    console.log(`Popup title: ${popupTitle}`);
    console.log(`Popup status: ${statusText}`);

    const sitePage = await browser.newPage();
    sitePage.setDefaultTimeout(30000);
    await sitePage.goto(targetUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    console.log(`Opened online test page: ${targetUrl}`);

    if (holdOpen) {
      console.log(
        'Browser left open for manual verification. Press Ctrl+C in the terminal when finished.'
      );
      await new Promise(() => {});
    } else {
      console.log('Smoke test passed.');
    }
  } catch (error) {
    console.error('Puppeteer smoke test failed.');
    console.error(error);
    process.exitCode = 1;
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }

    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

run()
  .then(() => process.exit(process.exitCode || 0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
