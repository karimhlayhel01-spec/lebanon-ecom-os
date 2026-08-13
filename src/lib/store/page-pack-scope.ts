/**
 * Store page pack SKU scope (Wave 4 follow-up).
 * Reads never use activeSkuId / getSkuView. Mutations use parseGenerateKitSkuScope
 * (explicit null = shop; omitted/blank = not_found). Never pass "shop" into
 * resolveStorePanelSkuId.
 */

export const STORE_SHOP_SKU_PARAM = "shop";
export const SHOP_PACK_MIN_LIVE = 3;

export function shopPackAvailable(liveCount: number): boolean {
  return liveCount >= SHOP_PACK_MIN_LIVE;
}

/** URL ?sku=shop is a shop pack only when ≥3 live. */
export function isStoreShopPackRequest(
  skuParam: string | null | undefined,
  liveCount: number,
): boolean {
  return skuParam === STORE_SHOP_SKU_PARAM && shopPackAvailable(liveCount);
}

/**
 * Query value for resolveStorePanelSkuId. Never forwards the literal "shop"
 * (that would miss every live id and steal first live).
 */
export function skuParamForStoreResolve(
  skuParam: string | null | undefined,
): string | null | undefined {
  if (skuParam === STORE_SHOP_SKU_PARAM) return undefined;
  return skuParam;
}

/** Panel read: honor ?sku= when live; else first live. Never activeSkuId steal. */
export function resolveStorePanelSkuId(
  liveSkuIds: readonly string[],
  requested: string | null | undefined,
): string | null {
  if (liveSkuIds.length === 0) return null;
  const id = typeof requested === "string" ? requested.trim() : "";
  if (id && liveSkuIds.includes(id)) return id;
  return liveSkuIds[0] ?? null;
}

/**
 * One-time migrate target: prefer current activeSkuId if it is live, else first live.
 * Used by SQL migration + tests — not by Improve / pack reads.
 */
export function legacyMigrateTargetSkuId(
  liveSkuIds: readonly string[],
  activeSkuId: string | null | undefined,
): string | null {
  if (liveSkuIds.length === 0) return null;
  if (activeSkuId && liveSkuIds.includes(activeSkuId)) return activeSkuId;
  return liveSkuIds[0] ?? null;
}

/** In-memory pack map — Improve B must not overwrite A; shop (null) is its own key. */
export function writePackForSku<T>(
  packs: ReadonlyMap<string | null, T>,
  skuId: string | null,
  next: T,
): Map<string | null, T> {
  const out = new Map(packs);
  out.set(skuId, next);
  return out;
}
