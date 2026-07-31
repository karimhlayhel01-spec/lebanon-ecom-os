import { asc, eq } from "drizzle-orm";
import { db, ensureMigrated, schema } from "@/db";
import { newId, nowIso } from "@/lib/ids";
import {
  INVEST_NEXT_MIN_WEEKS,
  MARGIN_AFTER_ADS_MIN,
  MARGIN_BEFORE_ADS_MIN,
  TOPIC_A_RECENT_WEEKS,
} from "@/lib/constants";
import { createApprovalRequest, decideApproval } from "@/lib/approvals/engine";
import { getJourney } from "@/lib/memory/repos";
import {
  getSkuView,
  getSkuViewById,
  type SkuCardView,
} from "@/lib/sku/service";
import {
  getSkuJourney,
  listLiveSkus,
  resolveActiveSkuId,
} from "@/lib/sku/journey";
import {
  computeSkuContributionBreakdown,
  computeWeekSkuContribution,
  type SkuContributionBreakdown,
  type WeekSkuContribution,
} from "@/lib/finance/sku-contribution";

export type {
  SkuContributionBreakdown,
  SkuContributionRow,
  WeekSkuContribution,
  WeekSkuContributionRow,
} from "@/lib/finance/sku-contribution";

/**
 * Topic A + Finance panel.
 *
 * Topic A is the weekly money-coaching loop. Before the founder marks "selling"
 * we only show a PREVIEW (illustrative, clearly labelled) — real advice starts
 * once selling is marked (via the `mark_selling` gate).
 *
 * Mode C (Wave 1 multi-SKU): shop-level ads/COD/courier + per-SKU sales/units.
 * Roll-up sums sales and COGS across SKUs; health/invest-next use the roll-up.
 * `mode: live` when ANY live SKU is selling. Topic A history is kept when SKUs
 * are later archived (COGS bases still resolve from archived cards).
 *
 * ACTUAL margins are computed automatically from the founder's real weekly Topic
 * A inputs (no manual "reported margin" typing). Every after-ads surface (this
 * panel, week rows, invest-next, and the SKU mirror) reads the SAME pure helpers
 * below so they can never drift. Invest-next unlocks after 4 weeks of entries.
 */

export type WeeklyInput = {
  weekStart: string;
  sales: number;
  orders: number;
  metaSpend: number;
  tiktokSpend: number;
  codCollected: number;
  codOutstanding: number;
  courierFees: number;
  skuSold: number;
  skuLeft: number;
  /** Present when entry used multi-SKU mode C shape. */
  skuLines?: SkuWeekLine[];
};

/** Per-SKU sales/units line inside Topic A `perSkuSoldLeft` JSON. */
export type SkuWeekLine = {
  skuId: string;
  sold: number;
  left: number;
  sales: number;
};

export type SkuCostLine = SkuWeekLine & {
  importCogsPerUnit: number;
  usesQuotes: boolean;
};

export type WeeklyHealth = {
  netProfit: number;
  adSpend: number;
  cogs: number;
  grossProfit: number;
  outstandingRatio: number;
  verdict: "healthy" | "watch" | "risk";
  reasons: string[]; // note keys with "@"
};

/** Actual margins for a single week (from real Topic A inputs). */
export type WeeklyMargins = {
  before: number | null; // (sales − importCogs − courier) / sales
  after: number | null; // before minus meta + tiktok ad spend
  importCogsTotal: number; // importCogsPerUnit × skuSold
  adSpend: number; // meta + tiktok
  adPerUnit: number | null; // adSpend / skuSold
  belowBefore: boolean; // before computed and < 70%
  belowAfter: boolean; // after computed and < 35%
  usesQuotes: boolean; // COGS basis = founder quotes vs Discovery estimate
};

export type WeeklyEntryView = WeeklyInput & {
  id: string;
  health: WeeklyHealth;
  margins: WeeklyMargins;
  /**
   * Per-week Mode C SKU split (read-only). Null when no skuLines.
   * Does not alter shop combined health/margins on the card.
   */
  weekSkuSplit: WeekSkuContribution | null;
};

export type InvestNextView = {
  weeks: number;
  totalNet: number;
  avgWeeklyNet: number;
  marginsPass: boolean;
  recommendation: "reinvest" | "hold" | "fix_economics";
  reasons: string[];
  confidence: number;
};

