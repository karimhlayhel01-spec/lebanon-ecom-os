/**
 * Display product names for Discovery UI + explain (§6.1 / §6.2).
 * Same source of truth as card copy: AR prefers nameAr, else nameEn.
 */

export type DiscoveryUiLocale = "en" | "ar";

/**
 * Resolve the product name the founder sees (and Gemini must quote exactly).
 * Never invents Arabic — empty nameAr falls back to nameEn, matching the card.
 */
export function resolveDisplayProductName(input: {
  locale: DiscoveryUiLocale;
  nameEn: string;
  nameAr?: string | null;
  /** Session/candidate snapshot when pool rows are missing. */
  fallbackName?: string | null;
}): string {
  const en = input.nameEn.replace(/\s+/g, " ").trim();
  const ar = (input.nameAr ?? "").replace(/\s+/g, " ").trim();
  const fallback = (input.fallbackName ?? "").replace(/\s+/g, " ").trim();
  if (input.locale === "ar") {
    return ar || en || fallback;
  }
  return en || fallback;
}
