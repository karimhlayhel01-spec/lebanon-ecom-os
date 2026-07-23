import { asc, eq } from "drizzle-orm";
import { db, ensureMigrated, schema } from "@/db";
import { newId, nowIso } from "@/lib/ids";
import {
  INVEST_NEXT_MIN_WEEKS,
  MARGIN_AFTER_ADS_MIN,
  MARGIN_BEFORE_ADS_MIN,
} from "@/lib/constants";
import { createApprovalRequest, decideApproval } from "@/lib/approvals/engine";
import { getJourney } from "@/lib/memory/repos";
import { getSkuView, type SkuCardView } from "@/lib/sku/service";

/**
 * Topic A + Finance panel.
 *
 * Topic A is the weekly money-coaching loop. Before the founder marks "selling"
 * we only show a PREVIEW (illustrative, clearly labelled) — real advice starts
 * once selling is marked (via the `mark_selling` gate).
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

export type FinancePanelView = {
  mode: "preview" | "live";
  canStartSelling: boolean;
  weekCount: number;
  investNextMinWeeks: number;
  entries: WeeklyEntryView[];
  investNext: InvestNextView | null;
  previewSample: WeeklyEntryView | null;
  landedCost: number;
  sellPrice: number;
  planningMarginAfter: number; // Discovery estimate (muted)
  expectedMarginBefore: number | null; // founder cost quotes, if saved
  currentActual: CurrentActualView;
};

// ---------------------------------------------------------------------------
// Shared pure margin helpers — the SINGLE source of truth for actual margins.
// Used by the Finance panel, week rows, invest-next, and the SKU mirror.
// ---------------------------------------------------------------------------

/** Import COGS per unit = product unit + intl ship + clearance (NEVER local courier). */
export type CostBasis = { importCogsPerUnit: number; usesQuotes: boolean };

/** Prefer founder cost quotes when saved; else Discovery planning moneySnapshot. */
export function costBasisForSku(sku: SkuCardView): CostBasis {
  if (sku.quotedCosts) {
    return {
      importCogsPerUnit:
        sku.quotedCosts.productCost +
        sku.quotedCosts.intlShip +
        sku.quotedCosts.clearanceTaxes,
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
  let orders = 0;
  let skuSold = 0;
  let skuLeft = 0;
  try {
    const parsed = JSON.parse(row.perSkuSoldLeft);
    orders = Number(parsed.orders ?? 0);
    skuSold = Number(parsed.sku?.sold ?? parsed.sold ?? 0);
    skuLeft = Number(parsed.sku?.left ?? parsed.left ?? 0);
  } catch {
    /* ignore */
  }
  return {
    weekStart: row.weekStart,
    sales: row.storeTotalsUsd,
    orders,
    metaSpend: row.metaSpend,
    tiktokSpend: row.tiktokSpend,
    codCollected: row.codCollected,
    codOutstanding: row.codOutstanding,
    courierFees: row.courierFees,
    skuSold,
    skuLeft,
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

export async function getFinancePanel(
  workspaceId: string,
): Promise<FinancePanelView | null> {
  ensureMigrated();
  const sku = await getSkuView(workspaceId);
  if (!sku) return null;

  const [journey, side, rows] = await Promise.all([
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
  ]);

  const selling = journey?.primaryState === "selling";
  const landedCost = sku.moneySnapshot.landedCost;
  const basis = costBasisForSku(sku);

  const entries: WeeklyEntryView[] = rows.map((r) => {
    const input = parseEntry(r);
    return {
      id: r.id,
      ...input,
      health: computeHealth(input, basis),
      margins: computeWeeklyMargins(input, basis),
    };
  });

  const weekCount = entries.length;
  const currentActual = computeCurrentActual(entries, basis);
  const investNext =
    selling && weekCount >= INVEST_NEXT_MIN_WEEKS
      ? computeInvestNext(currentActual)
      : null;

  const previewSample: WeeklyEntryView = {
    id: "preview",
    ...SAMPLE_PREVIEW,
    health: computeHealth(SAMPLE_PREVIEW, basis),
    margins: computeWeeklyMargins(SAMPLE_PREVIEW, basis),
  };

  return {
    mode: selling ? "live" : "preview",
    canStartSelling:
      journey?.primaryState === "batch_arrived_ready" &&
      (side?.batchArrivedReady ?? true),
    weekCount,
    investNextMinWeeks: INVEST_NEXT_MIN_WEEKS,
    entries,
    investNext,
    previewSample: selling ? null : previewSample,
    landedCost,
    sellPrice: sku.moneySnapshot.sellPrice,
    planningMarginAfter: sku.moneySnapshot.marginAfter,
    expectedMarginBefore: sku.quotedCosts?.expectedMarginBefore ?? null,
    currentActual,
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
  const sku = await getSkuView(workspaceId);
  if (!sku) return null;
  const rows = await db
    .select()
    .from(schema.topicAEntries)
    .where(eq(schema.topicAEntries.workspaceId, workspaceId))
    .orderBy(asc(schema.topicAEntries.weekStart))
    .all();
  const entries = rows.map(parseEntry);
  return computeCurrentActual(entries, costBasisForSku(sku));
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

export async function startSelling(
  workspaceId: string,
): Promise<{ ok: boolean; error?: string }> {
  ensureMigrated();
  const journey = await getJourney(workspaceId);
  if (!journey || journey.primaryState !== "batch_arrived_ready") {
    return { ok: false, error: "not_ready" };
  }
  const approval = await createApprovalRequest(workspaceId, "mark_selling", {
    data: {},
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
    meta: "{}",
    createdAt: nowIso(),
  });
  return { ok: true };
}

export async function addWeeklyEntry(
  workspaceId: string,
  input: WeeklyInput,
): Promise<{ ok: boolean; error?: string }> {
  ensureMigrated();
  const journey = await getJourney(workspaceId);
  if (journey?.primaryState !== "selling") {
    return { ok: false, error: "not_selling" };
  }
  const sku = await getSkuView(workspaceId);
  if (!sku) return { ok: false, error: "not_found" };

  const now = nowIso();
  await db.insert(schema.topicAEntries).values({
    id: newId(),
    workspaceId,
    weekStart: input.weekStart,
    storeTotalsUsd: input.sales,
    perSkuSoldLeft: JSON.stringify({
      orders: input.orders,
      sku: { sold: input.skuSold, left: input.skuLeft },
    }),
    metaSpend: input.metaSpend,
    tiktokSpend: input.tiktokSpend,
    codCollected: input.codCollected,
    codOutstanding: input.codOutstanding,
    courierFees: input.courierFees,
    createdAt: now,
  });

  const health = computeHealth(input, costBasisForSku(sku));
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
