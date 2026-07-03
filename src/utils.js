/**
 * @file utils.js
 * @description Shared Utility Functions & Timer Constants.
 *
 * @purpose
 * This file serves as a single source of truth for numerical constraints,
 * validations, and helper functions that need to be shared across different
 * runtime environments in this Chrome Extension:
 *   - The Extension Service Worker (background.js)
 *   - The Popup UI (popup.js)
 *   - Content Scripts injected into pages (content.js)
 *
 * By centralizing these rules here, we prevent desynchronization (where the UI allows
 * values that the background script rejects, or vice versa).
 *
 * @project-fit
 * It is imported by other JS scripts in the extension. In a Chrome Extension,
 * distinct contexts (background worker, popup, content scripts) have separate memories
 * and run in isolation, but they can share utility code built during the packaging/bundling stage.
 */

// ============================================================
// UTILS.JS — Shared Helper Functions & Constants
// ============================================================
// Everything exported here is safe to import by both service
// workers (background.js) and popup pages (popup.js).
// ============================================================

/**
 * @function clampNumber
 * @description Safely bounds a numeric value within a specific range, rounds it to the nearest
 * integer, and guarantees a safe fallback value if the input is corrupt or not a valid number.
 *
 * @param {any} value - The input value to clamp. Can be a string representation of a number.
 * @param {number} min - The absolute minimum allowed value (inclusive).
 * @param {number} max - The absolute maximum allowed value (inclusive).
 * @param {number} [fallback=min] - The value returned if `value` cannot be converted to a finite number.
 *
 * @returns {number} The clamped and rounded integer value.
 * @throws None - This is designed to be a fail-safe pure function.
 *
 * @side-effects
 * None (pure function).
 *
 * @called-by
 *   - mergeSettings() in background.js (when saving user configuration to storage)
 *   - Form inputs processing in popup.js (when validating user forms)
 *
 * @uses
 *   - Number(): Converts values to numbers (standard JavaScript API).
 *   - Number.isFinite(): Checks if a number is real/finite (avoids NaN/Infinity errors).
 *   - Math.round(): Rounds to the nearest integer.
 *   - Math.min() / Math.max(): Standard JS bounding pattern.
 */
export function clampNumber(value, min, max, fallback = min) {
  // Convert any arbitrary input type to a Number representation
  const numericValue = Number(value);

  // If the value is NaN, Infinity, or undefined, return the fallback to prevent mathematical corruption
  if (!Number.isFinite(numericValue)) return fallback;

  // Apply the clamp boundary: ensure the number is >= min and <= max, then round it
  return Math.min(max, Math.max(min, Math.round(numericValue)));
}

// -------------------------------------------------------
// TIMER LIMITS — enforced on both background.js and popup.js
// -------------------------------------------------------
// These are the hard limits for every user-configurable timer.
// The popup uses these to validate form input; the background
// uses them when merging/clamping incoming settings.
//
// NOTE: popup.js converts hydrationReminderMin ↔ hours for
// display purposes using its own local hydrationReminderHours
// entry — that key lives only in popup.js because it's a
// display-unit alias, not a storage unit.
/**
 * @constant {Object} TIMER_LIMITS
 * @description Defines the configuration limits for all user settings.
 * If these limits were absent, a malicious or buggy input could crash the timer loop,
 * lock up browser threads with too frequent intervals, or set values that exceed Chrome Storage limits.
 */
export const TIMER_LIMITS = {
  // Range (in minutes) for warning triggers on doom scrolling
  doomReminderMin: { min: 5, max: 30, fallback: 5 },
  doomReminderMax: { min: 5, max: 30, fallback: 5 },

  // Duration (in seconds) that the guided eye exercise screen stays active
  eyeBreakDurationSec: { min: 15, max: 40, fallback: 20 },

  // Delay (in minutes) before triggering a hydration reminder check
  hydrationReminderMin: { min: 60, max: 240, fallback: 60 },

  // Lower bound for work/productivity gentle reminder interval (in minutes)
  subtleReminderMin: { min: 20, max: 60, fallback: 20 },

  // Upper bound for work/productivity gentle reminder interval (in minutes)
  subtleReminderMax: { min: 20, max: 60, fallback: 35 },
};

// -------------------------------------------------------
// GENTLE_REMINDER_DUPLICATE_GUARD_MS
// -------------------------------------------------------
// Minimum gap (ms) between two gentle reminder showings to
// avoid rapid-fire duplicate toasts. Shared between
// background.js (ambient tick dedup) and content.js (local
// showGentleReminder dedup).
/**
 * @constant {number} GENTLE_REMINDER_DUPLICATE_GUARD_MS
 * @description The debounce window (in milliseconds) used to prevent the user from being
 * spammed with work/hydration reminders across multiple browser tabs simultaneously.
 * Without this guard, if a user had 5 tabs open, a reminder event would trigger
 * 5 separate reminders popping up in quick succession.
 */
export const GENTLE_REMINDER_DUPLICATE_GUARD_MS = 15 * 1000;
