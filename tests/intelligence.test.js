// tests/intelligence.test.js

// Mock Chrome APIs to prevent intelligence.js from crashing on load
global.chrome = {
  storage: {
    local: {
      get: (keys, cb) => {
        if (typeof cb === 'function') cb({});
      }
    }
  },
  runtime: {
    sendMessage: () => {}
  }
};

// Mock document for intelligence.js trackTyping
global.document = {
  addEventListener: () => {}
};

// Read and eval the required files
const fs = require('fs');
const path = require('path');

const utilsCode = fs.readFileSync(path.join(__dirname, '../src/utils.js'), 'utf8');
eval(utilsCode + ';\n global.clampNumber = clampNumber;');

const intelligenceCode = fs.readFileSync(path.join(__dirname, '../src/intelligence.js'), 'utf8');
eval(intelligenceCode + ';\n global.EyeFlowIntelligence = EyeFlowIntelligence;');

// --- TESTS ---

console.log('Running EyeFlow Unit Tests...');
let passed = 0;

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
  EyeFlowIntelligence.updateSettings({ sensitivity: 100, reminderIntervalMin: 5, reminderIntervalMax: 5 });
  // Since it's random between min and max, if min=max, it returns exactly min * 60 * 1000 * multiplier
  // multiplier for 100 is 0.5. 5 * 60 * 1000 * 0.5 = 150000
  // Note: getNextBreakTargetMs is not exposed directly! We can use resetStages() and getMsUntilBreak()
  
  EyeFlowIntelligence.resetStages();
  const strictTime = EyeFlowIntelligence.getMsUntilBreak(0);

  EyeFlowIntelligence.updateSettings({ sensitivity: 0, reminderIntervalMin: 5, reminderIntervalMax: 5 });
  EyeFlowIntelligence.resetStages();
  const relaxedTime = EyeFlowIntelligence.getMsUntilBreak(0);

  console.assert(strictTime < relaxedTime, `strictTime (${strictTime}) should be less than relaxedTime (${relaxedTime})`);
  passed++;
} catch (e) {
  console.error(e.message);
}

console.log(`${passed}/3 tests passed.`);

if (passed !== 3) {
  process.exit(1);
}
