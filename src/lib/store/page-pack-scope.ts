/**
 * Store page pack SKU scope (Wave 4 follow-up).
 * Reads never use activeSkuId / getSkuView. Mutations require an explicit skuId.
 */

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

/** In-memory pack map — Improve B must not overwrite A. */
export function writePackForSku<T>(
  packs: ReadonlyMap<string, T>,
  skuId: string,
  next: T,
): Map<string, T> {
  const out = new Map(packs);
  out.set(skuId, next);
  return out;
}
