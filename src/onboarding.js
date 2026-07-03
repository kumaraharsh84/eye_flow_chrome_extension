/**
 * @file onboarding.js
 * @description Handles user interaction, screen transition, and preset selection for the onboarding flow.
 *
 * @purpose
 * The onboarding screen introduces a new user to the extension's presets (Balanced, Strict, Gentle).
 * Instead of overwhelming beginners with multiple micro-settings, it provides high-level preset packages,
 * writes them to Chrome Local Storage, and updates the onboarding status so they aren't asked to complete
 * it again on subsequent launches.
 *
 * @project-fit
 *   - Runs in the onboarding.html view context (opened on first run or via settings link).
 *   - Directly modifies the chrome.storage.local values for 'settings' and 'onboardingComplete'.
 */

// Track the active slider screen index (0 = welcome, 1 = preset selection, 2 = summary/finish)
let currentScreen = 0;

// The user-selected mode (defaults to 'balanced')
let selectedMode = 'balanced';

// -------------------------------------------------------
// PRESET VALUES DEFINITION
// -------------------------------------------------------
/**
 * @constant {Object} MODE_SETTINGS
 * @description Preconfigured settings mappings representing different levels of monitoring strictness.
 * Selecting a mode copies these values directly to user settings.
 */
const MODE_SETTINGS = {
  // Moderate defaults suitable for most users
  balanced: {
    sensitivity: 50,
    reminderIntervalMin: 5,
    reminderIntervalMax: 5,
    subtleReminderMin: 25,
    subtleReminderMax: 25,
  },
  // Higher sensitivity and shorter trigger intervals for severe doom-scrollers
  strict: {
    sensitivity: 80,
    reminderIntervalMin: 3,
    reminderIntervalMax: 3,
    subtleReminderMin: 15,
    subtleReminderMax: 15,
  },
  // Longer intervals and lower sensitivity for lighter reminders
  gentle: {
    sensitivity: 25,
    reminderIntervalMin: 10,
    reminderIntervalMax: 10,
    subtleReminderMin: 40,
    subtleReminderMax: 40,
  },
};

// -------------------------------------------------------
// NAVIGATION FUNCTIONS
// -------------------------------------------------------
/**
 * @function goToScreen
 * @description Transitions the user interface from the current screen slide to the next one
 * by manipulating CSS classes ('active' and 'done') for screens and timeline dots.
 *
 * @param {number} nextScreen - The index (0-indexed) of the destination screen.
 * @returns {void}
 *
 * @side-effects
 *   - Modifies DOM element class lists to animate transitions.
 *   - Updates the global `currentScreen` tracking variable.
 *
 * @called-by
 *   - Start onboarding button ('btn-start-onboarding') click -> screen 1
 *   - Skip onboarding button ('btn-skip-onboarding') click -> screen 2
 *   - Successful saveMode() response -> screen 2
 */
function goToScreen(nextScreen) {
  // Retrieve DOM nodes for both current and target screens/dots
  const currentScreenElement = document.getElementById(`screen-${currentScreen}`);
  const currentDotElement = document.getElementById(`dot-${currentScreen}`);
  const nextScreenElement = document.getElementById(`screen-${nextScreen}`);
  const nextDotElement = document.getElementById(`dot-${nextScreen}`);

  // Safe check to avoid null pointer crashes if the developer named an ID incorrectly
  if (!currentScreenElement || !currentDotElement || !nextScreenElement || !nextDotElement) return;

  // Deactivate the old screen to trigger fade-out transition
  currentScreenElement.classList.remove('active');
  currentDotElement.classList.remove('active');

  // If moving forward in the timeline, mark the previous step dot as completed ('done')
  if (nextScreen > currentScreen) {
    currentDotElement.classList.add('done');
  }

  // Update global state and activate target screen elements
  currentScreen = nextScreen;
  nextScreenElement.classList.add('active');
  nextDotElement.classList.add('active');
}

