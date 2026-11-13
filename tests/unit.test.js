/**
 * @file unit.test.js
 * @description Fast unit tests that run in plain Node, without a browser.
 *
 * Covers the shared timing/validation helpers in src/utils.js and the webhook
 * PIN crypto helpers in src/background.js. The sources are ES modules, so they
 * are loaded as text and evaluated with their `export` keywords stripped.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

if (!globalThis.crypto?.subtle) {
  globalThis.crypto = require('crypto').webcrypto;
}

const readSource = (file) => fs.readFileSync(path.join(__dirname, '..', 'src', file), 'utf8');

const utils = new Function(
  `${readSource('utils.js').replace(/^export\s+/gm, '')}
  return { clampNumber, TIMER_LIMITS, MIN_BREAK_DELAY_MS, getSensitivityMultiplier, getBreakDelayMs, isValidWebhookUrl };`
)();

/** Pulls one top-level function out of background.js so it can be tested alone. */
function extractFunction(source, name) {
  const match = source.match(new RegExp(`(?:async )?function ${name}\\([\\s\\S]*?\\n\\}`));
  assert.ok(match, `Could not find ${name} in background.js`);
  return new Function(`return (${match[0]});`)();
}

const backgroundSource = readSource('background.js');
const generateSecure6DigitPin = extractFunction(backgroundSource, 'generateSecure6DigitPin');
const generateSecureSalt = extractFunction(backgroundSource, 'generateSecureSalt');
const hashPinWithSalt = extractFunction(backgroundSource, 'hashPinWithSalt');
const getWeekStartKey = extractFunction(backgroundSource, 'getWeekStartKey');

const tests = [];
const test = (name, run) => tests.push({ name, run });

test('clampNumber bounds, rounds and falls back', () => {
  const { clampNumber } = utils;
  assert.strictEqual(clampNumber(150, 0, 100), 100);
  assert.strictEqual(clampNumber(-10, 0, 100), 0);
  assert.strictEqual(clampNumber('7.6', 0, 100), 8);
  assert.strictEqual(clampNumber('abc', 5, 30, 12), 12);
  assert.strictEqual(clampNumber('', 5, 30, 12), 12);
  assert.strictEqual(clampNumber(null, 5, 30, 12), 12);
  assert.strictEqual(clampNumber(Infinity, 5, 30, 12), 12);
});

test('sensitivity maps to a 0.5x-1.5x interval multiplier', () => {
  const { getSensitivityMultiplier } = utils;
  assert.strictEqual(getSensitivityMultiplier(100), 0.5);
  assert.strictEqual(getSensitivityMultiplier(50), 1);
  assert.strictEqual(getSensitivityMultiplier(0), 1.5);
  assert.strictEqual(getSensitivityMultiplier(undefined), 1);
});

test('stricter sensitivity brings the eye break sooner', () => {
  const { getBreakDelayMs, MIN_BREAK_DELAY_MS } = utils;
  const minute = 60 * 1000;
  assert.strictEqual(getBreakDelayMs(10, 50), 10 * minute);
  assert.strictEqual(getBreakDelayMs(10, 100), 5 * minute);
  assert.strictEqual(getBreakDelayMs(10, 0), 15 * minute);
  assert.ok(getBreakDelayMs(5, 100) < getBreakDelayMs(5, 0));
  // Never below the floor, and out-of-range intervals are clamped first
  assert.ok(getBreakDelayMs(5, 100) >= MIN_BREAK_DELAY_MS);
  assert.strictEqual(getBreakDelayMs(1, 50), 5 * minute);
  assert.strictEqual(getBreakDelayMs(999, 50), 30 * minute);
});

test('timer limits are internally consistent', () => {
  for (const [key, { min, max, fallback }] of Object.entries(utils.TIMER_LIMITS)) {
    assert.ok(min <= max, `${key}: min must not exceed max`);
    assert.ok(fallback >= min && fallback <= max, `${key}: fallback must be in range`);
  }
});

test('webhook URLs must be https', () => {
  const { isValidWebhookUrl } = utils;
  assert.strictEqual(isValidWebhookUrl('https://formspree.io/f/abc'), true);
  assert.strictEqual(isValidWebhookUrl('  https://hook.eu1.make.com/xyz  '), true);
  assert.strictEqual(isValidWebhookUrl('http://formspree.io/f/abc'), false);
  assert.strictEqual(isValidWebhookUrl('javascript:alert(1)'), false);
  assert.strictEqual(isValidWebhookUrl('not a url'), false);
  assert.strictEqual(isValidWebhookUrl(''), false);
  assert.strictEqual(isValidWebhookUrl(undefined), false);
});

test('removal PIN is 6 digits and the salt is 128-bit hex', () => {
  for (let i = 0; i < 50; i++) {
    assert.match(generateSecure6DigitPin(), /^[1-9]\d{5}$/);
  }
  assert.match(generateSecureSalt(), /^[0-9a-f]{32}$/);
  assert.notStrictEqual(generateSecureSalt(), generateSecureSalt());
});

test('PIN hash is deterministic, salted and 256-bit', async () => {
  const salt = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
  const hash = await hashPinWithSalt('543210', salt);
  assert.strictEqual(hash, await hashPinWithSalt('543210', salt));
  assert.notStrictEqual(hash, await hashPinWithSalt('123456', salt));
  assert.notStrictEqual(hash, await hashPinWithSalt('543210', salt.replace('a', 'b')));
  assert.match(hash, /^[0-9a-f]{64}$/);
});

test('week key is the Monday of the current week', () => {
  const monday = new Date(2026, 10, 9); // Monday 9 November 2026
  for (let offset = 0; offset < 7; offset++) {
    const day = new Date(2026, 10, 9 + offset, 15, 30);
    assert.strictEqual(getWeekStartKey(day.getTime()), monday.toDateString());
  }
  const nextMonday = new Date(2026, 10, 16, 0, 5);
  assert.notStrictEqual(getWeekStartKey(nextMonday.getTime()), monday.toDateString());
});

(async () => {
  let failed = 0;
  for (const { name, run } of tests) {
    try {
      await run();
      console.log(`  ok    ${name}`);
    } catch (error) {
      failed++;
      console.error(`  FAIL  ${name}\n        ${error.message}`);
    }
  }
  console.log(`\n${tests.length - failed}/${tests.length} unit tests passed.`);
  if (failed > 0) process.exit(1);
})();
