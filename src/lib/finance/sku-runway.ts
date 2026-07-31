import {
  parsePerSkuSoldLeft,
  serializePerSkuSoldLeft,
} from "@/lib/finance/service";
import {
  REORDER_RUNWAY_LOOKBACK_WEEKS,
  computeSkuRunway,
  type SkuRunwayView,
} from "@/lib/supplier/reorder";

/**
 * Pull per-SKU left + recent weekly sold from Topic A rows.
 * Mode C: that skuId’s line only — never shop roll-up / blended left.
 * Legacy (no `skus` map): only when liveSkuCount ≤ 1. With 2+ live SKUs,
 * legacy weeks are skipped for that skuId (unknown) — never bleed another
 * SKU’s sold/left onto a new live product.
 */
export function extractSkuTopicASeries(
  entries: readonly { perSkuSoldLeft: string }[],
  skuId: string,
  lookback: number = REORDER_RUNWAY_LOOKBACK_WEEKS,
  opts?: { liveSkuCount?: number },
): { skuLeft: number | null; recentWeeklySold: number[] } {
  const recent = entries.slice(-lookback);
  const recentWeeklySold: number[] = [];
  let skuLeft: number | null = null;
  /** Once any Mode C week appears in the window, never fall back to legacy blend. */
  let sawModeC = false;
  const multiLive = (opts?.liveSkuCount ?? 1) >= 2;

  for (const row of recent) {
    const parsed = parsePerSkuSoldLeft(row.perSkuSoldLeft);
    const modeC = Object.keys(parsed.skus).length > 0;
    if (modeC) {
      sawModeC = true;
      const line = parsed.skus[skuId];
      if (line) {
        recentWeeklySold.push(line.sold);
        skuLeft = line.left;
      }
      // Missing skuId in a Mode C week → skip (do not use blended skuLeft).
      continue;
    }
    if (sawModeC) continue; // stay Mode C–strict after first Mode C week
    // 2+ live: legacy weeks have no per-SKU map — skip (no cross-SKU bleed).
    if (multiLive) continue;
    // Sole live SKU: legacy Topic A belongs to that product.
    recentWeeklySold.push(parsed.skuSold);
    skuLeft = parsed.skuLeft;
  }

  return { skuLeft, recentWeeklySold };
}

/**
 * Inventory that became real on batch arrive (importBatch.unitsLeft, else
 * ordered suggestedFirstBatch). Null while still in transit / not arrived.
 * Topic A left still wins once weekly rows exist for this skuId.
 */
export function batchInventoryUnitsFromImportBatch(
  importBatch:
    | {
        unitsLeft?: number | null;
        suggestedFirstBatch?: number | null;
      }
    | null
    | undefined,
  opts: { batchArrivedReady: boolean },
): number | null {
  if (!opts.batchArrivedReady || !importBatch) return null;
  const raw =
    importBatch.unitsLeft != null && Number.isFinite(importBatch.unitsLeft)
      ? importBatch.unitsLeft
      : importBatch.suggestedFirstBatch != null &&
          Number.isFinite(importBatch.suggestedFirstBatch)
        ? importBatch.suggestedFirstBatch
        : null;
  if (raw == null) return null;
  return Math.max(0, Math.floor(raw));
}

/** Topic A left when known; else batch-arrive inventory bootstrap. */
export function resolveSkuLeftWithBatchBootstrap(args: {
  topicALeft: number | null;
  batchInventoryUnits: number | null;
}): number | null {
  if (args.topicALeft != null && Number.isFinite(args.topicALeft)) {
    return Math.max(0, args.topicALeft);
  }
  if (
    args.batchInventoryUnits != null &&
    Number.isFinite(args.batchInventoryUnits)
  ) {
    return Math.max(0, Math.floor(args.batchInventoryUnits));
  }
  return null;
}

/**
 * On-hand base for next-batch arrive: Topic A left for this skuId, else
 * importBatch bootstrap, else 0.
 */
export function resolvePriorLeftForReorderArrive(args: {
  topicALeft: number | null;
  batchInventoryUnits: number | null;
}): number {
  if (args.topicALeft != null && Number.isFinite(args.topicALeft)) {
    return Math.max(0, args.topicALeft);
  }
  if (
    args.batchInventoryUnits != null &&
    Number.isFinite(args.batchInventoryUnits)
  ) {
    return Math.max(0, Math.floor(args.batchInventoryUnits));
  }
  return 0;
}

/**
 * Index of the Topic A week whose left the glance currently reads for this
 * skuId — last Mode C line for skuId, else last sole-live legacy week.
 * -1 when nothing bumpable (e.g. multi-live legacy-only).
 */
