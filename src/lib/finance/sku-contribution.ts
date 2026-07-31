import { INVEST_NEXT_MIN_WEEKS } from "@/lib/constants";
import type { CostBasis, SkuWeekLine } from "@/lib/finance/service";

/**
 * Per-SKU contribution breakdown (Mode C secondary read).
 *
 * Does NOT change shop Topic A roll-up / health / invest-next.
 * Window matches Current Actual policy: last ≤ INVEST_NEXT_MIN_WEEKS (4)
 * usable weeks that have `skuLines`. Weeks without per-SKU lines are skipped
 * (legacy single-SKU logs) and counted for UI copy.
 *
 * Primary rank metric: **sales** (highest → lowest) — clearest “who contributed
 * most this window.” Before-ads margin is exact per SKU (sales − that SKU’s
 * import COGS) / sales — courier is shop-level and not allocated into before.
 * Optional estimated after-ads allocates shop ads + courier by sales share.
 */

export type SkuContributionEntry = {
  weekStart: string;
  sales: number;
  skuSold: number;
  metaSpend: number;
  tiktokSpend: number;
  courierFees: number;
  skuLines?: SkuWeekLine[];
};

export type SkuContributionRow = {
  skuId: string;
  name: string;
  sales: number;
  unitsSold: number;
  cogs: number;
  /** Exact: (sales − COGS) / sales. Null when sales ≤ 0. */
  marginBefore: number | null;
  /**
   * Estimated: (sales − COGS − salesShare×(ads+courier)) / sales.
   * Labeled “Estimated (shared shop costs)” in UI — not a private P&L.
   */
  estimatedMarginAfter: number | null;
  /** 1 = highest sales in window. */
  rank: number;
};

export type SkuContributionBreakdown = {
  weekStarts: string[];
  weeksSkippedNoLines: number;
  rankedBy: "sales";
  rows: SkuContributionRow[];
};

/** Single-week split for a logged EntryRow — before-ads only (no after-ads estimate). */
export type WeekSkuContributionRow = {
  skuId: string;
  name: string;
  sales: number;
  unitsSold: number;
  cogs: number;
  marginBefore: number | null;
  rank: number;
};

export type WeekSkuContribution = {
  rankedBy: "sales";
  rows: WeekSkuContributionRow[];
};

/**
 * Compact per-SKU contribution for one Topic A week.
 * Returns null when `skuLines` is missing/empty (legacy weeks).
 * Shows even for a single line. Never includes last-mile in unit COGS.
 */
export function computeWeekSkuContribution(args: {
  skuLines: SkuWeekLine[] | undefined | null;
  basisBySku: Map<string, CostBasis>;
  skuNames: Map<string, string>;
}): WeekSkuContribution | null {
  const lines = args.skuLines;
  if (!lines || lines.length === 0) return null;

  const bySku = new Map<
    string,
    { sales: number; unitsSold: number; cogs: number }
  >();

  for (const line of lines) {
    const basis = args.basisBySku.get(line.skuId);
    const unit = basis?.importCogsPerUnit ?? 0;
    const sold = Math.max(0, line.sold);
    const sales = Math.max(0, line.sales);
    const prev = bySku.get(line.skuId) ?? {
      sales: 0,
      unitsSold: 0,
      cogs: 0,
    };
    bySku.set(line.skuId, {
      sales: prev.sales + sales,
      unitsSold: prev.unitsSold + sold,
      cogs: prev.cogs + unit * sold,
    });
  }

  const rowsUnranked: Omit<WeekSkuContributionRow, "rank">[] = [];
  for (const [skuId, agg] of bySku) {
    rowsUnranked.push({
      skuId,
      name: args.skuNames.get(skuId) ?? skuId,
      sales: agg.sales,
      unitsSold: agg.unitsSold,
      cogs: agg.cogs,
      marginBefore:
        agg.sales > 0 ? (agg.sales - agg.cogs) / agg.sales : null,
    });
  }

  rowsUnranked.sort(
    (a, b) =>
      b.sales - a.sales ||
      b.unitsSold - a.unitsSold ||
      a.name.localeCompare(b.name),
  );

  return {
    rankedBy: "sales",
    rows: rowsUnranked.map((r, i) => ({ ...r, rank: i + 1 })),
  };
}

export function computeSkuContributionBreakdown(args: {
  entries: SkuContributionEntry[];
  basisBySku: Map<string, CostBasis>;
  skuNames: Map<string, string>;
  /** Default 2 — hide when fewer distinct SKUs appear in the window. */
  minSkus?: number;
}): SkuContributionBreakdown | null {
  const minSkus = args.minSkus ?? 2;
  const usable = args.entries.filter((e) => e.sales > 0 && e.skuSold > 0);
  const withLines = usable.filter(
    (e) => e.skuLines != null && e.skuLines.length > 0,
  );
  const weeksSkippedNoLines = usable.length - withLines.length;

  if (withLines.length === 0) return null;

  const window =
    withLines.length >= INVEST_NEXT_MIN_WEEKS
      ? withLines.slice(-INVEST_NEXT_MIN_WEEKS)
      : withLines;

  type Agg = {
    sales: number;
    unitsSold: number;
    cogs: number;
  };
  const bySku = new Map<string, Agg>();
  let windowSales = 0;
  let windowAds = 0;
  let windowCourier = 0;

  for (const e of window) {
    windowSales += e.sales;
    windowAds += e.metaSpend + e.tiktokSpend;
    windowCourier += e.courierFees;
    for (const line of e.skuLines ?? []) {
      const basis = args.basisBySku.get(line.skuId);
      const unit = basis?.importCogsPerUnit ?? 0;
      const sold = Math.max(0, line.sold);
      const sales = Math.max(0, line.sales);
      const prev = bySku.get(line.skuId) ?? {
        sales: 0,
        unitsSold: 0,
        cogs: 0,
      };
      bySku.set(line.skuId, {
        sales: prev.sales + sales,
        unitsSold: prev.unitsSold + sold,
        cogs: prev.cogs + unit * sold,
      });
    }
  }

  if (bySku.size < minSkus) return null;

  const sharedCosts = windowAds + windowCourier;
  const rowsUnranked: Omit<SkuContributionRow, "rank">[] = [];

  for (const [skuId, agg] of bySku) {
    const marginBefore =
      agg.sales > 0 ? (agg.sales - agg.cogs) / agg.sales : null;
    const salesShare = windowSales > 0 ? agg.sales / windowSales : 0;
    const allocatedShared = salesShare * sharedCosts;
    const estimatedMarginAfter =
      agg.sales > 0
        ? (agg.sales - agg.cogs - allocatedShared) / agg.sales
        : null;
    rowsUnranked.push({
      skuId,
      name: args.skuNames.get(skuId) ?? skuId,
      sales: agg.sales,
      unitsSold: agg.unitsSold,
      cogs: agg.cogs,
      marginBefore,
      estimatedMarginAfter,
    });
  }

  rowsUnranked.sort(
    (a, b) =>
      b.sales - a.sales ||
      b.unitsSold - a.unitsSold ||
      a.name.localeCompare(b.name),
  );

  const rows: SkuContributionRow[] = rowsUnranked.map((r, i) => ({
    ...r,
    rank: i + 1,
  }));

  return {
    weekStarts: window.map((e) => e.weekStart),
    weeksSkippedNoLines,
    rankedBy: "sales",
    rows,
  };
}