/** Rolling "current actual" margins (dollar-aggregate, prefer last 4 weeks). */
export type CurrentActualView = {
  before: number | null;
  after: number | null;
  weeks: number; // weeks in the rolling window
  usableWeeks: number; // weeks with sales>0 && skuSold>0
  usesQuotes: boolean;
  importCogsPerUnit: number;
  netTotal: number;
  belowBefore: boolean;
  belowAfter: boolean;
  minBefore: number;
  minAfter: number;
  // Aggregate building blocks for the "How we calculated this" breakdown. These
  // are the SAME dollar sums used to derive `before`/`after` above — the UI only
  // renders them, it never recomputes margins with a different method.
  sumSales: number;
  /** Per-week sales in the rolling window (same order as the aggregate). Sum ≡ sumSales. */
  salesByWeek: Array<{ weekStart: string; sales: number }>;
  sumImportCogs: number; // importCogsPerUnit × units sold, over the window
  sumCourier: number; // actual Topic A courier fees over the window
  sumMeta: number;
  sumTiktok: number;
  unitsSold: number;
  profitBeforeAds: number; // sumSales − sumImportCogs − sumCourier
  profitAfterAds: number; // profitBeforeAds − (sumMeta + sumTiktok) === netTotal
};

export type SellableSku = {
  id: string;
  name: string;
};

export type FinancePanelView = {
  mode: "preview" | "live";
  canStartSelling: boolean;
  /** Live SKUs at batch_arrived_ready that can be marked selling. */
  sellableSkus: SellableSku[];
  /** All live (non-archived) SKUs — Mode C Topic A when length ≥ 2. */
  liveSkus: SellableSku[];
  /** Live SKUs currently in selling. */
  liveSellingSkus: SellableSku[];
  /** Full Topic A week count (gates / invest-next unlock). */
  weekCount: number;
  investNextMinWeeks: number;
  /**
   * Newest {@link TOPIC_A_RECENT_WEEKS} weeks only (oldest→newest within that
   * window). Older weeks are on `/finance/history`.
   */
  entries: WeeklyEntryView[];
  /** Weeks older than the main panel window (full DB − recent). */
  olderWeekCount: number;
  investNext: InvestNextView | null;
  previewSample: WeeklyEntryView | null;
  landedCost: number;
  sellPrice: number;
  planningMarginAfter: number; // Discovery estimate (muted)
  expectedMarginBefore: number | null; // founder cost quotes, if saved
  currentActual: CurrentActualView;
  /**
   * Secondary read-only Mode C breakdown. Null when <2 SKUs in the split
   * window or no weeks with skuLines. Never replaces shop Topic A.
   */
  skuContribution: SkuContributionBreakdown | null;
};

/**
 * Split Topic A rows (oldest→newest) into main-panel recent vs history.
 * Display-only — callers must still run gates on the full list.
 */
export function partitionTopicAEntries<T>(
  entriesOldestFirst: readonly T[],
  recentLimit: number = TOPIC_A_RECENT_WEEKS,
): { recent: T[]; older: T[] } {
  const limit = Math.max(0, Math.floor(recentLimit));
  if (entriesOldestFirst.length <= limit) {
    return { recent: [...entriesOldestFirst], older: [] };
  }
  const cut = entriesOldestFirst.length - limit;
  return {
    older: entriesOldestFirst.slice(0, cut) as T[],
    recent: entriesOldestFirst.slice(cut) as T[],
  };
}

// ---------------------------------------------------------------------------
// Shared pure margin helpers — the SINGLE source of truth for actual margins.
// Used by the Finance panel, week rows, invest-next, and the SKU mirror.
// ---------------------------------------------------------------------------

/**
 * Unit COGS for Finance (NEVER last-mile courier).
 * Import = product + intlShip + clearance; Local quotes store delivery/packaging
 * in the intlShip/clearanceTaxes slots (plus optional explicit fields).
 */
export type CostBasis = { importCogsPerUnit: number; usesQuotes: boolean };

/** Prefer founder cost quotes when saved; else Discovery planning moneySnapshot. */
export function costBasisForSku(sku: SkuCardView): CostBasis {
  if (sku.quotedCosts) {
    const q = sku.quotedCosts;
    // Local: prefer explicit legs when present; else mapped import-shaped slots.
    const freightOrDelivery =
      q.source === "local" && typeof q.supplierDelivery === "number"
        ? q.supplierDelivery
        : q.intlShip;
    const clearanceOrPackaging =
      q.source === "local" && typeof q.packaging === "number"
        ? q.packaging
        : q.clearanceTaxes;
    return {
      importCogsPerUnit:
        q.productCost + freightOrDelivery + clearanceOrPackaging,
      usesQuotes: true,
    };
  }
  return {
    importCogsPerUnit:
      sku.moneySnapshot.productCost +
      sku.moneySnapshot.intlShip +
      sku.moneySnapshot.clearanceTaxes,
    usesQuotes: false,
  };
}

