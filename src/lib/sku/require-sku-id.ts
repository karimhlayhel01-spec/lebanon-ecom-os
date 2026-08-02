/**
 * Explicit skuId for mutating actions — never soft-fallback to activeSkuId.
 */

export type RequiredSkuIdResult =
  | { ok: true; skuId: string }
  | { ok: false; error: "not_found" };

/** Non-empty trimmed string, or not_found (missing / blank / non-string). */
export function parseRequiredSkuId(skuId: unknown): RequiredSkuIdResult {
  if (typeof skuId !== "string") return { ok: false, error: "not_found" };
  const id = skuId.trim();
  if (!id) return { ok: false, error: "not_found" };
  return { ok: true, skuId: id };
}

/**
 * generateKit scope:
 * - `null` → explicit shop-kit request
 * - non-empty string → SKU kit
 * - missing / blank → not_found (no activeSkuId fallback)
 */
export function parseGenerateKitSkuScope(
  skuId: unknown,
): RequiredSkuIdResult | { ok: true; skuId: null } {
  if (skuId === null) return { ok: true, skuId: null };
  return parseRequiredSkuId(skuId);
}
