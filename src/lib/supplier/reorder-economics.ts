/**
 * Per-SKU next-batch economics (Fix #3).
 *
 * Shop Finance invest-next stays Mode C shop roll-up. Reorder economics /
 * coaching tone must use THIS SKU only — never bleed a healthy shop into a
 * weak SKU (or vice versa).
 */

import { INVEST_NEXT_MIN_WEEKS, MARGIN_AFTER_ADS_MIN } from "@/lib/constants";
import { parsePerSkuSoldLeft } from "@/lib/finance/service";
import type { InvestNextTone } from "@/lib/supplier/reorder";

/** One Topic A week, shaped for per-SKU economics. */
export type SkuTopicAWeekForEconomics = {
  weekStart?: string;
  /** Shop roll-up sales (Mode C Σ lines or legacy store totals). */
  sales: number;
  skuSold: number;
  metaSpend: number;
  tiktokSpend: number;
  courierFees: number;
  /** Mode C per-SKU map; absent/empty = legacy single-SKU week. */
  skus?: Record<string, { sold: number; left: number; sales: number }>;
};

export type TopicARowForEconomics = {
  weekStart: string;
  storeTotalsUsd: number;
  metaSpend: number;
  tiktokSpend: number;
  courierFees: number;
  perSkuSoldLeft: string;
};

/** Map a Topic A DB row into the pure economics week shape. */
export function topicAWeekFromRow(
  row: TopicARowForEconomics,
): SkuTopicAWeekForEconomics {
  const parsed = parsePerSkuSoldLeft(row.perSkuSoldLeft);
  const hasModeC = Object.keys(parsed.skus).length > 0;
  const skus = hasModeC ? parsed.skus : undefined;
  const sales = skus
    ? Object.values(skus).reduce((s, l) => s + Math.max(0, l.sales), 0)
    : row.storeTotalsUsd;
  return {
    weekStart: row.weekStart,
    sales,
    skuSold: parsed.skuSold,
    metaSpend: row.metaSpend,
    tiktokSpend: row.tiktokSpend,
    courierFees: row.courierFees,
    skus,
  };
}

type SkuWeekSlice = {
  sales: number;
  sold: number;
  shopSales: number;
  ads: number;
  courier: number;
};

/**
 * Resolve this SKU’s slice for one week.
 * Mode C: that skuId’s line only; allocate shop ads+courier later by sales share.
 * Legacy: whole week belongs to this SKU (same as runway extractor).
 * Returns null when Mode C week has no line for this skuId.
 */
export function sliceTopicAWeekForSku(
  entry: SkuTopicAWeekForEconomics,
  skuId: string,
): SkuWeekSlice | null {
  const modeC = entry.skus != null && Object.keys(entry.skus).length > 0;
  const ads = entry.metaSpend + entry.tiktokSpend;
  if (modeC) {
    const line = entry.skus![skuId];
    if (!line) return null;
    return {
      sales: Math.max(0, line.sales),
      sold: Math.max(0, line.sold),
      shopSales: Math.max(0, entry.sales),
      ads,
      courier: Math.max(0, entry.courierFees),
    };
  }
  return {
    sales: Math.max(0, entry.sales),
    sold: Math.max(0, entry.skuSold),
    shopSales: Math.max(0, entry.sales),
    ads,
    courier: Math.max(0, entry.courierFees),
  };
}

/**
 * Per-SKU invest-next tone for reorder economics / coaching.
 *
 * Window = last ≤ INVEST_NEXT_MIN_WEEKS usable weeks for this SKU (sales>0 & sold>0).
 * Returns null when fewer than min usable weeks (not healthier yet).
 *
 * Tone matches shop computeInvestNext spirit:
 *   reinvest — avg weekly net > 0 AND estimated after-ads ≥ 35%
 *   fix_economics — net > 0 but after-ads weak
 *   hold — not profitable
 *
 * Mode C estimated after allocates shop ads+courier by sales share
 * (same spirit as sku-contribution). Legacy weeks allocate 100% shared costs.
 */
export function resolveSkuInvestNextTone(args: {
  skuId: string;
  entries: readonly SkuTopicAWeekForEconomics[];
  importCogsPerUnit: number;
  minWeeks?: number;
}): InvestNextTone | null {
  const minWeeks = args.minWeeks ?? INVEST_NEXT_MIN_WEEKS;
  const unit = Math.max(0, args.importCogsPerUnit);

  const usable: SkuWeekSlice[] = [];
  for (const entry of args.entries) {
    const slice = sliceTopicAWeekForSku(entry, args.skuId);
    if (!slice) continue;
    if (slice.sales > 0 && slice.sold > 0) usable.push(slice);
  }

  if (usable.length < minWeeks) return null;

  const window =
    usable.length >= minWeeks ? usable.slice(-minWeeks) : usable;

  let sumSkuSales = 0;
  let sumCogs = 0;
  let windowShopSales = 0;
  let windowAds = 0;
  let windowCourier = 0;

  for (const w of window) {
    sumSkuSales += w.sales;
    sumCogs += unit * w.sold;
    windowShopSales += w.shopSales;
    windowAds += w.ads;
    windowCourier += w.courier;
  }

  const salesShare =
    windowShopSales > 0 ? sumSkuSales / windowShopSales : 0;
  const allocatedShared = salesShare * (windowAds + windowCourier);
  const netTotal = sumSkuSales - sumCogs - allocatedShared;
  const weeks = window.length;
  const avgWeeklyNet = weeks > 0 ? netTotal / weeks : 0;
  const estimatedAfter =
    sumSkuSales > 0 ? netTotal / sumSkuSales : null;
  const marginsPass =
    estimatedAfter != null && estimatedAfter >= MARGIN_AFTER_ADS_MIN;

  if (avgWeeklyNet > 0 && marginsPass) return "reinvest";
  if (avgWeeklyNet > 0 && !marginsPass) return "fix_economics";
  return "hold";
}
