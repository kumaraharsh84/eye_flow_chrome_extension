let currentScreen = 0;
let selectedMode = 'balanced';

const MODE_SETTINGS = {
  balanced: {
    sensitivity: 50,
    reminderIntervalMin: 5,
    reminderIntervalMax: 5,
    subtleReminderMin: 25,
    subtleReminderMax: 25
  },
  strict: {
    sensitivity: 80,
    reminderIntervalMin: 3,
    reminderIntervalMax: 3,
    subtleReminderMin: 15,
    subtleReminderMax: 15
  },
  gentle: {
    sensitivity: 25,
    reminderIntervalMin: 10,
    reminderIntervalMax: 10,
    subtleReminderMin: 40,
    subtleReminderMax: 40
  }
};

function goToScreen(nextScreen) {
  const currentScreenElement = document.getElementById(`screen-${currentScreen}`);
  const currentDotElement = document.getElementById(`dot-${currentScreen}`);
  const nextScreenElement = document.getElementById(`screen-${nextScreen}`);
  const nextDotElement = document.getElementById(`dot-${nextScreen}`);

  if (!currentScreenElement || !currentDotElement || !nextScreenElement || !nextDotElement) return;

  currentScreenElement.classList.remove('active');
  currentDotElement.classList.remove('active');

  if (nextScreen > currentScreen) {
    currentDotElement.classList.add('done');
  }

  currentScreen = nextScreen;
  nextScreenElement.classList.add('active');
  nextDotElement.classList.add('active');
}

function saveMode() {
  const patch = MODE_SETTINGS[selectedMode] || MODE_SETTINGS.balanced;

  chrome.storage.local.get(['settings'], (result) => {
    const settings = Object.assign({}, result.settings || {}, patch);

    chrome.storage.local.set({ settings }, () => {
      if (chrome.runtime.lastError) {
        const saveButton = document.getElementById('btn-save-mode');
        if (saveButton) {
          saveButton.textContent = 'Save failed - try again';
        }
        return;
      }

      updateFinalSummary(selectedMode);
      goToScreen(2);
    });
  });
}

function finish() {
  chrome.storage.local.set({ onboardingComplete: true }, () => {
    if (chrome.runtime.lastError) {
      window.close();
      return;
    }

    window.close();
  });
}

function updateFinalSummary(mode) {
  const values = MODE_SETTINGS[mode] || MODE_SETTINGS.balanced;
  const eyeEl = document.getElementById('summary-eye-break');
  const gentleEl = document.getElementById('summary-gentle');

  if (eyeEl) {
    eyeEl.textContent = String(values.reminderIntervalMin);
  }

  if (gentleEl) {
    gentleEl.textContent = String(values.subtleReminderMin);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const startButton = document.getElementById('btn-start-onboarding');
  const saveButton = document.getElementById('btn-save-mode');
  const skipButton = document.getElementById('btn-skip-onboarding');
  const finishButton = document.getElementById('btn-finish-onboarding');

  startButton?.addEventListener('click', () => goToScreen(1));
  saveButton?.addEventListener('click', saveMode);
  skipButton?.addEventListener('click', () => goToScreen(2));
  finishButton?.addEventListener('click', finish);

  updateFinalSummary(selectedMode);
});