export function findTopicARowIndexToBumpLeft(
  entries: readonly { perSkuSoldLeft: string }[],
  skuId: string,
  liveSkuCount: number = 1,
): number {
  const multiLive = liveSkuCount >= 2;
  let lastModeCWithLine = -1;
  let lastModeCAny = -1;
  let lastSoleLegacy = -1;

  for (let i = 0; i < entries.length; i++) {
    const parsed = parsePerSkuSoldLeft(entries[i]!.perSkuSoldLeft);
    const modeC = Object.keys(parsed.skus).length > 0;
    if (modeC) {
      lastModeCAny = i;
      if (parsed.skus[skuId]) lastModeCWithLine = i;
      continue;
    }
    if (!multiLive) lastSoleLegacy = i;
  }

  if (lastModeCWithLine >= 0) return lastModeCWithLine;
  if (lastModeCAny >= 0) return lastModeCAny;
  return lastSoleLegacy;
}

/**
 * Bump one Topic A week’s left for a single skuId after reorder arrive.
 * Mode C: only that skuId’s line (sold/sales unchanged; missing line seeds
 * sold/sales 0 — not a new fake week). Uses that line’s left when present,
 * else priorLeft (current glance left). Legacy sole-SKU: bump shop left.
 * Multi-live legacy weeks are not rewritten (would bleed) — returns null;
 * caller still updates importBatch bootstrap.
 */
export function bumpTopicALeftAfterReorder(args: {
  perSkuSoldLeft: string;
  skuId: string;
  addQty: number;
  priorLeft: number;
  liveSkuCount?: number;
}): { perSkuSoldLeft: string; newLeft: number } | null {
  const addQty = Math.max(0, Math.floor(args.addQty));
  if (addQty <= 0) return null;

  const priorLeft = Math.max(0, Math.floor(args.priorLeft));
  const parsed = parsePerSkuSoldLeft(args.perSkuSoldLeft);
  const modeC = Object.keys(parsed.skus).length > 0;
  const multiLive = (args.liveSkuCount ?? 1) >= 2;

  if (modeC) {
    const existing = parsed.skus[args.skuId];
    const baseLeft =
      existing != null && Number.isFinite(existing.left)
        ? Math.max(0, existing.left)
        : priorLeft;
    const newLeft = baseLeft + addQty;
    const skus = {
      ...parsed.skus,
      [args.skuId]: {
        sold: existing?.sold ?? 0,
        left: newLeft,
        sales: existing?.sales ?? 0,
      },
    };
    return {
      perSkuSoldLeft: serializePerSkuSoldLeft({
        orders: parsed.orders,
        skus,
      }),
      newLeft,
    };
  }

  if (multiLive) return null;

  const newLeft = priorLeft + addQty;
  return {
    perSkuSoldLeft: serializePerSkuSoldLeft({
      orders: parsed.orders,
      skuSold: parsed.skuSold,
      skuLeft: newLeft,
    }),
    newLeft,
  };
}

export function computeRunwayForSkuFromEntries(
  entries: readonly { perSkuSoldLeft: string }[],
  skuId: string,
  opts?: { liveSkuCount?: number; batchInventoryUnits?: number | null },
): SkuRunwayView {
  const series = extractSkuTopicASeries(entries, skuId, undefined, opts);
  const skuLeft = resolveSkuLeftWithBatchBootstrap({
    topicALeft: series.skuLeft,
    batchInventoryUnits: opts?.batchInventoryUnits ?? null,
  });
  return computeSkuRunway({ ...series, skuLeft });
}

/**
 * Read-only units-left glance. Never invents 0 when Topic A left is unknown.
 * weeks only when runway math produced a known weeks value.
 */
export type UnitsLeftGlance =
  | {
      kind: "known";
      unitsLeft: number;
      /** Present only when sell-through runway weeks are known. */
      weeks: number | null;
    }
  | { kind: "unknown" };

export function resolveUnitsLeftGlance(runway: SkuRunwayView): UnitsLeftGlance {
  if (runway.skuLeft == null) return { kind: "unknown" };
  return {
    kind: "known",
    unitsLeft: runway.skuLeft,
    weeks: runway.weeks,
  };
}

/** Hub: selling always; batch_arrived_ready only when left is known. */
export function shouldShowUnitsLeftOnHub(args: {
  primaryState: string;
  unitsLeft: number | null;
}): boolean {
  if (args.primaryState === "selling") return true;
  if (
    args.primaryState === "batch_arrived_ready" &&
    args.unitsLeft != null
  ) {
    return true;
  }
  return false;
}
