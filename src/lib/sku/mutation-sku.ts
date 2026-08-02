/**
 * Fail-closed SKU targeting for journey *mutation* paths.
 * Soft activeSkuId preference is for reads / deep-links only — never here.
 */

export type JourneyMutationSkuTarget =
  | { ok: true; kind: "sku"; skuId: string }
  | { ok: true; kind: "legacy" }
  | { ok: false; error: "invalid_transition" };

function trimSkuId(skuId: unknown): string {
  return typeof skuId === "string" ? skuId.trim() : "";
}

/**
 * Advance: when any live SKU exists, callers must pass an explicit non-empty skuId.
 * Legacy workspace `journey_states` advance only when the shop has zero live SKUs
 * (first-accept / empty shop).
 */
export function resolveAdvanceJourneySkuTarget(args: {
  skuId: unknown;
  liveCount: number;
}): JourneyMutationSkuTarget {
  const id = trimSkuId(args.skuId);
  if (id) return { ok: true, kind: "sku", skuId: id };
  if (args.liveCount === 0) return { ok: true, kind: "legacy" };
  return { ok: false, error: "invalid_transition" };
}

/**
 * Block / unblock: explicit skuId, or the sole live SKU; never soft-pick
 * activeSkuId among many live SKUs.
 */
export function resolveBlockUnblockSkuTarget(args: {
  skuId: unknown;
  liveSkuIds: readonly string[];
}): JourneyMutationSkuTarget {
  const id = trimSkuId(args.skuId);
  if (id) return { ok: true, kind: "sku", skuId: id };
  if (args.liveSkuIds.length === 0) return { ok: true, kind: "legacy" };
  if (args.liveSkuIds.length === 1) {
    return { ok: true, kind: "sku", skuId: args.liveSkuIds[0]! };
  }
  return { ok: false, error: "invalid_transition" };
}
