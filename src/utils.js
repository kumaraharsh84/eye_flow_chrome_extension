// ============================================================
// UTILS.JS — Shared Helper Functions & Constants
// ============================================================
// Everything exported here is safe to import by both service
// workers (background.js) and popup pages (popup.js).
// ============================================================

/**
 * Clamps a value to [min, max], rounds to nearest integer,
 * and falls back to `fallback` when the input is non-numeric.
 */
export function clampNumber(value, min, max, fallback = min) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return fallback;
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
export const TIMER_LIMITS = {
  doomReminderMin: { min: 5, max: 30, fallback: 5 },
  doomReminderMax: { min: 5, max: 30, fallback: 5 },
  eyeBreakDurationSec: { min: 15, max: 40, fallback: 20 },
  hydrationReminderMin: { min: 60, max: 240, fallback: 60 },
  subtleReminderMin: { min: 20, max: 60, fallback: 20 },
  subtleReminderMax: { min: 20, max: 60, fallback: 35 },
};

// -------------------------------------------------------
// GENTLE_REMINDER_DUPLICATE_GUARD_MS
// -------------------------------------------------------
// Minimum gap (ms) between two gentle reminder showings to
// avoid rapid-fire duplicate toasts. Shared between
// background.js (ambient tick dedup) and content.js (local
// showGentleReminder dedup).
export const GENTLE_REMINDER_DUPLICATE_GUARD_MS = 15 * 1000;