/**
 * Multi-SKU Topic A roll-up (Mode C):
 *   sales = Σ sales_i
 *   COGS  = Σ (importCogsPerUnit_i × sold_i)
 * Blended basis keeps single-basis helpers working for health/margins.
 */
export function rollUpMultiSkuWeek(lines: SkuCostLine[]): {
  sales: number;
  skuSold: number;
  skuLeft: number;
  importCogsTotal: number;
  blendedBasis: CostBasis;
} {
  const sales = lines.reduce((s, l) => s + Math.max(l.sales, 0), 0);
  const skuSold = lines.reduce((s, l) => s + Math.max(l.sold, 0), 0);
  const skuLeft = lines.reduce((s, l) => s + Math.max(l.left, 0), 0);
  const importCogsTotal = lines.reduce(
    (s, l) => s + l.importCogsPerUnit * Math.max(l.sold, 0),
    0,
  );
  const usesQuotes = lines.some((l) => l.usesQuotes);
  return {
    sales,
    skuSold,
    skuLeft,
    importCogsTotal,
    blendedBasis: {
      importCogsPerUnit: skuSold > 0 ? importCogsTotal / skuSold : 0,
      usesQuotes,
    },
  };
}

/**
 * Parse `per_sku_sold_left` JSON.
 * Legacy: `{ orders, sku: { sold, left } }` or `{ orders, sold, left }`
 * Mode C: `{ orders, skus: { [skuId]: { sold, left, sales } } }`
 */
export function parsePerSkuSoldLeft(raw: string): {
  orders: number;
  skuSold: number;
  skuLeft: number;
  skus: Record<string, { sold: number; left: number; sales: number }>;
} {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const orders = Number(parsed.orders ?? 0);
    if (parsed.skus && typeof parsed.skus === "object") {
      const skus: Record<string, { sold: number; left: number; sales: number }> =
        {};
      let skuSold = 0;
      let skuLeft = 0;
      for (const [id, v] of Object.entries(
        parsed.skus as Record<
          string,
          { sold?: number; left?: number; sales?: number }
        >,
      )) {
        const sold = Number(v?.sold ?? 0);
        const left = Number(v?.left ?? 0);
        const sales = Number(v?.sales ?? 0);
        skus[id] = { sold, left, sales };
        skuSold += sold;
        skuLeft += left;
      }
      return { orders, skuSold, skuLeft, skus };
    }
    const legacySku =
      parsed.sku && typeof parsed.sku === "object"
        ? (parsed.sku as { sold?: number; left?: number })
        : null;
    return {
      orders,
      skuSold: Number(legacySku?.sold ?? parsed.sold ?? 0),
      skuLeft: Number(legacySku?.left ?? parsed.left ?? 0),
      skus: {},
    };
  } catch {
    return { orders: 0, skuSold: 0, skuLeft: 0, skus: {} };
  }
}

export function serializePerSkuSoldLeft(input: {
  orders: number;
  skuSold?: number;
  skuLeft?: number;
  skus?: Record<string, { sold: number; left: number; sales: number }>;
}): string {
  if (input.skus && Object.keys(input.skus).length > 0) {
    return JSON.stringify({ orders: input.orders, skus: input.skus });
  }
  return JSON.stringify({
    orders: input.orders,
    sku: { sold: input.skuSold ?? 0, left: input.skuLeft ?? 0 },
  });
}

/**
 * Shared week economics — ONE path for health net and actual margins.
 *   import COGS = importCogsPerUnit × skuSold  (never includes local courier)
 *   net = sales − import COGS − courierFees − (meta + tiktok)
 */
export function computeWeekEconomics(
  input: WeeklyInput,
  basis: CostBasis,
): {
  adSpend: number;
  importCogsTotal: number;
  grossProfit: number;
  netProfit: number;
} {
  const adSpend = input.metaSpend + input.tiktokSpend;
  const importCogsTotal = basis.importCogsPerUnit * Math.max(input.skuSold, 0);
  const grossProfit = input.sales - importCogsTotal;
  const netProfit =
    input.sales - importCogsTotal - input.courierFees - adSpend;
  return { adSpend, importCogsTotal, grossProfit, netProfit };
}

/**
 * Actual weekly margins from real inputs. Uses skuSold for COGS units (not
 * orders). Returns null margins when sales<=0 or skuSold<=0 — never fake 0%.
 */
