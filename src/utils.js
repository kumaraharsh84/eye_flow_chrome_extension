// ============================================================
// UTILS.JS — Shared Helper Functions
// ============================================================

function clampNumber(value, min, max, fallback = min) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return fallback;
  return Math.min(max, Math.max(min, Math.round(numericValue)));
}
