/**
 * Shop + SKU Tools row routing.
 *
 * Consistent pattern: SKU-scoped tools deep-link to `/sku/[id]#supplier|marketing|finance`.
 * Store checklist is shop-wide; product-page packs use `/store?sku=`.
 *
 * Hub target SKU: prefer workspace.activeSkuId when it is live; otherwise the
 * first live SKU. Never dead-end when at least one live SKU exists.
 */

export type ToolsSection = "supplier" | "marketing" | "finance";

export function resolveHubToolSkuId(
  liveSkuIds: readonly string[],
  activeSkuId: string | null | undefined,
): string | null {
  if (liveSkuIds.length === 0) return null;
  if (activeSkuId && liveSkuIds.includes(activeSkuId)) return activeSkuId;
  return liveSkuIds[0] ?? null;
}

/**
 * Which live SKU Status + Journey label on the hub.
 * Prefer active live SKU; else first with attention chips; else first live.
 */
export function resolveHubOrientationSkuId(
  live: readonly { id: string; attentionCount: number }[],
  activeSkuId: string | null | undefined,
): string | null {
  if (live.length === 0) return null;
  const active = activeSkuId
    ? live.find((s) => s.id === activeSkuId)
    : undefined;
  if (active) return active.id;
  const needingAttention = live.find((s) => s.attentionCount > 0);
  if (needingAttention) return needingAttention.id;
  return live[0]?.id ?? null;
}

/** Store setup — include sku when known so the page pack matches that product. */
export function storeToolHref(
  skuId?: string | null,
): "/store" | `/store?sku=${string}` {
  const id = typeof skuId === "string" ? skuId.trim() : "";
  if (id) return `/store?sku=${id}`;
  return "/store";
}

/** SKU section anchor used from hub and SKU page alike. */
export function skuToolHref(
  skuId: string,
  section: ToolsSection,
): `/sku/${string}#${ToolsSection}` {
  return `/sku/${skuId}#${section}`;
}

export type ToolsUnlockFlags = {
  store: boolean;
  supplier: boolean;
  marketing: boolean;
  finance: boolean;
};

export function buildToolsHrefs(skuId: string | null): {
  store: "/store" | `/store?sku=${string}`;
  supplier: string | null;
  marketing: string | null;
  finance: string | null;
} {
  return {
    store: storeToolHref(skuId),
    supplier: skuId ? skuToolHref(skuId, "supplier") : null,
    marketing: skuId ? skuToolHref(skuId, "marketing") : null,
    finance: skuId ? skuToolHref(skuId, "finance") : null,
  };
}