export function computeWeeklyMargins(
  input: WeeklyInput,
  basis: CostBasis,
): WeeklyMargins {
  const { adSpend, importCogsTotal, netProfit } = computeWeekEconomics(
    input,
    basis,
  );
  const adPerUnit = input.skuSold > 0 ? adSpend / input.skuSold : null;

  if (input.sales <= 0 || input.skuSold <= 0) {
    return {
      before: null,
      after: null,
      importCogsTotal,
      adSpend,
      adPerUnit,
      belowBefore: false,
      belowAfter: false,
      usesQuotes: basis.usesQuotes,
    };
  }

  const before =
    (input.sales - importCogsTotal - input.courierFees) / input.sales;
  const after = netProfit / input.sales;

  return {
    before,
    after,
    importCogsTotal,
    adSpend,
    adPerUnit,
    belowBefore: before < MARGIN_BEFORE_ADS_MIN,
    belowAfter: after < MARGIN_AFTER_ADS_MIN,
    usesQuotes: basis.usesQuotes,
  };
}

/**
 * Rolling current actual using DOLLAR aggregates (never average of weekly %):
 *   (Σsales − Σimport COGS − Σcourier − Σads) / Σsales
 * Window = last 4 usable weeks when ≥4 exist, else all usable weeks.
 */
export function computeCurrentActual(
  entries: WeeklyInput[],
  basis: CostBasis,
): CurrentActualView {
  const usable = entries.filter((e) => e.sales > 0 && e.skuSold > 0);
  const window =
    usable.length >= INVEST_NEXT_MIN_WEEKS
      ? usable.slice(-INVEST_NEXT_MIN_WEEKS)
      : usable;

  const sumSales = window.reduce((s, e) => s + e.sales, 0);
  const salesByWeek = window.map((e) => ({
    weekStart: e.weekStart,
    sales: e.sales,
  }));
  const sumCogs = window.reduce(
    (s, e) => s + basis.importCogsPerUnit * e.skuSold,
    0,
  );
  const sumCourier = window.reduce((s, e) => s + e.courierFees, 0);
  const sumMeta = window.reduce((s, e) => s + e.metaSpend, 0);
  const sumTiktok = window.reduce((s, e) => s + e.tiktokSpend, 0);
  const sumAds = sumMeta + sumTiktok;
  const unitsSold = window.reduce((s, e) => s + e.skuSold, 0);

  const profitBeforeAds = sumSales - sumCogs - sumCourier;
  const profitAfterAds = profitBeforeAds - sumAds;

  const hasData = window.length > 0 && sumSales > 0;
  const before = hasData ? profitBeforeAds / sumSales : null;
  const after = hasData ? profitAfterAds / sumSales : null;

  return {
    before,
    after,
    weeks: window.length,
    usableWeeks: usable.length,
    usesQuotes: basis.usesQuotes,
    importCogsPerUnit: basis.importCogsPerUnit,
    netTotal: profitAfterAds,
    belowBefore: before != null && before < MARGIN_BEFORE_ADS_MIN,
    belowAfter: after != null && after < MARGIN_AFTER_ADS_MIN,
    minBefore: MARGIN_BEFORE_ADS_MIN,
    minAfter: MARGIN_AFTER_ADS_MIN,
    sumSales,
    salesByWeek,
    sumImportCogs: sumCogs,
    sumCourier,
    sumMeta,
    sumTiktok,
    unitsSold,
    profitBeforeAds,
    profitAfterAds,
  };
}

/**
 * Weekly health uses the same CostBasis / import-COGS path as actual margins
 * (Fix #14). Courier is Topic A `courierFees` only — never baked into unit COGS.
 */
export function computeHealth(
  input: WeeklyInput,
  basis: CostBasis,
): WeeklyHealth {
  const { adSpend, importCogsTotal, grossProfit, netProfit } =
    computeWeekEconomics(input, basis);
  const codTotal = input.codCollected + input.codOutstanding;
  const outstandingRatio = codTotal > 0 ? input.codOutstanding / codTotal : 0;

  const reasons: string[] = [];
  let verdict: WeeklyHealth["verdict"] = "healthy";

  if (netProfit < 0) {
    verdict = "risk";
    reasons.push("@health.negativeNet");
  }
  if (adSpend > 0 && input.sales / adSpend < 2) {
    if (verdict !== "risk") verdict = "watch";
    reasons.push("@health.lowRoas");
  }
  if (outstandingRatio > 0.4) {
    if (verdict !== "risk") verdict = "watch";
    reasons.push("@health.highOutstanding");
  }
  if (verdict === "healthy") {
    reasons.push("@health.healthy");
  }

  return {
    netProfit: Math.round(netProfit),
    adSpend: Math.round(adSpend),
    cogs: Math.round(importCogsTotal),
    grossProfit: Math.round(grossProfit),
    outstandingRatio,
    verdict,
    reasons,
  };
}

