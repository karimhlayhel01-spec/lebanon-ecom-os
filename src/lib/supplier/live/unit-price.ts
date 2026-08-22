/**
 * WAVE-3 — unitPrice / unitPriceHint are USD only.
 * LBP listing digits must never be written as dollars.
 * No Gemini FX. Rate is env `USD_LBP_RATE` (LBP per 1 USD).
 */

export function resolveUsdLbpRate(
  env: Record<string, string | undefined> = process.env,
): number | null {
  const raw = env.USD_LBP_RATE;
  if (raw == null) return null;
  const n = Number(String(raw).trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function parseAmount(raw: string): number | null {
  const n = Number(raw.replace(/,/g, ""));
  if (!Number.isFinite(n) || n <= 0 || n >= 100_000_000) return null;
  return n;
}

function firstMatch(
  text: string,
  patterns: readonly RegExp[],
): number | null {
  for (const re of patterns) {
    const m = text.match(re);
    if (!m?.[1]) continue;
    const n = parseAmount(m[1]);
    if (n != null) return n;
  }
  return null;
}

/** Coupon / promo chrome — never treat as the listing unit. */
const DISCOUNT_CHROME =
  /\$\s*[\d,]+(?:\.\d{1,2})?\s+off(?:\s+(?:US\s*)?\$\s*[\d,]+(?:\.\d{1,2})?)?|\boff\s+(?:US\s*)?\$\s*[\d,]+(?:\.\d{1,2})?|\bsave\s+\$?\s*[\d,]+(?:\.\d{1,2})?/gi;

const USD_RANGE =
  /(?:US\s*\$|USD|\$)\s*([\d,]+(?:\.\d{1,2})?)\s*[-–—]\s*\$?\s*([\d,]+(?:\.\d{1,2})?)/i;

const USD_PATTERNS = [
  /US\s*\$\s*([\d,]+(?:\.\d{1,2})?)/i,
  /USD\s*([\d,]+(?:\.\d{1,2})?)/i,
  /(?:unit\s*price|price)[:\s]+(?:US\s*)?\$\s*([\d,]+(?:\.\d{1,2})?)/i,
  /\$\s*([\d,]+(?:\.\d{1,2})?)/,
];

function extractUsdListingAmount(text: string): number | null {
  const range = text.match(USD_RANGE);
  if (range?.[1] && range[2]) {
    const a = parseAmount(range[1]);
    const b = parseAmount(range[2]);
    if (a != null && b != null) return Math.min(a, b);
  }
  const cleaned = text.replace(DISCOUNT_CHROME, " ");
  return firstMatch(cleaned, USD_PATTERNS);
}

const LBP_PATTERNS = [
  /(?:LBP|L\.L\.|LL)\s*([\d,]+(?:\.\d{1,2})?)/i,
  /(?:ل\.ل\.?|ليرة)\s*([\d,]+(?:\.\d{1,2})?)/,
  /([\d,]+(?:\.\d{1,2})?)\s*(?:LBP|L\.L\.|LL)\b/i,
  /([\d,]+(?:\.\d{1,2})?)\s*(?:ل\.ل\.?|ليرة)/,
];

export function lbpToUsd(
  lbp: number,
  usdLbpRate: number | null | undefined,
): number | null {
  if (!(lbp > 0)) return null;
  if (usdLbpRate == null || !(usdLbpRate > 0)) return null;
  return Math.round((lbp / usdLbpRate) * 100) / 100;
}

/**
 * Parse a listing/snippet price into USD. USD markers win.
 * LBP converts only when `usdLbpRate` is a positive LBP-per-USD figure.
 */
export function extractUnitPriceUsd(
  text: string,
  usdLbpRate: number | null = resolveUsdLbpRate(),
): number | null {
  if (!text.trim()) return null;
  const usd = extractUsdListingAmount(text);
  if (usd != null) return usd;
  const lbp = firstMatch(text, LBP_PATTERNS);
  if (lbp == null) return null;
  return lbpToUsd(lbp, usdLbpRate);
}
