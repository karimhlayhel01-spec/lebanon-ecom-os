/**
 * Client-safe listing URL helpers for Assess listing.
 * No fetch / Serper / db — safe to import from SupplierPanel.
 */

export function isHttpListingUrl(url: string | null | undefined): boolean {
  if (!url?.trim()) return false;
  try {
    const u = new URL(url.trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** Assess enabled only for real http(s) listing URLs. */
export function canAssessListingUrl(
  sourceUrl: string | null | undefined,
): boolean {
  return isHttpListingUrl(sourceUrl);
}