function parseEntry(row: typeof schema.topicAEntries.$inferSelect): WeeklyInput {
  const parsed = parsePerSkuSoldLeft(row.perSkuSoldLeft);
  const skuLines = Object.entries(parsed.skus).map(([skuId, v]) => ({
    skuId,
    sold: v.sold,
    left: v.left,
    sales: v.sales,
  }));
  return {
    weekStart: row.weekStart,
    // Mode C: prefer sum of per-SKU sales when present; else store totals.
    sales:
      skuLines.length > 0
        ? skuLines.reduce((s, l) => s + l.sales, 0)
        : row.storeTotalsUsd,
    orders: parsed.orders,
    metaSpend: row.metaSpend,
    tiktokSpend: row.tiktokSpend,
    codCollected: row.codCollected,
    codOutstanding: row.codOutstanding,
    courierFees: row.courierFees,
    skuSold: parsed.skuSold,
    skuLeft: parsed.skuLeft,
    skuLines: skuLines.length > 0 ? skuLines : undefined,
  };
}

const SAMPLE_PREVIEW: WeeklyInput = {
  weekStart: "preview",
  sales: 900,
  orders: 30,
  metaSpend: 120,
  tiktokSpend: 60,
  codCollected: 700,
  codOutstanding: 200,
  courierFees: 90,
  skuSold: 30,
  skuLeft: 70,
};

async function loadBasisMap(
  workspaceId: string,
  skuIds: string[],
): Promise<Map<string, CostBasis>> {
  const map = new Map<string, CostBasis>();
  for (const id of skuIds) {
    const view = await getSkuViewById(workspaceId, id);
    if (view) map.set(id, costBasisForSku(view));
  }
  return map;
}

function basisForEntry(
  input: WeeklyInput,
  fallback: CostBasis,
  basisBySku: Map<string, CostBasis>,
): CostBasis {
  if (!input.skuLines || input.skuLines.length === 0) return fallback;
  const costLines: SkuCostLine[] = input.skuLines.map((l) => {
    const b = basisBySku.get(l.skuId) ?? fallback;
    return {
      ...l,
      importCogsPerUnit: b.importCogsPerUnit,
      usesQuotes: b.usesQuotes,
    };
  });
  return rollUpMultiSkuWeek(costLines).blendedBasis;
}

