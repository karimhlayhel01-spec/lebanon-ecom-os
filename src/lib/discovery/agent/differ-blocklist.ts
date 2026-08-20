/**
 * WAVE-2 §14.5 — founder copy must never pitch sell-as-is or undercutting
 * Ishtari on price. Shared by differ lines and Why/Compare stock-phrase guards.
 */

export const SELL_AS_IS_BLOCKLIST = [
  "sell as-is",
  "sell as is",
  "undercut ishtari",
  "undercut Ishtari",
  "guaranteed sales",
] as const;

const SELL_AS_IS_PATTERNS: readonly RegExp[] = [
  /sell\s+as[-\s]is/i,
  /undercut\s+ishtari/i,
  /guaranteed\s+sales/i,
  /بيع\s+كما\s+هو/,
  /مبيعات\s+مضمونة/,
];

/** True when copy tells the founder to sell as-is or undercut on price. */
export function containsSellAsIsWording(text: string): boolean {
  return SELL_AS_IS_PATTERNS.some((re) => re.test(text));
}

/** Prefer curated differ; fall back when missing or blocklisted. */
export function safeDifferentiateLine(
  raw: string | null | undefined,
  fallback: string,
): string {
  const trimmed = raw?.replace(/\s+/g, " ").trim() ?? "";
  if (!trimmed || containsSellAsIsWording(trimmed)) return fallback;
  return trimmed;
}
