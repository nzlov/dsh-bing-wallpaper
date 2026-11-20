export const DEFAULT_STRENGTH = 28;

export function normalizeStrength(value) {
  return Number.isFinite(value) ? Math.round(Math.min(100, Math.max(10, value))) : DEFAULT_STRENGTH;
}

export function backgroundAlpha(strength) {
  return Math.sqrt(1 - normalizeStrength(strength) / 100);
}