export async function getFinancePanel(
  workspaceId: string,
): Promise<FinancePanelView | null> {
  ensureMigrated();
  const live = await listLiveSkus(workspaceId);
  if (live.length === 0) return null;

  const sku = await getSkuView(workspaceId);
  if (!sku) return null;

  const [journey, side, rows, journeys] = await Promise.all([
    getJourney(workspaceId),
    db
      .select()
      .from(schema.sideStatuses)
      .where(eq(schema.sideStatuses.workspaceId, workspaceId))
      .get(),
    db
      .select()
      .from(schema.topicAEntries)
      .where(eq(schema.topicAEntries.workspaceId, workspaceId))
      .orderBy(asc(schema.topicAEntries.weekStart))
      .all(),
    db
      .select()
      .from(schema.skuJourneys)
      .where(eq(schema.skuJourneys.workspaceId, workspaceId))
      .all(),
  ]);

  const journeyBySku = new Map(journeys.map((j) => [j.skuId, j]));
  const anySelling = live.some(
    (s) => journeyBySku.get(s.id)?.primaryState === "selling",
  );
  const sellableSkus: SellableSku[] = live
    .filter((s) => {
      const j = journeyBySku.get(s.id);
      return (
        j?.primaryState === "batch_arrived_ready" &&
        (j.batchArrivedReady || side?.batchArrivedReady)
      );
    })
    .map((s) => ({ id: s.id, name: s.name }));
  const liveSellingSkus: SellableSku[] = live
    .filter((s) => journeyBySku.get(s.id)?.primaryState === "selling")
    .map((s) => ({ id: s.id, name: s.name }));
  const liveSkus: SellableSku[] = live.map((s) => ({ id: s.id, name: s.name }));

  // Legacy workspace-level canStartSelling still true when active SKU is ready.
  const activeCanStart =
    journey?.primaryState === "batch_arrived_ready" &&
    (side?.batchArrivedReady ?? true);

  const fallbackBasis = costBasisForSku(sku);
  const allSkuIds = new Set<string>([sku.id]);
  for (const s of live) allSkuIds.add(s.id);
  for (const r of rows) {
    const parsed = parsePerSkuSoldLeft(r.perSkuSoldLeft);
    for (const id of Object.keys(parsed.skus)) allSkuIds.add(id);
  }
  const basisBySku = await loadBasisMap(workspaceId, [...allSkuIds]);

  const skuNames = new Map<string, string>();
  for (const s of live) skuNames.set(s.id, s.name);

  const allEntries: WeeklyEntryView[] = rows.map((r) => {
    const input = parseEntry(r);
    const basis = basisForEntry(input, fallbackBasis, basisBySku);
    return {
      id: r.id,
      ...input,
      health: computeHealth(input, basis),
      margins: computeWeeklyMargins(input, basis),
      weekSkuSplit: computeWeekSkuContribution({
        skuLines: input.skuLines,
        basisBySku,
        skuNames,
      }),
    };
  });

  const weekCount = allEntries.length;
  const { recent: entries, older } = partitionTopicAEntries(allEntries);
  const olderWeekCount = older.length;

  // Blended rolling basis: prefer dollar-weighted from multi-SKU weeks when present.
  // Uses FULL history — not the display window.
  const rollingBasis = (() => {
    const multi = allEntries.filter((e) => e.skuLines && e.skuLines.length > 0);
    if (multi.length === 0) return fallbackBasis;
    const costLines: SkuCostLine[] = [];
    for (const e of multi.slice(-INVEST_NEXT_MIN_WEEKS)) {
      for (const l of e.skuLines ?? []) {
        const b = basisBySku.get(l.skuId) ?? fallbackBasis;
        costLines.push({
          ...l,
          importCogsPerUnit: b.importCogsPerUnit,
          usesQuotes: b.usesQuotes,
        });
      }
    }
    return rollUpMultiSkuWeek(costLines).blendedBasis;
  })();

  const currentActual = computeCurrentActual(allEntries, rollingBasis);
  const investNext =
    anySelling && weekCount >= INVEST_NEXT_MIN_WEEKS
      ? computeInvestNext(currentActual)
      : null;

  // Secondary Mode C breakdown when 2+ live (same gate as Topic A form).
  const skuContribution =
    liveSkus.length >= 2
      ? computeSkuContributionBreakdown({
          entries: allEntries,
          basisBySku,
          skuNames,
        })
      : null;

  const previewSample: WeeklyEntryView = {
    id: "preview",
    ...SAMPLE_PREVIEW,
    health: computeHealth(SAMPLE_PREVIEW, fallbackBasis),
    margins: computeWeeklyMargins(SAMPLE_PREVIEW, fallbackBasis),
    weekSkuSplit: null,
  };

  return {
    mode: anySelling ? "live" : "preview",
    canStartSelling: sellableSkus.length > 0 || activeCanStart,
    sellableSkus:
      sellableSkus.length > 0
        ? sellableSkus
        : activeCanStart
          ? [{ id: sku.id, name: sku.name }]
          : [],
    liveSkus,
    liveSellingSkus,
    weekCount,
    investNextMinWeeks: INVEST_NEXT_MIN_WEEKS,
    entries,
    olderWeekCount,
    investNext,
    previewSample: anySelling ? null : previewSample,
    landedCost: sku.moneySnapshot.landedCost,
    sellPrice: sku.moneySnapshot.sellPrice,
    planningMarginAfter: sku.moneySnapshot.marginAfter,
    expectedMarginBefore: sku.quotedCosts?.expectedMarginBefore ?? null,
    currentActual,
    skuContribution,
  };
}

/**
 * Older Topic A weeks for `/finance/history` (everything before the recent window).
 * Newest-first display is the page’s job; return is oldest→newest.
 */
