/**
 * @file onboarding.js
 * @description First-run page: welcome, one recommended setup, and a summary.
 *
 * Opened by background.js when the extension is installed. The setup is saved
 * through the service worker (SAVE_SETTINGS) so it is validated like any other
 * settings change, and the summary shows the values that were actually stored.
 */

// The single "Balanced" starting point offered on the setup screen.
const RECOMMENDED_SETUP = Object.freeze({
  sensitivity: 50,
  timingMode: 'fixed',
  reminderIntervalMin: 5,
  reminderIntervalMax: 5,
  subtleReminderMin: 25,
  subtleReminderMax: 25,
});

let currentScreen = 0;

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

/** Moves to another screen and updates the step dots. */
function goToScreen(nextScreen) {
  const currentScreenElement = document.getElementById(`screen-${currentScreen}`);
  const currentDot = document.getElementById(`dot-${currentScreen}`);
  const nextScreenElement = document.getElementById(`screen-${nextScreen}`);
  const nextDot = document.getElementById(`dot-${nextScreen}`);
  if (!currentScreenElement || !currentDot || !nextScreenElement || !nextDot) return;

  currentScreenElement.classList.remove('active');
  currentDot.classList.remove('active');
  if (nextScreen > currentScreen) currentDot.classList.add('done');

  currentScreen = nextScreen;
  nextScreenElement.classList.add('active');
  nextDot.classList.add('active');
}

/** Shows the intervals that are really in effect on the final screen. */
function showSummary(settings) {
  const values = settings || RECOMMENDED_SETUP;
  document.getElementById('summary-eye-break').textContent = String(values.reminderIntervalMin);
  document.getElementById('summary-gentle').textContent = String(values.subtleReminderMin);
}

async function saveSetup(button) {
  button.disabled = true;
  const response = await send({ type: 'SAVE_SETTINGS', settings: RECOMMENDED_SETUP });
  button.disabled = false;

  if (!response?.success) {
    button.textContent = 'Save failed - try again';
    return;
  }
  showSummary(response.settings);
  goToScreen(2);
}

/** Skipping keeps whatever is stored; the summary still has to tell the truth. */
async function skipSetup() {
  showSummary(await send({ type: 'GET_SETTINGS' }));
  goToScreen(2);
}

function finish() {
  chrome.tabs.getCurrent((tab) => {
    if (!chrome.runtime.lastError && tab?.id) {
      chrome.tabs.remove(tab.id);
    } else {
      window.close();
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const saveButton = document.getElementById('btn-save-mode');

  document.getElementById('btn-start-onboarding').addEventListener('click', () => goToScreen(1));
  saveButton.addEventListener('click', () => saveSetup(saveButton));
  document.getElementById('btn-skip-onboarding').addEventListener('click', skipSetup);
  document.getElementById('btn-finish-onboarding').addEventListener('click', finish);

  showSummary(RECOMMENDED_SETUP);
});
