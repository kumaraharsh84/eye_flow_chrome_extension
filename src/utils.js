/**
 * @file utils.js
 * @description Shared constants and pure helpers used by the service worker
 * (background.js), the popup (popup.js) and the content script (content.js).
 *
 * Keeping limits and timing math in one place prevents the popup from accepting
 * values that the background would later reject or interpret differently.
 */

/**
 * Bounds a value to [min, max], rounds it to an integer, and returns `fallback`
 * when the input is not a finite number.
 */
export function clampNumber(value, min, max, fallback = min) {
  const numericValue = Number(value);
  if (value === '' || value === null || !Number.isFinite(numericValue)) return fallback;
  return Math.min(max, Math.max(min, Math.round(numericValue)));
}

/** Hard limits for every user-configurable timer. */
export const TIMER_LIMITS = Object.freeze({
  // Minutes of active doom scrolling before an eye break
  doomReminderMin: { min: 5, max: 30, fallback: 5 },
  doomReminderMax: { min: 5, max: 30, fallback: 5 },
  // Seconds the guided eye exercise lasts
  eyeBreakDurationSec: { min: 15, max: 40, fallback: 20 },
  // Minutes between water reminders
  hydrationReminderMin: { min: 60, max: 240, fallback: 60 },
  // Minutes between gentle reminders on normal pages
  subtleReminderMin: { min: 20, max: 60, fallback: 20 },
  subtleReminderMax: { min: 20, max: 60, fallback: 35 },
  // Minutes between background sound reminders
  soundReminderMin: { min: 10, max: 120, fallback: 20 },
  soundReminderMax: { min: 10, max: 120, fallback: 30 },
});

/** Minimum gap between two gentle reminder toasts in the same tab. */
export const GENTLE_REMINDER_DUPLICATE_GUARD_MS = 15 * 1000;

/** An eye break never fires sooner than this, however strict the sensitivity. */
export const MIN_BREAK_DELAY_MS = 2 * 60 * 1000;

/**
 * Maps the 0-100 sensitivity slider to a multiplier for the eye-break interval.
 *   100 (strict)  -> 0.5  (breaks arrive twice as fast)
 *    50 (default) -> 1.0
 *     0 (relaxed) -> 1.5
 */
export function getSensitivityMultiplier(sensitivity) {
  return 1.5 - clampNumber(sensitivity, 0, 100, 50) / 100;
}

/** Active doom-scroll time (ms) required before the next eye break. */
export function getBreakDelayMs(intervalMinutes, sensitivity) {
  const minutes = clampNumber(
    intervalMinutes,
    TIMER_LIMITS.doomReminderMin.min,
    TIMER_LIMITS.doomReminderMax.max,
    TIMER_LIMITS.doomReminderMin.fallback
  );
  const delayMs = Math.round(minutes * 60 * 1000 * getSensitivityMultiplier(sensitivity));
  return Math.max(MIN_BREAK_DELAY_MS, delayMs);
}

/** Webhooks must be plain https URLs; anything else is rejected. */
export function isValidWebhookUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    return new URL(value.trim()).protocol === 'https:';
  } catch (e) {
    return false;
  }
}