export async function getTopicAHistoryEntries(
  workspaceId: string,
): Promise<{
  entries: WeeklyEntryView[];
  olderWeekCount: number;
  totalWeekCount: number;
  recentLimit: number;
} | null> {
  ensureMigrated();
  const live = await listLiveSkus(workspaceId);
  if (live.length === 0) return null;
  const sku = await getSkuView(workspaceId);
  if (!sku) return null;

  const rows = await db
    .select()
    .from(schema.topicAEntries)
    .where(eq(schema.topicAEntries.workspaceId, workspaceId))
    .orderBy(asc(schema.topicAEntries.weekStart))
    .all();

  const fallbackBasis = costBasisForSku(sku);
  const allSkuIds = new Set<string>([sku.id]);
  for (const s of live) allSkuIds.add(s.id);
  for (const r of rows) {
    const parsed = parsePerSkuSoldLeft(r.perSkuSoldLeft);
    for (const id of Object.keys(parsed.skus)) allSkuIds.add(id);
  }
  const basisBySku = await loadBasisMap(workspaceId, [...allSkuIds]);
  const skuNames = new Map<string, string>();
  for (const s of live) skuNames.set(s.id, s.name);

  const allEntries: WeeklyEntryView[] = rows.map((r) => {
    const input = parseEntry(r);
    const basis = basisForEntry(input, fallbackBasis, basisBySku);
    return {
      id: r.id,
      ...input,
      health: computeHealth(input, basis),
      margins: computeWeeklyMargins(input, basis),
      weekSkuSplit: computeWeekSkuContribution({
        skuLines: input.skuLines,
        basisBySku,
        skuNames,
      }),
    };
  });

  const { older } = partitionTopicAEntries(allEntries);
  return {
    entries: older,
    olderWeekCount: older.length,
    totalWeekCount: allEntries.length,
    recentLimit: TOPIC_A_RECENT_WEEKS,
  };
}

/**
 * Rolling current actual margins for the active SKU — the SAME helper the Finance
 * panel uses, exposed for read-only mirrors (SKU sheet, dashboard CompactSku) so
 * they can never disagree with Finance. Returns null when there is no active SKU.
 */
export async function getCurrentActual(
  workspaceId: string,
): Promise<CurrentActualView | null> {
  ensureMigrated();
  const panel = await getFinancePanel(workspaceId);
  return panel?.currentActual ?? null;
}

/**
 * Invest-next now reads ACTUAL rolling economics (after-ads margin + actual net)
 * instead of the Discovery marketing estimate. Structure/UI unchanged.
 */
