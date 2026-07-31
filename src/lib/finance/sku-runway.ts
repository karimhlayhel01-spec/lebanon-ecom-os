import { parsePerSkuSoldLeft } from "@/lib/finance/service";
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

export function computeRunwayForSkuFromEntries(
  entries: readonly { perSkuSoldLeft: string }[],
  skuId: string,
  opts?: { liveSkuCount?: number },
): SkuRunwayView {
  const series = extractSkuTopicASeries(entries, skuId, undefined, opts);
  return computeSkuRunway(series);
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
