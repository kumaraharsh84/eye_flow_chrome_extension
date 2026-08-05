/**
 * @file intelligence.test.js
 * @description Lightweight unit tests for shared utilities and the EyeFlow intelligence module.
 *
 * @purpose
 * Runs without a real browser by mocking the minimal Chrome and DOM APIs needed
 * by src/intelligence.js. This lets the project validate timer sensitivity and
 * numeric clamping in a fast Node process before slower extension tests run.
 *
 * @responsibilities
 *   - Provide Chrome/runtime/document mocks.
 *   - Load source modules in a CommonJS test process.
 *   - Assert core timing and validation behavior.
 *
 * @dependents
 *   - package.json test script.
 */
// tests/intelligence.test.js

// Mock Chrome APIs to prevent intelligence.js from crashing on load
global.chrome = {
  storage: {
    local: {
      get: (keys, cb) => {
        if (typeof cb === 'function') cb({});
      },
    },
  },
  runtime: {
    sendMessage: () => {},
  },
};

// Mock document for intelligence.js trackTyping
global.document = {
  addEventListener: () => {},
};

// Read and eval the required files
// The source files are ES modules, while this test runs as CommonJS. The string
// replacement keeps the test intentionally small by stripping export keywords
// before eval; behavior remains the source behavior being tested.
const fs = require('fs');
const path = require('path');

const utilsCode = fs
  .readFileSync(path.join(__dirname, '../src/utils.js'), 'utf8')
  .replace(/export\s+function/g, 'function')
  .replace(/export\s+const/g, 'const');
eval(utilsCode + ';\n global.clampNumber = clampNumber;');

const intelligenceCode = fs
  .readFileSync(path.join(__dirname, '../src/intelligence.js'), 'utf8')
  .replace(/export\s+function/g, 'function')
  .replace(/export\s+const/g, 'const');
eval(intelligenceCode + ';\n global.EyeFlowIntelligence = EyeFlowIntelligence;');

// Polyfill Web Crypto API for Node test environment if needed
if (!global.crypto || !global.crypto.subtle) {
  global.crypto = require('crypto').webcrypto;
}

// Evaluate background crypto functions for unit testing
const backgroundCode = fs.readFileSync(path.join(__dirname, '../src/background.js'), 'utf8');
const pinGenMatch = backgroundCode.match(/function generateSecure6DigitPin\(\) \{[\s\S]*?\n\}/);
const saltGenMatch = backgroundCode.match(/function generateSecureSalt\(\) \{[\s\S]*?\n\}/);
const hashFuncMatch = backgroundCode.match(/async function hashPinWithSalt\([\s\S]*?\n\}/);

if (pinGenMatch) eval('global.generateSecure6DigitPin = ' + pinGenMatch[0]);
if (saltGenMatch) eval('global.generateSecureSalt = ' + saltGenMatch[0]);
if (hashFuncMatch) eval('global.hashPinWithSalt = ' + hashFuncMatch[0]);

// --- TESTS ---

console.log('Running EyeFlow Unit Tests...');
let passed = 0;
let totalTests = 5;

// Test 1: clampNumber upper bound
try {
  console.assert(clampNumber(150, 0, 100) === 100, 'clampNumber upper bound failed');
  passed++;
} catch (e) {
  console.error(e.message);
}

// Test 2: clampNumber lower bound
try {
  console.assert(clampNumber(-10, 0, 100) === 0, 'clampNumber lower bound failed');
  passed++;
} catch (e) {
  console.error(e.message);
}

// Test 3: getNextBreakTargetMs sensitivity
try {
  EyeFlowIntelligence.updateSettings({
    sensitivity: 100,
    reminderIntervalMin: 5,
    reminderIntervalMax: 5,
  });

  EyeFlowIntelligence.resetStages();
  const strictTime = EyeFlowIntelligence.getMsUntilBreak(0);

  EyeFlowIntelligence.updateSettings({
    sensitivity: 0,
    reminderIntervalMin: 5,
    reminderIntervalMax: 5,
  });
  EyeFlowIntelligence.resetStages();
  const relaxedTime = EyeFlowIntelligence.getMsUntilBreak(0);

  console.assert(
    strictTime < relaxedTime,
    `strictTime (${strictTime}) should be less than relaxedTime (${relaxedTime})`
  );
  passed++;
} catch (e) {
  console.error(e.message);
}

// Test 4: CSPRNG 6-digit PIN & 128-bit salt generation
try {
  const pin = generateSecure6DigitPin();
  const salt = generateSecureSalt();

  console.assert(
    /^\d{6}$/.test(pin) && Number(pin) >= 100000 && Number(pin) <= 999999,
    `Generated PIN (${pin}) must be a 6-digit number between 100000 and 999999`
  );
  console.assert(
    /^[0-9a-f]{32}$/.test(salt),
    `Generated salt (${salt}) must be a 32-character hex string`
  );
  passed++;
} catch (e) {
  console.error('Test 4 (CSPRNG PIN/Salt) failed:', e.message);
}

// Test 5: Salted key-stretching hash verification
(async () => {
  try {
    const pin = '543210';
    const salt = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

    const hash1 = await hashPinWithSalt(pin, salt);
    const hash2 = await hashPinWithSalt(pin, salt);
    const wrongHash = await hashPinWithSalt('123456', salt);

    console.assert(hash1 === hash2, 'Identical PIN + salt must produce identical hash');
    console.assert(hash1 !== wrongHash, 'Different PIN must produce different hash');
    console.assert(hash1.length === 64, 'SHA-256 hash must be 64 hexadecimal characters');
    passed++;
  } catch (e) {
    console.error('Test 5 (Salted Hash) failed:', e.message);
  }

  console.log(`${passed}/${totalTests} tests passed.`);

  if (passed !== totalTests) {
    process.exit(1);
  }
})();