function computeInvestNext(actual: CurrentActualView): InvestNextView {
  const weeks = actual.weeks;
  const totalNet = Math.round(actual.netTotal);
  const avgWeeklyNet = weeks > 0 ? Math.round(actual.netTotal / weeks) : 0;
  const marginsPass =
    actual.after != null && actual.after >= MARGIN_AFTER_ADS_MIN;

  const reasons: string[] = [];
  let recommendation: InvestNextView["recommendation"];
  if (avgWeeklyNet > 0 && marginsPass) {
    recommendation = "reinvest";
    reasons.push("@invest.profitable", "@invest.marginsPass");
  } else if (avgWeeklyNet > 0 && !marginsPass) {
    recommendation = "fix_economics";
    reasons.push("@invest.marginsWeak");
  } else {
    recommendation = "hold";
    reasons.push("@invest.notProfitable");
  }

  const confidence = Math.min(
    0.9,
    0.4 + weeks * 0.1 + (avgWeeklyNet > 0 ? 0.2 : 0),
  );

  return {
    weeks,
    totalNet,
    avgWeeklyNet,
    marginsPass,
    recommendation,
    reasons,
    confidence,
  };
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export async function canStartSellingForSku(
  workspaceId: string,
  skuId: string,
): Promise<boolean> {
  ensureMigrated();
  const journey = await getSkuJourney(skuId);
  if (!journey || journey.workspaceId !== workspaceId) return false;
  return (
    journey.primaryState === "batch_arrived_ready" && journey.batchArrivedReady
  );
}

export async function startSelling(
  workspaceId: string,
  skuId?: string,
): Promise<{ ok: boolean; error?: string }> {
  ensureMigrated();
  const resolvedSkuId = skuId ?? (await resolveActiveSkuId(workspaceId));
  if (!resolvedSkuId) return { ok: false, error: "not_found" };

  const journey = await getSkuJourney(resolvedSkuId);
  if (!journey || journey.primaryState !== "batch_arrived_ready") {
    // Fallback: legacy workspace journey for single-SKU workspaces mid-migration.
    if (!skuId) {
      const wsJourney = await getJourney(workspaceId);
      if (!wsJourney || wsJourney.primaryState !== "batch_arrived_ready") {
        return { ok: false, error: "not_ready" };
      }
    } else {
      return { ok: false, error: "not_ready" };
    }
  }

  const approval = await createApprovalRequest(workspaceId, "mark_selling", {
    data: {},
    skuId: resolvedSkuId,
  });
  if (!approval) return { ok: false, error: "error" };
  const decided = await decideApproval(approval.id, {
    type: "approve",
    acknowledgements: [],
  });
  if (!decided.ok) return { ok: false, error: "error" };

  await db.insert(schema.orchestratorEvents).values({
    id: newId(),
    workspaceId,
    kind: "mark_selling",
    message: "Marked selling — Topic A advice is now live",
    meta: JSON.stringify({ skuId: resolvedSkuId }),
    createdAt: nowIso(),
  });
  return { ok: true };
}

export type AddWeeklyEntryInput = WeeklyInput & {
  /** Mode C: per-SKU lines. When set, sales/skuSold/skuLeft are derived. */
  skuLines?: SkuWeekLine[];
};

export async function addWeeklyEntry(
  workspaceId: string,
  input: AddWeeklyEntryInput,
): Promise<{ ok: boolean; error?: string }> {
  ensureMigrated();
  const panel = await getFinancePanel(workspaceId);
  if (!panel || panel.mode !== "live") {
    return { ok: false, error: "not_selling" };
  }
  const sku = await getSkuView(workspaceId);
  if (!sku) return { ok: false, error: "not_found" };

  const live = await listLiveSkus(workspaceId);
  const multiLive = live.length >= 2;

  let sales = input.sales;
  let skuSold = input.skuSold;
  let skuLeft = input.skuLeft;
  let skusJson:
    | Record<string, { sold: number; left: number; sales: number }>
    | undefined;
  let basis = costBasisForSku(sku);
  let skuLines = input.skuLines;

  // 2+ live → always persist Mode C skus map (never legacy-only weeks).
  if (multiLive) {
    const byId = new Map(
      (skuLines ?? []).map((l) => [l.skuId, l] as const),
    );
    skuLines = live.map((s) => {
      const existing = byId.get(s.id);
      if (existing) {
        return {
          skuId: s.id,
          sold: Math.max(0, existing.sold),
          left: Math.max(0, existing.left),
          sales: Math.max(0, existing.sales),
        };
      }
      // Missing line: zeros (not-yet-selling) — except attribute legacy
      // single-field payload to the active SKU when no lines were posted.
      if ((!input.skuLines || input.skuLines.length === 0) && s.id === sku.id) {
        return {
          skuId: s.id,
          sold: Math.max(0, input.skuSold),
          left: Math.max(0, input.skuLeft),
          sales: Math.max(0, input.sales),
        };
      }
      return { skuId: s.id, sold: 0, left: 0, sales: 0 };
    });
  }

  if (skuLines && skuLines.length > 0) {
    const basisBySku = await loadBasisMap(
      workspaceId,
      skuLines.map((l) => l.skuId),
    );
    const costLines: SkuCostLine[] = skuLines.map((l) => {
      const b = basisBySku.get(l.skuId) ?? basis;
      return {
        ...l,
        importCogsPerUnit: b.importCogsPerUnit,
        usesQuotes: b.usesQuotes,
      };
    });
    const roll = rollUpMultiSkuWeek(costLines);
    sales = roll.sales;
    skuSold = roll.skuSold;
    skuLeft = roll.skuLeft;
    basis = roll.blendedBasis;
    skusJson = Object.fromEntries(
      skuLines.map((l) => [
        l.skuId,
        { sold: l.sold, left: l.left, sales: l.sales },
      ]),
    );
  }

  const weekInput: WeeklyInput = {
    ...input,
    sales,
    skuSold,
    skuLeft,
    skuLines,
  };

  const now = nowIso();
  await db.insert(schema.topicAEntries).values({
    id: newId(),
    workspaceId,
    weekStart: input.weekStart,
    storeTotalsUsd: sales,
    perSkuSoldLeft: serializePerSkuSoldLeft({
      orders: input.orders,
      skuSold,
      skuLeft,
      skus: skusJson,
    }),
    metaSpend: input.metaSpend,
    tiktokSpend: input.tiktokSpend,
    codCollected: input.codCollected,
    codOutstanding: input.codOutstanding,
    courierFees: input.courierFees,
    createdAt: now,
  });

  const health = computeHealth(weekInput, basis);
  await db.insert(schema.financeVerdicts).values({
    id: newId(),
    workspaceId,
    kind: "weekly_health",
    payload: JSON.stringify({ weekStart: input.weekStart, health }),
    confidence: 0.7,
    createdAt: now,
  });

  const side = await db
    .select({ topicAWeekCount: schema.sideStatuses.topicAWeekCount })
    .from(schema.sideStatuses)
    .where(eq(schema.sideStatuses.workspaceId, workspaceId))
    .get();
  await db
    .update(schema.sideStatuses)
    .set({
      topicAWeekCount: (side?.topicAWeekCount ?? 0) + 1,
      updatedAt: now,
    })
    .where(eq(schema.sideStatuses.workspaceId, workspaceId));

  return { ok: true };
}