// -------------------------------------------------------
// DATA ACTIONS
// -------------------------------------------------------
/**
 * @function saveMode
 * @description Saves the selected preset metrics to chrome.storage.local settings,
 * then forwards the user to the final summary screen.
 *
 * @returns {void}
 *
 * @side-effects
 *   - Asynchronously reads and writes settings in Chrome Local Storage.
 *   - Modifies DOM elements to show errors if Chrome storage writing fails.
 *
 * @uses
 *   - chrome.storage.local.get(): Extension API to retrieve storage values.
 *   - chrome.storage.local.set(): Extension API to store value changes.
 *   - Object.assign(): JavaScript method to perform a shallow merge of settings objects.
 */
function saveMode() {
  // Retrieve the appropriate settings package for the selected mode
  const patch = MODE_SETTINGS[selectedMode] || MODE_SETTINGS.balanced;

  // Retrieve current settings first so we do not overwrite other unrelated settings (e.g. webhookUrl)
  chrome.storage.local.get(['settings'], (result) => {
    // Merge existing settings with our mode patch (patch values override existing fields)
    const settings = Object.assign({}, result.settings || {}, patch);

    // Save the merged configuration dictionary back to storage
    chrome.storage.local.set({ settings }, () => {
      // Check if Chrome failed to save (e.g. storage limit exceeded or context invalid)
      if (chrome.runtime.lastError) {
        const saveButton = document.getElementById('btn-save-mode');
        if (saveButton) {
          saveButton.textContent = 'Save failed - try again';
        }
        return;
      }

      // Update final screen text to display selected metrics, then transition screen
      updateFinalSummary(selectedMode);
      goToScreen(2);
    });
  });
}

/**
 * @function finish
 * @description Marks onboarding complete in local storage and closes the tab.
 *
 * @returns {void}
 *
 * @uses
 *   - chrome.storage.local.set(): Extension API to register completion.
 *   - window.close(): Standard browser API to close the current tab.
 */
function finish() {
  chrome.storage.local.set({ onboardingComplete: true }, () => {
    if (chrome.runtime.lastError) {
      // If closing fails or storage throws an error, close anyway to release the user
      window.close();
      return;
    }

    window.close();
  });
}

/**
 * @function updateFinalSummary
 * @description Updates the textual text summary inside the last onboarding screen
 * based on the chosen mode details.
 *
 * @param {string} mode - Mode name ('balanced', 'strict', 'gentle').
 * @returns {void}
 *
 * @side-effects
 *   - Modifies DOM text content inside 'summary-eye-break' and 'summary-gentle'.
 */
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

// -------------------------------------------------------
// EVENT LISTENERS & INITS
// -------------------------------------------------------
/**
 * DOMContentLoaded Event Listener
 * @description Attaches click handlers to the UI control buttons and setup choices on window load.
 *
 * @uses
 *   - document.addEventListener(): Listens for DOM load.
 *   - querySelector() / getElementById(): Fetches nodes.
 */
document.addEventListener('DOMContentLoaded', () => {
  const startButton = document.getElementById('btn-start-onboarding');
  const saveButton = document.getElementById('btn-save-mode');
  const skipButton = document.getElementById('btn-skip-onboarding');
  const finishButton = document.getElementById('btn-finish-onboarding');

  // Attach button triggers
  startButton?.addEventListener('click', () => goToScreen(1));
  saveButton?.addEventListener('click', saveMode);
  skipButton?.addEventListener('click', () => goToScreen(2));
  finishButton?.addEventListener('click', finish);

  // Setup mode cards click choices
  const cards = document.querySelectorAll('.mode-card');
  cards.forEach((card) => {
    card.addEventListener('click', () => {
      // Remove selected border style from all mode cards
      cards.forEach((c) => c.classList.remove('selected'));

      // Select this card and update global variable
      card.classList.add('selected');
      selectedMode = card.getAttribute('data-mode') || 'balanced';
    });
  });

  // Pre-load summary screen metrics with initial defaults
  updateFinalSummary(selectedMode);
});
