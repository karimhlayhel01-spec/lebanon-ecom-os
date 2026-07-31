import { and, asc, eq } from "drizzle-orm";
import { db, ensureMigrated, schema } from "@/db";
import { newId, nowIso } from "@/lib/ids";
import { BATCH_SOFT_WARNING_USD, CLEARANCE_PARTNER_TBD } from "@/lib/constants";
import { createApprovalRequest, decideApproval } from "@/lib/approvals/engine";
import { getJourney } from "@/lib/memory/repos";
import { computeMargin } from "@/lib/skills/margin";
import {
  getSkuView,
  getSkuViewById,
  type MoneySnapshotSection,
  type QuotedCostsSection,
} from "@/lib/sku/service";
import { generateKit } from "@/lib/marketing/service";
import { getSkuJourney, listLiveSkus, patchSkuJourneyFlags } from "@/lib/sku/journey";
import { resolveSupplierJourneyFlags } from "@/lib/supplier/flags";
import {
  canEditBatchArrivalEta,
  resolveBatchArrivalEta,
  resolvePanelScopedSkuId,
  toStoredEta,
  type BatchArrivalEtaView,
  type SetBatchArrivalEtaInput,
} from "@/lib/supplier/batch-eta";
import {
  bridgeCoachingForSource,
  canReorderWithSupplier,
  evaluateCrisisSampleSkip,
  listReorderBackupCandidates,
  markSupplierUnavailable,
  parseCrisisSkipIds,
  parseUnavailableSuppliers,
  planCancelReorderOrdered,
  serializeCrisisSkipIds,
  serializeUnavailableSuppliers,
  shouldCoachWarmBackup,
  type BackupCandidate,
  type CantFulfillReason,
  type UnavailableSuppliersMap,
} from "@/lib/supplier/reorder-escape";
import {
  computeRunwayForSkuFromEntries,
  resolveUnitsLeftGlance,
  type UnitsLeftGlance,
} from "@/lib/finance/sku-runway";
import { costBasisForSku } from "@/lib/finance/service";
import type { ExperienceLevel } from "@/lib/sku/add-sku-gate";
import { effectiveJourneyState } from "@/lib/sku/page-sections";
import {
  canEditReorderArrivalEta,
  canMarkReorderArrived,
  canMarkReorderOrdered,
  evaluateReorderEconomicsGate,
  normalizeReorderStatus,
  reorderInvestNextTone,
  type InvestNextTone,
  type ReorderStatus,
  type SkuRunwayView,
} from "@/lib/supplier/reorder";
import {
  resolveSkuInvestNextTone,
  topicAWeekFromRow,
} from "@/lib/supplier/reorder-economics";
import {
  buildPersistedQuotedCosts,
  costQuotesNeedRefresh,
  pathSwitchShouldStaleCostQuotes,
  resolveCostQuotesPrefill,
  toMarginInput,
  validateCostQuoteNumbers,
  type CostQuoteInput,
} from "@/lib/supplier/quotes";
import {
  canShowSupplierShortlist,
  groupSuppliersBySourceAndRank,
  normalizeSupplierSource,
  supplierGenerationPlan,
  type SupplierSource,
} from "@/lib/supplier/source";
import {
  canShowBackupInsurance,
  countInFlightSpareSamples,
  findFirstApprovedSample,
  findInFlightSample,
  listInFlightSamples,
  resolveWorkingPathSupplierId,
  sampleFlightGate,
  shouldPatchJourneySampleStatus,
} from "@/lib/supplier/sample-flight";
import { localPlanningLegs } from "@/lib/discovery/local-hint";

export type { CostQuoteInput } from "@/lib/supplier/quotes";
export type { SupplierSource, SupplierTabFilter } from "@/lib/supplier/source";
export {
  DEFAULT_SUPPLIER_TAB,
  canShowSupplierShortlist,
  isSourceTabFrozen,
} from "@/lib/supplier/source";

/** Dual-write SKU journey flags + legacy side_statuses for active SKU path. */
async function patchSkuSideFlags(
  workspaceId: string,
  skuId: string,
  patch: Parameters<typeof patchSkuJourneyFlags>[1] & {
    // also mirrored onto workspace side_statuses when this is the active SKU
  },
) {
  await patchSkuJourneyFlags(skuId, patch);
  const workspace = await db
    .select()
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId))
    .get();
  if (workspace?.activeSkuId !== skuId) return;

  const sidePatch: Record<string, unknown> = { updatedAt: nowIso() };
  if (patch.sampleStatus !== undefined) sidePatch.sampleStatus = patch.sampleStatus;
  if (patch.batchOrdered !== undefined) sidePatch.batchOrdered = patch.batchOrdered;
  if (patch.batchArrivedReady !== undefined)
    sidePatch.batchArrivedReady = patch.batchArrivedReady;
  if (patch.batchArrivalEta !== undefined)
    sidePatch.batchArrivalEta = patch.batchArrivalEta;
  if (patch.marketingStage !== undefined)
    sidePatch.marketingStage = patch.marketingStage;
  if (patch.costQuotesSaved !== undefined)
    sidePatch.costQuotesSaved = patch.costQuotesSaved;
  if (patch.cashLockAck !== undefined) sidePatch.cashLockAck = patch.cashLockAck;
  if (patch.stuckOver10kAck !== undefined)
    sidePatch.stuckOver10kAck = patch.stuckOver10kAck;

  await db
    .update(schema.sideStatuses)
    .set(sidePatch)
    .where(eq(schema.sideStatuses.workspaceId, workspaceId));
}

export type { BatchArrivalEtaView, SetBatchArrivalEtaInput };
export { canEditBatchArrivalEta };

/**
 * Supplier / Import service.
 *
 * Deterministically generates a supplier shortlist for the active SKU:
 * 3 primaries, each with 2 backups (9 total). Drives the sample-first flow
 * (request → receive → decide via the `sample_decision` gate) and the batch
 * order flow (via the `batch_ordered` gate). Ordering a batch never requires
 * store readiness. A soft warning + "stuck ladder" appears when an estimated
 * batch crosses the $10k threshold; lower-MOQ backups are offered as a path out.
 */

// ---------------------------------------------------------------------------
// Deterministic seeded generation
// ---------------------------------------------------------------------------

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CITY_POOL_IMPORT = [
  "Shenzhen",
  "Yiwu",
  "Guangzhou",
  "Ningbo",
  "Dongguan",
  "Hangzhou",
  "Foshan",
  "Xiamen",
  "Shantou",
];
const SUFFIX_POOL_IMPORT = [
  "Trading Co.",
  "Industrial Ltd.",
  "Import & Export",
  "Manufacturing",
  "Homeware Co.",
  "Tech Ltd.",
  "Global Sourcing",
  "Supplies Co.",
  "Commerce Ltd.",
];
const CITY_POOL_LOCAL = [
  "Beirut",
  "Tripoli",
  "Saida",
  "Zahle",
  "Jounieh",
  "Tyre",
  "Baalbek",
  "Byblos",
  "Nabatieh",
];
const SUFFIX_POOL_LOCAL = [
  "Trading",
  "Wholesale",
  "Distributors",
  "Supplies",
  "Commerce",
  "Market Co.",
  "Home Goods",
  "Retail Supply",
  "Import House",
];
const MOQ_LADDER = [50, 100, 150, 200, 300, 500];

type GenSupplier = {
  name: string;
  role: "primary" | "backup";
  rank: number;
  source: SupplierSource;
  years: number;
  rating: number;
  verified: boolean;
  moq: number;
  unitPrice: number;
  sampleReplies: boolean;
  negotiationDraft: string;
  paymentMapEstimate: string;
  redFlags: string[];
};

function paymentMap(unitPrice: number, moq: number) {
  return JSON.stringify({
    depositPct: 30,
    balancePct: 70,
    method: "Bank wire / trade-assurance escrow",
    estDeposit: Math.round(unitPrice * moq * 0.3),
    note: "@payment.depositNote",
  });
}

function emailDraftImport(
  productName: string,
  city: string,
  targetPrice: number,
  moq: number,
): string {
  return [
    `Subject: Sample request + quote — ${productName}`,
    ``,
    `Hello,`,
    ``,
    `We are a retailer in Lebanon preparing to launch ${productName}.`,
    `Before any bulk order we would like to buy ONE paid sample to verify`,
    `quality, packaging and function.`,
    ``,
    `Could you please confirm:`,
    `1) Sample price and lead time (we pay for the sample + shipping).`,
    `2) Unit price at MOQ ${moq} and at higher volumes.`,
    `3) Target unit price around $${targetPrice.toFixed(2)} — is it possible?`,
    `4) Payment terms (we prefer 30% deposit / 70% before shipping via escrow).`,
    `5) Total weight/volume for a ${moq}-unit box (for our freight quote to ${city} → Beirut).`,
    ``,
    `Thank you — we look forward to your reply.`,
  ].join("\n");
}

function emailDraftLocal(
  productName: string,
  city: string,
  targetPrice: number,
  moq: number,
): string {
  return [
    `Subject: Sample request + quote — ${productName}`,
    ``,
    `Hello,`,
    ``,
    `We are a retailer in Lebanon preparing to launch ${productName}.`,
    `Before any bulk order we would like to buy ONE paid sample to verify`,
    `quality, packaging and function.`,
    ``,
    `Could you please confirm:`,
    `1) Sample price and lead time (we pay for the sample).`,
    `2) Unit price at MOQ ${moq} and at higher volumes.`,
    `3) Target unit price around $${targetPrice.toFixed(2)} — is it possible?`,
    `4) Payment terms (we prefer deposit / balance before delivery).`,
    `5) Delivery or pickup options to our location in Lebanon from ${city}`,
    `   (no international freight or customs clearance needed).`,
    ``,
    `Thank you — we look forward to your reply.`,
  ].join("\n");
}

function generateSuppliersForSource(
  skuId: string,
  productName: string,
  money: MoneySnapshotSection,
  source: SupplierSource,
): GenSupplier[] {
  // Distinct seed per source so Import and Local pools don't collide.
  const rng = mulberry32(hashString(`${skuId}:${source}`));
  const baseUnit = Math.max(1, money.productCost || money.landedCost * 0.5);
  // Local stockists often sit slightly above factory FOB.
  const localMarkup = source === "local" ? 1.15 : 1;
  const cities = source === "local" ? CITY_POOL_LOCAL : CITY_POOL_IMPORT;
  const suffixes = source === "local" ? SUFFIX_POOL_LOCAL : SUFFIX_POOL_IMPORT;
  const suppliers: GenSupplier[] = [];

  for (let group = 0; group < 3; group++) {
    // 1 primary + 2 backups per group. Backups include a lower-MOQ alternative.
    const members: Array<{ role: "primary" | "backup"; moqIdx: number }> = [
      { role: "primary", moqIdx: 2 + group },
      { role: "backup", moqIdx: 0 }, // low-MOQ alternative
      { role: "backup", moqIdx: 3 + group },
    ];

    members.forEach((m) => {
      const city = cities[Math.floor(rng() * cities.length)];
      const suffix = suffixes[Math.floor(rng() * suffixes.length)];
      const isPrimary = m.role === "primary";
      const moq = MOQ_LADDER[Math.min(m.moqIdx, MOQ_LADDER.length - 1)];
      const priceJitter = 0.85 + rng() * 0.45;
      const unitPrice =
        Math.round(baseUnit * localMarkup * priceJitter * 100) / 100;
      const years = 2 + Math.floor(rng() * (isPrimary ? 8 : 6));
      const rating =
        Math.round((isPrimary ? 4.4 + rng() * 0.5 : 3.9 + rng() * 0.7) * 10) /
        10;
      const sampleReplies = isPrimary ? true : rng() > 0.25;
      const redFlags: string[] = [];
      if (!sampleReplies) redFlags.push("@flag.slowSample");
      if (years < 3) redFlags.push("@flag.newSupplier");
      if (rating < 4.2) redFlags.push("@flag.mixedReviews");

      suppliers.push({
        name: `${city} ${productName.split(" ")[0]} ${suffix}`,
        role: m.role,
        rank: group,
        source,
        years,
        rating: Math.min(5, rating),
        verified: isPrimary || rng() > 0.2,
        moq,
        unitPrice,
        sampleReplies,
        negotiationDraft:
          source === "local"
            ? emailDraftLocal(productName, city, baseUnit * localMarkup, moq)
            : emailDraftImport(productName, city, baseUnit, moq),
        paymentMapEstimate: paymentMap(unitPrice, moq),
        redFlags,
      });
    });
  }

  return suppliers;
}

function generateSuppliers(
  skuId: string,
  productName: string,
  money: MoneySnapshotSection,
  sources: SupplierSource[] = ["import", "local"],
): GenSupplier[] {
  return sources.flatMap((source) =>
    generateSuppliersForSource(skuId, productName, money, source),
  );
}

// ---------------------------------------------------------------------------
// Persistence + read model
// ---------------------------------------------------------------------------

const QUALITY_CHECKLIST_KEYS = [
  "matchesPhotos",
  "materialQuality",
  "functionsWork",
  "packagingIntact",
  "sizeWeight",
  "safetySmell",
  "arabicLabeling",
] as const;

function freshChecklist() {
  return JSON.stringify(
    Object.fromEntries(QUALITY_CHECKLIST_KEYS.map((k) => [k, false])),
  );
}

/** Generate the supplier shortlist once per SKU (idempotent + Wave 2 backfill). */
export async function ensureSuppliers(
  workspaceId: string,
  skuId?: string,
): Promise<void> {
  ensureMigrated();
  const sku = skuId
    ? await getSkuViewById(workspaceId, skuId)
    : await getSkuView(workspaceId);
  if (!sku) return;

  const existing = await db
    .select()
    .from(schema.supplierOptions)
    .where(eq(schema.supplierOptions.skuId, sku.id))
    .all();

  const sourcesPresent = [
    ...new Set(
      existing.map((r) =>
        normalizeSupplierSource(
          (r as { source?: string | null }).source,
        ),
      ),
    ),
  ];
  const plan = supplierGenerationPlan(sourcesPresent);
  if (!plan.generateImport && !plan.generateLocal) return;

  const toGenerate: SupplierSource[] = [];
  if (plan.generateImport) toGenerate.push("import");
  if (plan.generateLocal) toGenerate.push("local");

  const generated = generateSuppliers(
    sku.id,
    sku.name,
    sku.moneySnapshot,
    toGenerate,
  );
  const now = nowIso();
  await db.insert(schema.supplierOptions).values(
    generated.map((g) => ({
      id: newId(),
      workspaceId,
      skuId: sku.id,
      name: g.name,
      role: g.role,
      rank: g.rank,
      source: g.source,
      years: g.years,
      rating: g.rating,
      verified: g.verified,
      moq: g.moq,
      unitPrice: g.unitPrice,
      sampleReplies: g.sampleReplies,
      negotiationDraft: g.negotiationDraft,
      paymentMapEstimate: g.paymentMapEstimate,
      redFlags: JSON.stringify(g.redFlags),
      status: "available",
      createdAt: now,
    })),
  );
}

export type PaymentMapView = {
  depositPct: number;
  balancePct: number;
  method: string;
  estDeposit: number;
  note: string;
};

export type SupplierView = {
  id: string;
  name: string;
  role: "primary" | "backup";
  rank: number;
  source: SupplierSource;
  years: number;
  rating: number;
  verified: boolean;
  moq: number;
  unitPrice: number;
  sampleReplies: boolean;
  negotiationDraft: string;
  paymentMap: PaymentMapView;
  redFlags: string[];
  estBatchCost: number;
  overSoftLimit: boolean;
};

export type SupplierGroup = {
  source: SupplierSource;
  rank: number;
  primary: SupplierView | null;
  backups: SupplierView[];
};

export type SampleView = {
  id: string;
  supplierId: string;
  supplierName: string;
  supplierSource: SupplierSource;
  status: string;
  checklist: Record<string, boolean>;
  photoNotes: string;
  packingBrief: string;
};

export type CostQuotesView = {
  unlocked: boolean;
  saved: boolean;
  /**
   * True after a path switch cleared costQuotesSaved while prior quotedCosts
   * remain — founder should update quotes for the new working supplier.
   */
  needsRefresh: boolean;
  /** Quote form follows approved sample supplier source — not the tab. */
  quoteSource: SupplierSource;
  prefill: {
    productCost: number;
    intlShip: number;
    clearanceTaxes: number;
    supplierDelivery: number;
    packaging: number;
    localCourier: number;
    sellPrice: number;
  };
  quoted: QuotedCostsSection | null;
  planningMarginBefore: number;
  monthlyFollowOnBudget: number;
};

export type ReorderPanelView = {
  status: ReorderStatus;
  /** Primary effective state for this SKU (shop pause overlay applied). */
  primaryState: string;
  /** True when next-batch UI may appear (selling + first batch done). */
  available: boolean;
  canOrder: boolean;
  canMarkArrived: boolean;
  canEditEta: boolean;
  supplierId: string | null;
  supplierName: string | null;
  supplierSource: SupplierSource | null;
  qty: number | null;
  estCost: number | null;
  arrivalEta: BatchArrivalEtaView;
  runway: SkuRunwayView;
  /** Read-only units-left glance (same runway helper; never fake 0). */
  unitsLeftGlance: UnitsLeftGlance;
  investNextRecommendation: InvestNextTone | null;
  investTone: "strengthen" | "warn" | "neutral";
  experience: ExperienceLevel;
  economics: ReturnType<typeof evaluateReorderEconomicsGate>;
  /** Founder must tick when economics.warning === weak_economics. */
  needsEconomicsAck: boolean;
  /** Soft coach highlight when no warm backup yet (slice 2). */
  warmCoach: boolean;
  /** Insurance UI available after first approve (not gated on warmCoach). */
  insuranceAvailable: boolean;
  backups: BackupCandidate[];
  unavailable: UnavailableSuppliersMap;
  crisisSkipIds: string[];
  bridge: {
    holdAds: boolean;
    stretchStock: boolean;
    localBridge: boolean;
  } | null;
  /** True when a cold sample is in flight after can’t-fulfill. */
  coldSampleInFlight: boolean;
  exhaustedBackups: boolean;
};

export type SupplierPanelView = {
  skuId: string;
  groups: SupplierGroup[];
  /**
   * Newest in-flight sample (`requested` | `received`) for compat.
   * Prefer `samples` when rendering trackers.
   */
  sample: SampleView | null;
  /** All in-flight samples (oldest→newest). Approved never included. */
  samples: SampleView[];
  /**
   * Spare (non-path) samples currently in requested|received.
   * After path approve; used for “N of 3” UI and CTA cap.
   */
  spareInFlightCount: number;
  sampleApproved: boolean;
  /**
   * Working / path supplier (first approved or explicit reorder path).
   * Insurance backup approvals do not steal this.
   */
  approvedSampleSupplierId: string | null;
  approvedSampleSupplierName: string | null;
  approvedSampleSupplierSource: SupplierSource | null;
  /** Every supplier with an approved sample (batch + warm eligibility). */
  approvedSupplierIds: string[];
  /** Interactive first-pick shortlist unlocked only when true. */
  showShortlist: boolean;
  /** True while an in-flight sample, approve, or batch hides/freezes tabs. */
  sourceTabsFrozen: boolean;
  batchOrdered: boolean;
  batchArrivedReady: boolean;
  /** Expected arrival window — founder-set or default 1 month. */
  batchArrivalEta: BatchArrivalEtaView;
  softLimitUsd: number;
  clearancePartner: string;
  money: MoneySnapshotSection;
  batchBasis: BatchCostBasis;
  costQuotes: CostQuotesView;
  /** Next-batch side-flow while selling (slice 1). */
  reorder: ReorderPanelView;
};

/** Freight + clearance (or local delivery + packaging) that drive batch cash. Last-mile never here. */
export type BatchCostBasis = {
  intlShip: number;
  clearanceTaxes: number;
  /** true once the founder saved post-sample quotes; false = Discovery planning. */
  usesQuotes: boolean;
};

/**
 * Single source of truth for the freight/clearance used in batch cash.
 * - Quotes saved → mapped quoted slots (Import freight/clearance or Local
 *   delivery/packaging). Last-mile never included.
 * - No quotes + Local source → Discovery-derived localPlanningLegs (same as H1).
 * - No quotes + Import (default) → Discovery moneySnapshot intlShip/clearance.
 */
export function batchCostBasis(
  money: MoneySnapshotSection,
  quoted: QuotedCostsSection | null,
  source: SupplierSource = "import",
): BatchCostBasis {
  if (quoted) {
    return {
      intlShip: quoted.intlShip,
      clearanceTaxes: quoted.clearanceTaxes,
      usesQuotes: true,
    };
  }
  if (source === "local") {
    const local = localPlanningLegs(money);
    return {
      intlShip: local.supplierDelivery,
      clearanceTaxes: local.packaging,
      usesQuotes: false,
    };
  }
  return {
    intlShip: money.intlShip,
    clearanceTaxes: money.clearanceTaxes,
    usesQuotes: false,
  };
}

function batchCost(unitPrice: number, qty: number, basis: BatchCostBasis) {
  const perUnit = unitPrice + basis.intlShip + basis.clearanceTaxes;
  return Math.round(perUnit * qty);
}

function toSupplierView(
  row: typeof schema.supplierOptions.$inferSelect,
  money: MoneySnapshotSection,
  quoted: QuotedCostsSection | null,
): SupplierView {
  let paymentMapView: PaymentMapView;
  try {
    paymentMapView = JSON.parse(row.paymentMapEstimate);
  } catch {
    paymentMapView = {
      depositPct: 30,
      balancePct: 70,
      method: "",
      estDeposit: 0,
      note: "",
    };
  }
  let redFlags: string[] = [];
  try {
    const parsed = JSON.parse(row.redFlags ?? "[]");
    if (Array.isArray(parsed)) redFlags = parsed.map(String);
  } catch {
    redFlags = [];
  }
  const source = normalizeSupplierSource(row.source);
  // Per-card estimate: Local rows use local planning legs before quotes;
  // once quotes exist they apply to the SKU (approved-sample source).
  const basis = batchCostBasis(money, quoted, source);
  const estBatchCost = batchCost(row.unitPrice, row.moq, basis);
  return {
    id: row.id,
    name: row.name,
    role: row.role as "primary" | "backup",
    rank: row.rank,
    source,
    years: row.years,
    rating: row.rating,
    verified: row.verified,
    moq: row.moq,
    unitPrice: row.unitPrice,
    sampleReplies: row.sampleReplies,
    negotiationDraft: row.negotiationDraft,
    paymentMap: paymentMapView,
    redFlags,
    estBatchCost,
    overSoftLimit: estBatchCost > BATCH_SOFT_WARNING_USD,
  };
}

export async function getSupplierPanel(
  workspaceId: string,
  skuId?: string,
): Promise<SupplierPanelView | null> {
  ensureMigrated();
  const sku = skuId
    ? await getSkuViewById(workspaceId, skuId)
    : await getSkuView(workspaceId);
  if (!sku) return null;
  await ensureSuppliers(workspaceId, sku.id);

  const [rows, side, journey, skuJourney, sampleRows, onboarding, topicRows, workspace, live] =
    await Promise.all([
      db
        .select()
        .from(schema.supplierOptions)
        .where(eq(schema.supplierOptions.skuId, sku.id))
        .orderBy(asc(schema.supplierOptions.rank))
        .all(),
      db
        .select()
        .from(schema.sideStatuses)
        .where(eq(schema.sideStatuses.workspaceId, workspaceId))
        .get(),
      getJourney(workspaceId),
      getSkuJourney(sku.id),
      db
        .select()
        .from(schema.sampleRecords)
        .where(eq(schema.sampleRecords.skuId, sku.id))
        .orderBy(asc(schema.sampleRecords.createdAt))
        .all(),
      db
        .select({
          monthlyFollowOnBudget: schema.onboardingProfiles.monthlyFollowOnBudget,
          experience: schema.onboardingProfiles.experience,
        })
        .from(schema.onboardingProfiles)
        .where(eq(schema.onboardingProfiles.workspaceId, workspaceId))
        .get(),
      db
        .select({
          weekStart: schema.topicAEntries.weekStart,
          storeTotalsUsd: schema.topicAEntries.storeTotalsUsd,
          metaSpend: schema.topicAEntries.metaSpend,
          tiktokSpend: schema.topicAEntries.tiktokSpend,
          courierFees: schema.topicAEntries.courierFees,
          perSkuSoldLeft: schema.topicAEntries.perSkuSoldLeft,
        })
        .from(schema.topicAEntries)
        .where(eq(schema.topicAEntries.workspaceId, workspaceId))
        .orderBy(asc(schema.topicAEntries.weekStart))
        .all(),
      db
        .select({ shopPaused: schema.workspaces.shopPaused })
        .from(schema.workspaces)
        .where(eq(schema.workspaces.id, workspaceId))
        .get(),
      listLiveSkus(workspaceId),
    ]);

  // Per-SKU journey only when present — never OR shop sideStatuses into SKU #2+.
  const flags = resolveSupplierJourneyFlags({
    skuJourney: skuJourney
      ? {
          primaryState: skuJourney.primaryState,
          pausedFromState: skuJourney.pausedFromState,
          sampleStatus: skuJourney.sampleStatus,
          batchOrdered: skuJourney.batchOrdered,
          batchArrivedReady: skuJourney.batchArrivedReady,
          batchArrivalEta: skuJourney.batchArrivalEta,
          costQuotesSaved: skuJourney.costQuotesSaved,
        }
      : null,
    legacy: skuJourney
      ? null
      : {
          primaryState: journey?.primaryState ?? "",
          sampleStatus: side?.sampleStatus ?? "none",
          batchOrdered: side?.batchOrdered ?? false,
          batchArrivedReady: side?.batchArrivedReady ?? false,
          batchArrivalEta: side?.batchArrivalEta ?? null,
          costQuotesSaved: side?.costQuotesSaved ?? false,
        },
  });

  const quoted = sku.quotedCosts;
  const views = rows.map((r) =>
    toSupplierView(r, sku.moneySnapshot, quoted),
  );
  const groups = groupSuppliersBySourceAndRank(views);

  // In-flight sample = requested | received only (approved is NOT in flight).
  const inFlightRows = listInFlightSamples(sampleRows);
  const samples: SampleView[] = inFlightRows.map((active) => {
    const supplier = views.find((v) => v.id === active.supplierId);
    let checklist: Record<string, boolean> = {};
    try {
      checklist = JSON.parse(active.qualityChecklist);
    } catch {
      checklist = {};
    }
    return {
      id: active.id,
      supplierId: active.supplierId,
      supplierName: supplier?.name ?? "",
      supplierSource: supplier?.source ?? "import",
      status: active.status,
      checklist,
      photoNotes: active.photoNotes,
      packingBrief: active.packingBrief,
    };
  });
  const sample = findInFlightSample(samples) ?? null;

  // Working path: explicit reorder path → else first approved (insurance must
  // not steal this). If that supplier was marked unavailable (can’t-fulfill),
  // active path is cleared until a backup switch — but we keep the locked
  // anchor for source + display so same-source backups still resolve.
  const firstApproved = findFirstApprovedSample(sampleRows);
  const approvedSampleIds = new Set(
    sampleRows.filter((s) => s.status === "approved").map((s) => s.supplierId),
  );

  const unavailable = parseUnavailableSuppliers(
    skuJourney?.reorderUnavailableJson,
  );
  const crisisSkipIds = parseCrisisSkipIds(skuJourney?.reorderCrisisSkipJson);

  const lockedPathId = resolveWorkingPathSupplierId({
    reorderPathSupplierId: skuJourney?.reorderPathSupplierId,
    reorderSupplierId: skuJourney?.reorderSupplierId,
    firstApprovedSupplierId: firstApproved?.supplierId ?? null,
  });
  const lockedPathSupplier = lockedPathId
    ? views.find((v) => v.id === lockedPathId)
    : undefined;

  const pathSupplierId =
    lockedPathId && !unavailable[lockedPathId] ? lockedPathId : null;
  const pathSupplier = pathSupplierId
    ? views.find((v) => v.id === pathSupplierId)
    : undefined;

  // Display / quotes: prefer active path; else locked anchor (may be unavailable).
  const approvedSampleSupplierId = pathSupplierId ?? lockedPathId;
  const approvedSampleSupplierName =
    pathSupplier?.name ?? lockedPathSupplier?.name ?? null;
  const approvedSampleSupplierSource =
    pathSupplier?.source ?? lockedPathSupplier?.source ?? null;

  const quoteSource: SupplierSource =
    approvedSampleSupplierSource ??
    sample?.supplierSource ??
    "import";

  const showShortlist = canShowSupplierShortlist({
    hasActiveSample: samples.length > 0,
    sampleApproved: flags.sampleApproved,
    batchOrdered: flags.batchOrdered,
  });

  const chosenSupplierId =
    approvedSampleSupplierId ?? sample?.supplierId ?? null;
  const chosenSupplier = chosenSupplierId
    ? views.find((v) => v.id === chosenSupplierId)
    : views.find((v) => v.role === "primary" && v.source === "import");

  // Local planning legs for prefill when quote source is local (same helper as
  // Discovery H1 / pre-quote batch cash).
  const localLegs = localPlanningLegs(sku.moneySnapshot);

  const planningPrefill = {
    productCost: chosenSupplier?.unitPrice ?? sku.moneySnapshot.productCost,
    intlShip: sku.moneySnapshot.intlShip,
    clearanceTaxes: sku.moneySnapshot.clearanceTaxes,
    supplierDelivery: localLegs.supplierDelivery,
    packaging: localLegs.packaging,
    localCourier: sku.moneySnapshot.localCourier,
    sellPrice: sku.moneySnapshot.sellPrice,
  };

  const quotesSaved = flags.costQuotesSaved;
  const needsQuotesRefresh = costQuotesNeedRefresh({
    unlocked: flags.sampleApproved,
    saved: quotesSaved,
    hasQuoted: !!quoted,
  });
  const savedPrefill = resolveCostQuotesPrefill({
    saved: quotesSaved,
    quoted,
    planningPrefill,
    workingUnitPrice: chosenSupplier?.unitPrice ?? null,
  });

  const primaryState = skuJourney
    ? effectiveJourneyState({
        primaryState: skuJourney.primaryState,
        pausedFromState: skuJourney.pausedFromState,
      })
    : effectiveJourneyState({
        primaryState: journey?.primaryState ?? "discovery",
        pausedFromState: journey?.pausedFromState ?? null,
      });
  const effectivePrimary =
    workspace?.shopPaused ? "paused" : primaryState;

  const reorderStatus = normalizeReorderStatus(skuJourney?.reorderStatus);
  const topicWeeks = topicRows.map(topicAWeekFromRow);
  const investNextRecommendation = resolveSkuInvestNextTone({
    skuId: sku.id,
    entries: topicWeeks,
    importCogsPerUnit: costBasisForSku(sku).importCogsPerUnit,
  });
  const experience = (onboarding?.experience ?? "beginner") as ExperienceLevel;
  const runway = computeRunwayForSkuFromEntries(topicRows, sku.id, {
    liveSkuCount: live.length,
  });
  const economics = evaluateReorderEconomicsGate({
    experience,
    investNextRecommendation,
  });

  const pathSource =
    pathSupplier?.source ?? approvedSampleSupplierSource ?? "import";

  const backups = listReorderBackupCandidates({
    suppliers: views,
    pathSource,
    pathSupplierId: pathSupplierId ?? lockedPathId,
    approvedSampleSupplierIds: approvedSampleIds,
    unavailable,
  });
  const warmCoach = shouldCoachWarmBackup({
    primaryState: effectivePrimary,
    sampleApproved: flags.sampleApproved,
    hasWarmBackup: backups.some((b) => b.warm),
  });
  const insuranceAvailable = canShowBackupInsurance({
    sampleApproved: flags.sampleApproved,
    primaryState: effectivePrimary,
  });
  const coldSampleInFlight = samples.some(
    (s) =>
      s.supplierId !== (pathSupplierId ?? lockedPathId) &&
      views.some((v) => v.id === s.supplierId && v.source === pathSource),
  );
  const spareInFlightCount = countInFlightSpareSamples(
    sampleRows,
    pathSupplierId ?? lockedPathId,
  );
  const hasLocalPool = views.some((v) => v.source === "local");
  const bridgeView = coldSampleInFlight
    ? bridgeCoachingForSource(
        hasLocalPool && pathSource === "import" ? "both" : pathSource,
      )
    : null;

  const reorderAvailable =
    effectivePrimary === "selling" &&
    flags.batchArrivedReady &&
    flags.sampleApproved;
  const reorderCanOrder = canMarkReorderOrdered({
    primaryState: effectivePrimary,
    reorderStatus,
    firstBatchArrived: flags.batchArrivedReady,
    sampleApproved: flags.sampleApproved,
  });
  const reorderCanArrived = canMarkReorderArrived({
    primaryState: effectivePrimary,
    reorderStatus,
  });
  const reorder: ReorderPanelView = {
    status: reorderStatus,
    primaryState: effectivePrimary,
    available: reorderAvailable,
    canOrder: reorderCanOrder,
    canMarkArrived: reorderCanArrived,
    canEditEta: canEditReorderArrivalEta({ reorderStatus }),
    supplierId: pathSupplierId,
    supplierName:
      pathSupplier?.name ?? lockedPathSupplier?.name ?? null,
    supplierSource:
      pathSupplier?.source ?? lockedPathSupplier?.source ?? null,
    qty: skuJourney?.reorderQty ?? null,
    estCost: skuJourney?.reorderEstCost ?? null,
    arrivalEta: resolveBatchArrivalEta(skuJourney?.reorderArrivalEta),
    runway,
    unitsLeftGlance: resolveUnitsLeftGlance(runway),
    investNextRecommendation,
    investTone: reorderInvestNextTone({
      recommendation: investNextRecommendation,
      runwayNudge: runway.nudge,
    }),
    experience,
    economics,
    needsEconomicsAck: economics.ok && economics.warning === "weak_economics",
    warmCoach,
    insuranceAvailable,
    backups,
    unavailable,
    crisisSkipIds: [...crisisSkipIds],
    bridge: bridgeView,
    coldSampleInFlight,
    exhaustedBackups:
      Object.keys(unavailable).length > 0 && backups.length === 0,
  };

  return {
    skuId: sku.id,
    groups,
    sample,
    samples,
    spareInFlightCount,
    sampleApproved: flags.sampleApproved,
    approvedSampleSupplierId,
    approvedSampleSupplierName,
    approvedSampleSupplierSource,
    approvedSupplierIds: [...approvedSampleIds],
    showShortlist,
    sourceTabsFrozen: !showShortlist,
    batchOrdered: flags.batchOrdered,
    batchArrivedReady: flags.batchArrivedReady,
    batchArrivalEta: resolveBatchArrivalEta(flags.batchArrivalEta),
    softLimitUsd: BATCH_SOFT_WARNING_USD,
    clearancePartner: CLEARANCE_PARTNER_TBD,
    money: sku.moneySnapshot,
    batchBasis: batchCostBasis(sku.moneySnapshot, quoted, quoteSource),
    costQuotes: {
      unlocked: flags.sampleApproved,
      saved: flags.costQuotesSaved,
      needsRefresh: needsQuotesRefresh,
      quoteSource,
      prefill: savedPrefill,
      quoted,
      planningMarginBefore: sku.moneySnapshot.marginBefore,
      monthlyFollowOnBudget: onboarding?.monthlyFollowOnBudget ?? 0,
    },
    reorder,
  };
}

async function ownedSupplier(workspaceId: string, supplierId: string) {
  const row = await db
    .select()
    .from(schema.supplierOptions)
    .where(eq(schema.supplierOptions.id, supplierId))
    .get();
  if (!row || row.workspaceId !== workspaceId) return undefined;
  return row;
}

// ---------------------------------------------------------------------------
// Sample-first flow
// ---------------------------------------------------------------------------

export async function requestSample(
  workspaceId: string,
  supplierId: string,
): Promise<{ ok: boolean; error?: string }> {
  ensureMigrated();
  const supplier = await ownedSupplier(workspaceId, supplierId);
  if (!supplier) return { ok: false, error: "not_found" };

  const [sampleRows, skuJourney, journey, side] = await Promise.all([
    db
      .select()
      .from(schema.sampleRecords)
      .where(eq(schema.sampleRecords.skuId, supplier.skuId))
      .orderBy(asc(schema.sampleRecords.createdAt))
      .all(),
    getSkuJourney(supplier.skuId),
    getJourney(workspaceId),
    db
      .select()
      .from(schema.sideStatuses)
      .where(eq(schema.sideStatuses.workspaceId, workspaceId))
      .get(),
  ]);

  const flags = resolveSupplierJourneyFlags({
    skuJourney: skuJourney
      ? {
          primaryState: skuJourney.primaryState,
          pausedFromState: skuJourney.pausedFromState,
          sampleStatus: skuJourney.sampleStatus,
          batchOrdered: skuJourney.batchOrdered,
          batchArrivedReady: skuJourney.batchArrivedReady,
          batchArrivalEta: skuJourney.batchArrivalEta,
          costQuotesSaved: skuJourney.costQuotesSaved,
        }
      : null,
    legacy: journey
      ? {
          primaryState: journey.primaryState,
          sampleStatus: side?.sampleStatus ?? "none",
          batchOrdered: side?.batchOrdered ?? false,
          batchArrivedReady: side?.batchArrivedReady ?? false,
          batchArrivalEta: side?.batchArrivalEta ?? null,
          costQuotesSaved: side?.costQuotesSaved ?? false,
        }
      : null,
  });

  let pathId: string | null = null;

  // After first approve: insurance only — cold same-source backups, never path.
  if (flags.sampleApproved) {
    const allSuppliers = await db
      .select()
      .from(schema.supplierOptions)
      .where(eq(schema.supplierOptions.skuId, supplier.skuId))
      .all();
    const unavailable = parseUnavailableSuppliers(
      skuJourney?.reorderUnavailableJson,
    );
    const firstApproved = findFirstApprovedSample(sampleRows);
    pathId =
      skuJourney?.reorderPathSupplierId ??
      skuJourney?.reorderSupplierId ??
      firstApproved?.supplierId ??
      null;
    const pathRow = pathId
      ? allSuppliers.find((s) => s.id === pathId)
      : undefined;
    const pathSource = normalizeSupplierSource(
      pathRow?.source ?? supplier.source,
    );

    if (supplier.id === pathId) {
      return { ok: false, error: "path_supplier" };
    }
    if (normalizeSupplierSource(supplier.source) !== pathSource) {
      return { ok: false, error: "wrong_source" };
    }
    if (unavailable[supplier.id]) {
      return { ok: false, error: "unavailable" };
    }
    // Already warmed — no second sample needed for insurance.
    if (
      sampleRows.some(
        (s) => s.supplierId === supplier.id && s.status === "approved",
      )
    ) {
      return { ok: false, error: "already_warm" };
    }
  }

  const flight = sampleFlightGate({
    sampleApproved: flags.sampleApproved,
    sampleRows,
    pathSupplierId: pathId,
    targetSupplierId: supplier.id,
  });
  if (flight !== "ok") {
    return { ok: false, error: flight };
  }

  const now = nowIso();
  await db.insert(schema.sampleRecords).values({
    id: newId(),
    workspaceId,
    skuId: supplier.skuId,
    supplierId,
    status: "requested",
    qualityChecklist: freshChecklist(),
    photoNotes: "",
    packingBrief: "",
    decidedAt: null,
    createdAt: now,
  });

  // Spare requests must not overwrite path sampleStatus once approved.
  if (shouldPatchJourneySampleStatus(flags.sampleApproved)) {
    await patchSkuSideFlags(workspaceId, supplier.skuId, {
      sampleStatus: "in_flight",
    });
  }

  await db.insert(schema.orchestratorEvents).values({
    id: newId(),
    workspaceId,
    kind: "sample_requested",
    message: `Sample requested from ${supplier.name}`,
    meta: JSON.stringify({ supplierId }),
    createdAt: now,
  });

  return { ok: true };
}

export async function markSampleReceived(
  workspaceId: string,
  sampleId: string,
  checklist: Record<string, boolean>,
  photoNotes: string,
): Promise<{ ok: boolean; error?: string }> {
  ensureMigrated();
  const row = await db
    .select()
    .from(schema.sampleRecords)
    .where(eq(schema.sampleRecords.id, sampleId))
    .get();
  if (!row || row.workspaceId !== workspaceId) return { ok: false, error: "not_found" };

  await db
    .update(schema.sampleRecords)
    .set({
      status: "received",
      qualityChecklist: JSON.stringify(checklist),
      photoNotes,
    })
    .where(eq(schema.sampleRecords.id, sampleId));
  return { ok: true };
}

export type SampleDecision = "approve" | "replace" | "reject";

export async function decideSample(
  workspaceId: string,
  sampleId: string,
  decision: SampleDecision,
): Promise<{ ok: boolean; error?: string }> {
  ensureMigrated();
  const row = await db
    .select()
    .from(schema.sampleRecords)
    .where(eq(schema.sampleRecords.id, sampleId))
    .get();
  if (!row || row.workspaceId !== workspaceId) {
    return { ok: false, error: "not_found" };
  }

  const [skuJourney, journey, side] = await Promise.all([
    getSkuJourney(row.skuId),
    getJourney(workspaceId),
    db
      .select()
      .from(schema.sideStatuses)
      .where(eq(schema.sideStatuses.workspaceId, workspaceId))
      .get(),
  ]);
  const flags = resolveSupplierJourneyFlags({
    skuJourney: skuJourney
      ? {
          primaryState: skuJourney.primaryState,
          pausedFromState: skuJourney.pausedFromState,
          sampleStatus: skuJourney.sampleStatus,
          batchOrdered: skuJourney.batchOrdered,
          batchArrivedReady: skuJourney.batchArrivedReady,
          batchArrivalEta: skuJourney.batchArrivalEta,
          costQuotesSaved: skuJourney.costQuotesSaved,
        }
      : null,
    legacy: skuJourney
      ? null
      : {
          primaryState: journey?.primaryState ?? "",
          sampleStatus: side?.sampleStatus ?? "none",
          batchOrdered: side?.batchOrdered ?? false,
          batchArrivedReady: side?.batchArrivedReady ?? false,
          batchArrivalEta: side?.batchArrivalEta ?? null,
          costQuotesSaved: side?.costQuotesSaved ?? false,
        },
  });

  const now = nowIso();

  if (decision === "approve") {
    const approval = await createApprovalRequest(workspaceId, "sample_decision", {
      data: { sampleId, supplierId: row.supplierId },
      skuId: row.skuId,
    });
    if (!approval) return { ok: false, error: "error" };
    const decided = await decideApproval(approval.id, {
      type: "approve",
      acknowledgements: [],
    });
    if (!decided.ok) return { ok: false, error: "error" };

    await db
      .update(schema.sampleRecords)
      .set({ status: "approved", decidedAt: now })
      .where(eq(schema.sampleRecords.id, sampleId));
    // First approve locks path; spare approve keeps sampleStatus approved (idempotent).
    await patchSkuSideFlags(workspaceId, row.skuId, {
      sampleStatus: "approved",
    });
    await db.insert(schema.orchestratorEvents).values({
      id: newId(),
      workspaceId,
      kind: "sample_approved",
      message: "Sample approved",
      meta: JSON.stringify({ skuId: row.skuId }),
      createdAt: now,
    });
    return { ok: true };
  }

  // Replace or reject: record decision so the founder can try another supplier.
  await db
    .update(schema.sampleRecords)
    .set({
      status: decision === "replace" ? "replace" : "rejected",
      decidedAt: now,
    })
    .where(eq(schema.sampleRecords.id, sampleId));
  // Spare reject/replace must not clear path sampleApproved / sampleStatus.
  if (shouldPatchJourneySampleStatus(flags.sampleApproved)) {
    await patchSkuSideFlags(workspaceId, row.skuId, {
      sampleStatus: decision === "reject" ? "rejected" : "none",
    });
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Post-sample cost quotes (expected margin before ads)
// ---------------------------------------------------------------------------

export type SaveCostQuotesResult =
  | { ok: true; expectedMarginBefore: number; passBefore: boolean }
  | { ok: false; error: "not_found" | "locked" | "invalid" };

export async function saveCostQuotes(
  workspaceId: string,
  input: CostQuoteInput,
  skuId?: string,
): Promise<SaveCostQuotesResult> {
  ensureMigrated();
  const sku = skuId
    ? await getSkuViewById(workspaceId, skuId)
    : await getSkuView(workspaceId);
  if (!sku) return { ok: false, error: "not_found" };

  const [skuJourney, journey, side, onboarding] = await Promise.all([
    getSkuJourney(sku.id),
    getJourney(workspaceId),
    db
      .select()
      .from(schema.sideStatuses)
      .where(eq(schema.sideStatuses.workspaceId, workspaceId))
      .get(),
    db
      .select({ monthlyFollowOnBudget: schema.onboardingProfiles.monthlyFollowOnBudget })
      .from(schema.onboardingProfiles)
      .where(eq(schema.onboardingProfiles.workspaceId, workspaceId))
      .get(),
  ]);

  const flags = resolveSupplierJourneyFlags({
    skuJourney: skuJourney
      ? {
          primaryState: skuJourney.primaryState,
          pausedFromState: skuJourney.pausedFromState,
          sampleStatus: skuJourney.sampleStatus,
          batchOrdered: skuJourney.batchOrdered,
          batchArrivedReady: skuJourney.batchArrivedReady,
          batchArrivalEta: skuJourney.batchArrivalEta,
          costQuotesSaved: skuJourney.costQuotesSaved,
        }
      : null,
    legacy: skuJourney
      ? null
      : {
          primaryState: journey?.primaryState ?? "",
          sampleStatus: side?.sampleStatus ?? "none",
          batchOrdered: side?.batchOrdered ?? false,
          batchArrivedReady: side?.batchArrivedReady ?? false,
          batchArrivalEta: side?.batchArrivalEta ?? null,
          costQuotesSaved: side?.costQuotesSaved ?? false,
        },
  });
  if (!flags.sampleApproved) return { ok: false, error: "locked" };

  if (!validateCostQuoteNumbers(input)) {
    return { ok: false, error: "invalid" };
  }

  const monthlyFollowOnBudget = onboarding?.monthlyFollowOnBudget ?? 0;
  const margin = computeMargin(toMarginInput(input, monthlyFollowOnBudget));
  const now = nowIso();
  const quoted = buildPersistedQuotedCosts(input, monthlyFollowOnBudget, now);

  await db
    .update(schema.skuCards)
    .set({
      quotedCosts: JSON.stringify(quoted),
      updatedAt: now,
    })
    .where(eq(schema.skuCards.id, sku.id));

  await patchSkuSideFlags(workspaceId, sku.id, { costQuotesSaved: true });

  await db.insert(schema.orchestratorEvents).values({
    id: newId(),
    workspaceId,
    kind: "cost_quotes_saved",
    message: `Cost quotes saved — expected margin before ads ${Math.round(margin.marginBefore * 100)}%`,
    meta: JSON.stringify({
      skuId: sku.id,
      source: input.source,
      expectedMarginBefore: margin.marginBefore,
      passBefore: margin.passBefore,
    }),
    createdAt: now,
  });

  return {
    ok: true,
    expectedMarginBefore: margin.marginBefore,
    passBefore: margin.passBefore,
  };
}

// ---------------------------------------------------------------------------
// Batch order flow (never requires store readiness)
// ---------------------------------------------------------------------------

export type OrderBatchResult =
  | { ok: true }
  | {
      ok: false;
      error:
        | "not_found"
        | "sample_not_approved"
        | "sample_supplier_mismatch"
        | "needs_stuck_acks"
        | "error";
    };

export async function orderBatch(
  workspaceId: string,
  supplierId: string,
  quantity: number,
  stuckAcks: boolean,
): Promise<OrderBatchResult> {
  ensureMigrated();
  const supplier = await ownedSupplier(workspaceId, supplierId);
  if (!supplier) return { ok: false, error: "not_found" };

  const sku = await getSkuViewById(workspaceId, supplier.skuId);
  if (!sku) return { ok: false, error: "not_found" };

  // Hard gate (real-life rule): batch only with a supplier who has an
  // APPROVED sample. An approved sample for a different supplier is not enough.
  const samples = await db
    .select({
      supplierId: schema.sampleRecords.supplierId,
      status: schema.sampleRecords.status,
    })
    .from(schema.sampleRecords)
    .where(eq(schema.sampleRecords.skuId, supplier.skuId))
    .all();
  const approvedForSupplier = samples.some(
    (s) => s.supplierId === supplierId && s.status === "approved",
  );
  if (!approvedForSupplier) {
    const anyApproved = samples.some((s) => s.status === "approved");
    return {
      ok: false,
      error: anyApproved ? "sample_supplier_mismatch" : "sample_not_approved",
    };
  }

  const qty = Math.max(1, Math.floor(quantity || supplier.moq));
  const estCost = batchCost(
    supplier.unitPrice,
    qty,
    batchCostBasis(
      sku.moneySnapshot,
      sku.quotedCosts,
      normalizeSupplierSource(supplier.source),
    ),
  );
  const now = nowIso();
  const skuId = supplier.skuId;

  // Stuck ladder: over the soft limit, the founder must acknowledge cash + risk
  // (Path C) before we open the batch gate.
  if (estCost > BATCH_SOFT_WARNING_USD) {
    if (!stuckAcks) return { ok: false, error: "needs_stuck_acks" };
    const stuck = await createApprovalRequest(
      workspaceId,
      "stuck_over_10k_path_c",
      { data: { supplierId, qty, estCost }, skuId },
    );
    if (stuck) {
      await decideApproval(stuck.id, {
        type: "approve",
        acknowledgements: ["cash_ack", "risk_ack"],
      });
    }
    await patchSkuSideFlags(workspaceId, skuId, {
      cashLockAck: true,
      stuckOver10kAck: true,
    });
  }

  const approval = await createApprovalRequest(workspaceId, "batch_ordered", {
    data: { supplierId, qty, estCost },
    skuId,
  });
  if (!approval) return { ok: false, error: "error" };
  const decided = await decideApproval(approval.id, {
    type: "approve",
    acknowledgements: [],
  });
  if (!decided.ok) return { ok: false, error: "error" };

  await db
    .update(schema.supplierOptions)
    .set({ status: "chosen" })
    .where(eq(schema.supplierOptions.id, supplierId));

  await patchSkuSideFlags(workspaceId, skuId, {
    batchOrdered: true,
    // Lock working/reorder path to who we actually ordered (Path B safe).
    reorderPathSupplierId: supplierId,
  });

  // Update the SKU import/batch section.
  await db
    .update(schema.skuCards)
    .set({
      importBatch: JSON.stringify({
        moq: supplier.moq,
        status: "ordered",
        suggestedFirstBatch: qty,
        estCost,
        supplierId,
        notes: ["@import.trackShipment", "@import.prepClearance"],
      }),
      updatedAt: now,
    })
    .where(eq(schema.skuCards.id, sku.id));

  await db.insert(schema.orchestratorEvents).values({
    id: newId(),
    workspaceId,
    kind: "batch_ordered",
    message: `Batch ordered: ${qty} units (~$${estCost})`,
    meta: JSON.stringify({ supplierId, qty, estCost }),
    createdAt: now,
  });

  return { ok: true };
}

export async function markBatchArrived(
  workspaceId: string,
  skuId: string,
  inventoryAck: boolean,
): Promise<{ ok: boolean; error?: string }> {
  ensureMigrated();
  if (!inventoryAck) return { ok: false, error: "needs_inventory_ack" };

  // Panel skuId only — never silent activeSkuId (multi-SKU footgun).
  const panelSkuId = resolvePanelScopedSkuId({ panelSkuId: skuId });
  if (!panelSkuId) return { ok: false, error: "not_found" };
  const sku = await getSkuViewById(workspaceId, panelSkuId);
  if (!sku) return { ok: false, error: "not_found" };

  const approval = await createApprovalRequest(
    workspaceId,
    "batch_arrived_ready",
    { data: {}, skuId: sku.id },
  );
  if (!approval) return { ok: false, error: "error" };
  const decided = await decideApproval(approval.id, {
    type: "approve",
    acknowledgements: ["inventory_ack"],
  });
  if (!decided.ok) return { ok: false, error: "error" };

  const now = nowIso();
  await patchSkuSideFlags(workspaceId, sku.id, { batchArrivedReady: true });

  await db
    .update(schema.skuCards)
    .set({
      importBatch: JSON.stringify({
        ...JSON.parse(
          (
            await db
              .select({ importBatch: schema.skuCards.importBatch })
              .from(schema.skuCards)
              .where(eq(schema.skuCards.id, sku.id))
              .get()
          )?.importBatch ?? "{}",
        ),
        status: "arrived",
      }),
      updatedAt: now,
    })
    .where(eq(schema.skuCards.id, sku.id));

  await db.insert(schema.orchestratorEvents).values({
    id: newId(),
    workspaceId,
    kind: "batch_arrived_ready",
    message: "Batch arrived and inventory checked",
    meta: JSON.stringify({ skuId: sku.id }),
    createdAt: now,
  });

  return { ok: true };
}

export type SetBatchArrivalEtaResult =
  | { ok: true; preLaunchRegenerated: boolean }
  | {
      ok: false;
      error:
        | "not_found"
        | "batch_not_ordered"
        | "batch_already_arrived"
        | "error";
    };

/**
 * Persist expected batch arrival ETA on Shared Business Memory (side_statuses).
 * Only while batch ordered and not yet arrived. If a pre_launch kit already
 * exists, regenerates it for the new weekCount (same path as manual regenerate).
 * Always targets the panel `skuId` — never silent activeSkuId.
 */
export async function setBatchArrivalEta(
  workspaceId: string,
  skuId: string,
  input: SetBatchArrivalEtaInput,
): Promise<SetBatchArrivalEtaResult> {
  ensureMigrated();
  const panelSkuId = resolvePanelScopedSkuId({ panelSkuId: skuId });
  if (!panelSkuId) return { ok: false, error: "not_found" };
  const sku = await getSkuViewById(workspaceId, panelSkuId);
  if (!sku) return { ok: false, error: "not_found" };

  const [skuJourney, side, journey] = await Promise.all([
    getSkuJourney(sku.id),
    db
      .select()
      .from(schema.sideStatuses)
      .where(eq(schema.sideStatuses.workspaceId, workspaceId))
      .get(),
    getJourney(workspaceId),
  ]);

  const flags = resolveSupplierJourneyFlags({
    skuJourney: skuJourney
      ? {
          primaryState: skuJourney.primaryState,
          pausedFromState: skuJourney.pausedFromState,
          sampleStatus: skuJourney.sampleStatus,
          batchOrdered: skuJourney.batchOrdered,
          batchArrivedReady: skuJourney.batchArrivedReady,
          batchArrivalEta: skuJourney.batchArrivalEta,
          costQuotesSaved: skuJourney.costQuotesSaved,
        }
      : null,
    legacy: skuJourney
      ? null
      : {
          primaryState: journey?.primaryState ?? "",
          sampleStatus: side?.sampleStatus ?? "none",
          batchOrdered: side?.batchOrdered ?? false,
          batchArrivedReady: side?.batchArrivedReady ?? false,
          batchArrivalEta: side?.batchArrivalEta ?? null,
          costQuotesSaved: side?.costQuotesSaved ?? false,
        },
  });

  if (
    !canEditBatchArrivalEta({
      batchOrdered: flags.batchOrdered,
      batchArrivedReady: flags.batchArrivedReady,
    })
  ) {
    if (flags.batchArrivedReady) {
      return { ok: false, error: "batch_already_arrived" };
    }
    return { ok: false, error: "batch_not_ordered" };
  }

  const stored = toStoredEta(input);
  const now = nowIso();
  await patchSkuSideFlags(workspaceId, sku.id, {
    batchArrivalEta: JSON.stringify(stored),
  });

  await db.insert(schema.orchestratorEvents).values({
    id: newId(),
    workspaceId,
    kind: "batch_arrival_eta",
    message: `Batch arrival ETA set: ${stored.preset} (~${stored.weeks} weeks)`,
    meta: JSON.stringify({ ...stored, skuId: sku.id }),
    createdAt: now,
  });

  // Auto-rebuild pre-launch plan when one already exists (latest ETA wins).
  const existingPre = await db
    .select({ id: schema.marketingKits.id })
    .from(schema.marketingKits)
    .where(
      and(
        eq(schema.marketingKits.workspaceId, workspaceId),
        eq(schema.marketingKits.skuId, sku.id),
        eq(schema.marketingKits.stage, "pre_launch"),
      ),
    )
    .get();

  let preLaunchRegenerated = false;
  if (existingPre) {
    const gen = await generateKit(workspaceId, "pre_launch", false, sku.id);
    preLaunchRegenerated = gen.ok;
  }

  return { ok: true, preLaunchRegenerated };
}

// ---------------------------------------------------------------------------
// Next-batch reorder (slice 1) — side-flow; primary stays selling
// ---------------------------------------------------------------------------

export type OrderNextBatchResult =
  | { ok: true }
  | {
      ok: false;
      error:
        | "not_found"
        | "not_selling"
        | "reorder_active"
        | "sample_not_approved"
        | "sample_supplier_mismatch"
        | "beginner_blocked"
        | "needs_economics_ack"
        | "needs_stuck_acks"
        | "error";
    };

/**
 * Mark next batch ordered on the same approved-sample supplier path.
 * Does NOT advance primary FSM — stays in selling.
 */
export async function orderNextBatch(
  workspaceId: string,
  skuId: string,
  quantity: number,
  opts: { economicsAck?: boolean; stuckAcks?: boolean } = {},
): Promise<OrderNextBatchResult> {
  ensureMigrated();
  const sku = await getSkuViewById(workspaceId, skuId);
  if (!sku) return { ok: false, error: "not_found" };

  const [skuJourney, sampleRows, onboarding, topicRows, workspace, live] =
    await Promise.all([
    getSkuJourney(skuId),
    db
      .select({
        supplierId: schema.sampleRecords.supplierId,
        status: schema.sampleRecords.status,
      })
      .from(schema.sampleRecords)
      .where(eq(schema.sampleRecords.skuId, skuId))
      .all(),
    db
      .select({ experience: schema.onboardingProfiles.experience })
      .from(schema.onboardingProfiles)
      .where(eq(schema.onboardingProfiles.workspaceId, workspaceId))
      .get(),
    db
      .select({
        weekStart: schema.topicAEntries.weekStart,
        storeTotalsUsd: schema.topicAEntries.storeTotalsUsd,
        metaSpend: schema.topicAEntries.metaSpend,
        tiktokSpend: schema.topicAEntries.tiktokSpend,
        courierFees: schema.topicAEntries.courierFees,
        perSkuSoldLeft: schema.topicAEntries.perSkuSoldLeft,
      })
      .from(schema.topicAEntries)
      .where(eq(schema.topicAEntries.workspaceId, workspaceId))
      .orderBy(asc(schema.topicAEntries.weekStart))
      .all(),
    db
      .select({ shopPaused: schema.workspaces.shopPaused })
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, workspaceId))
      .get(),
    listLiveSkus(workspaceId),
  ]);

  if (!skuJourney || skuJourney.workspaceId !== workspaceId) {
    return { ok: false, error: "not_found" };
  }

  const primaryState = workspace?.shopPaused
    ? "paused"
    : effectiveJourneyState({
        primaryState: skuJourney.primaryState,
        pausedFromState: skuJourney.pausedFromState,
      });
  const flags = resolveSupplierJourneyFlags({
    skuJourney: {
      primaryState: skuJourney.primaryState,
      pausedFromState: skuJourney.pausedFromState,
      sampleStatus: skuJourney.sampleStatus,
      batchOrdered: skuJourney.batchOrdered,
      batchArrivedReady: skuJourney.batchArrivedReady,
      batchArrivalEta: skuJourney.batchArrivalEta,
      costQuotesSaved: skuJourney.costQuotesSaved,
    },
    legacy: null,
  });
  const reorderStatus = normalizeReorderStatus(skuJourney.reorderStatus);
  if (
    !canMarkReorderOrdered({
      primaryState,
      reorderStatus,
      firstBatchArrived: skuJourney.batchArrivedReady,
      sampleApproved: flags.sampleApproved,
    })
  ) {
    if (primaryState !== "selling") return { ok: false, error: "not_selling" };
    if (reorderStatus === "ordered") return { ok: false, error: "reorder_active" };
    return { ok: false, error: "sample_not_approved" };
  }

  const approvedIds = new Set(
    sampleRows.filter((s) => s.status === "approved").map((s) => s.supplierId),
  );
  const unavailable = parseUnavailableSuppliers(skuJourney.reorderUnavailableJson);
  const crisisSkip = parseCrisisSkipIds(skuJourney.reorderCrisisSkipJson);

  // Path first; else first approved (not latest — insurance must not steal path).
  const firstApproved = findFirstApprovedSample(sampleRows);
  let supplierId: string | null =
    skuJourney.reorderPathSupplierId ??
    skuJourney.reorderSupplierId ??
    firstApproved?.supplierId ??
    null;
  // Prefer first chronologically approved that isn't unavailable if path missing/unavailable.
  if (!supplierId || unavailable[supplierId]) {
    const firstOk = sampleRows.find(
      (s) =>
        s.status === "approved" &&
        !unavailable[s.supplierId] &&
        canReorderWithSupplier({
          supplierId: s.supplierId,
          approvedSampleSupplierIds: approvedIds,
          crisisSkipSupplierIds: crisisSkip,
          unavailable,
        }),
    );
    supplierId = firstOk?.supplierId ?? null;
  }
  // Crisis-skip path supplier without sample.
  if (
    supplierId &&
    !canReorderWithSupplier({
      supplierId,
      approvedSampleSupplierIds: approvedIds,
      crisisSkipSupplierIds: crisisSkip,
      unavailable,
    })
  ) {
    supplierId = null;
  }
  if (!supplierId) {
    // Fall back: any crisis-skip or approved not unavailable
    for (const id of [...crisisSkip, ...approvedIds]) {
      if (
        canReorderWithSupplier({
          supplierId: id,
          approvedSampleSupplierIds: approvedIds,
          crisisSkipSupplierIds: crisisSkip,
          unavailable,
        })
      ) {
        supplierId = id;
        break;
      }
    }
  }
  if (!supplierId) return { ok: false, error: "sample_not_approved" };

  const supplier = await ownedSupplier(workspaceId, supplierId);
  if (!supplier || supplier.skuId !== skuId) {
    return { ok: false, error: "sample_supplier_mismatch" };
  }
  if (
    !canReorderWithSupplier({
      supplierId,
      approvedSampleSupplierIds: approvedIds,
      crisisSkipSupplierIds: crisisSkip,
      unavailable,
    })
  ) {
    return { ok: false, error: "sample_not_approved" };
  }

  const investNextRecommendation = resolveSkuInvestNextTone({
    skuId,
    entries: topicRows.map(topicAWeekFromRow),
    importCogsPerUnit: costBasisForSku(sku).importCogsPerUnit,
  });
  const experience = (onboarding?.experience ?? "beginner") as ExperienceLevel;
  const economics = evaluateReorderEconomicsGate({
    experience,
    investNextRecommendation,
  });
  if (!economics.ok) return { ok: false, error: "beginner_blocked" };
  if (economics.warning === "weak_economics" && !opts.economicsAck) {
    return { ok: false, error: "needs_economics_ack" };
  }

  const qty = Math.max(1, Math.floor(quantity || supplier.moq));
  const source = normalizeSupplierSource(supplier.source);
  const estCost = batchCost(
    supplier.unitPrice,
    qty,
    batchCostBasis(sku.moneySnapshot, sku.quotedCosts, source),
  );

  if (estCost > BATCH_SOFT_WARNING_USD) {
    if (!opts.stuckAcks) return { ok: false, error: "needs_stuck_acks" };
    const stuck = await createApprovalRequest(
      workspaceId,
      "stuck_over_10k_path_c",
      { data: { supplierId, qty, estCost, reorder: true }, skuId },
    );
    if (stuck) {
      await decideApproval(stuck.id, {
        type: "approve",
        acknowledgements: ["cash_ack", "risk_ack"],
      });
    }
  }

  const requiredAcks =
    economics.warning === "weak_economics" ? ["weak_economics_ack"] : [];
  const approval = await createApprovalRequest(workspaceId, "reorder_ordered", {
    data: {
      supplierId,
      qty,
      estCost,
      source,
      runway: computeRunwayForSkuFromEntries(topicRows, skuId, {
        liveSkuCount: live.length,
      }),
      investNextRecommendation,
    },
    requiredAcks,
    skuId,
  });
  if (!approval) return { ok: false, error: "error" };
  const decided = await decideApproval(approval.id, {
    type: "approve",
    acknowledgements: requiredAcks,
  });
  if (!decided.ok) return { ok: false, error: "error" };

  // Confirm primary row still selling — never advanced by side gates.
  const after = await getSkuJourney(skuId);
  if (after?.primaryState !== "selling" && after?.primaryState !== "paused") {
    return { ok: false, error: "error" };
  }

  const now = nowIso();
  await patchSkuJourneyFlags(skuId, {
    reorderStatus: "ordered",
    reorderSupplierId: supplierId,
    reorderPathSupplierId: supplierId,
    reorderQty: qty,
    reorderEstCost: estCost,
    reorderArrivalEta: null,
  });

  await db.insert(schema.orchestratorEvents).values({
    id: newId(),
    workspaceId,
    kind: "reorder_ordered",
    message: `Next batch marked ordered: ${qty} units (~$${estCost}) — still selling`,
    meta: JSON.stringify({ skuId, supplierId, qty, estCost, source }),
    createdAt: now,
  });

  return { ok: true };
}

export type MarkReorderArrivedResult =
  | { ok: true }
  | {
      ok: false;
      error: "not_found" | "not_selling" | "reorder_not_ordered" | "needs_inventory_ack" | "error";
    };

export async function markReorderArrived(
  workspaceId: string,
  skuId: string,
  inventoryAck: boolean,
): Promise<MarkReorderArrivedResult> {
  ensureMigrated();
  if (!inventoryAck) return { ok: false, error: "needs_inventory_ack" };

  const skuJourney = await getSkuJourney(skuId);
  if (!skuJourney || skuJourney.workspaceId !== workspaceId) {
    return { ok: false, error: "not_found" };
  }

  const primaryState = effectiveJourneyState({
    primaryState: skuJourney.primaryState,
    pausedFromState: skuJourney.pausedFromState,
  });
  const reorderStatus = normalizeReorderStatus(skuJourney.reorderStatus);
  if (
    !canMarkReorderArrived({ primaryState, reorderStatus })
  ) {
    if (primaryState !== "selling") return { ok: false, error: "not_selling" };
    return { ok: false, error: "reorder_not_ordered" };
  }

  const approval = await createApprovalRequest(workspaceId, "reorder_arrived", {
    data: {
      supplierId: skuJourney.reorderSupplierId,
      qty: skuJourney.reorderQty,
    },
    skuId,
  });
  if (!approval) return { ok: false, error: "error" };
  const decided = await decideApproval(approval.id, {
    type: "approve",
    acknowledgements: ["inventory_ack"],
  });
  if (!decided.ok) return { ok: false, error: "error" };

  const now = nowIso();
  // Complete side-flow → idle; primary stays selling.
  await patchSkuJourneyFlags(skuId, {
    reorderStatus: "idle",
    reorderSupplierId: null,
    reorderQty: null,
    reorderEstCost: null,
    reorderArrivalEta: null,
  });

  await db.insert(schema.orchestratorEvents).values({
    id: newId(),
    workspaceId,
    kind: "reorder_arrived",
    message: "Next batch arrived — stock topped up; still selling",
    meta: JSON.stringify({ skuId }),
    createdAt: now,
  });

  return { ok: true };
}

export type SetReorderArrivalEtaResult =
  | { ok: true }
  | {
      ok: false;
      error: "not_found" | "reorder_not_ordered" | "error";
    };

export async function setReorderArrivalEta(
  workspaceId: string,
  skuId: string,
  input: SetBatchArrivalEtaInput,
): Promise<SetReorderArrivalEtaResult> {
  ensureMigrated();
  const skuJourney = await getSkuJourney(skuId);
  if (!skuJourney || skuJourney.workspaceId !== workspaceId) {
    return { ok: false, error: "not_found" };
  }

  const reorderStatus = normalizeReorderStatus(skuJourney.reorderStatus);
  if (!canEditReorderArrivalEta({ reorderStatus })) {
    return { ok: false, error: "reorder_not_ordered" };
  }

  const stored = toStoredEta(input);
  const now = nowIso();
  await patchSkuJourneyFlags(skuId, {
    reorderArrivalEta: JSON.stringify(stored),
  });

  await db.insert(schema.orchestratorEvents).values({
    id: newId(),
    workspaceId,
    kind: "reorder_arrival_eta",
    message: `Next-batch ETA set: ${stored.preset} (~${stored.weeks} weeks)`,
    meta: JSON.stringify({ ...stored, skuId }),
    createdAt: now,
  });

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Slice 2 — can’t-fulfill + warm/cold backup switch
// ---------------------------------------------------------------------------

export type ReportCantFulfillResult =
  | {
      ok: true;
      cancelledOrdered: boolean;
      backups: BackupCandidate[];
      exhausted: boolean;
    }
  | {
      ok: false;
      error: "not_found" | "not_selling" | "no_path_supplier" | "error";
    };

/**
 * Founder reports current reorder path supplier can’t fulfill.
 * Marks unavailable; cancels in-transit reorder if any; stays selling.
 */
export async function reportSupplierCantFulfill(
  workspaceId: string,
  skuId: string,
  opts: { reason?: CantFulfillReason | string } = {},
): Promise<ReportCantFulfillResult> {
  ensureMigrated();
  const [skuJourney, sampleRows, suppliers, workspace] = await Promise.all([
    getSkuJourney(skuId),
    db
      .select({
        supplierId: schema.sampleRecords.supplierId,
        status: schema.sampleRecords.status,
      })
      .from(schema.sampleRecords)
      .where(eq(schema.sampleRecords.skuId, skuId))
      .orderBy(asc(schema.sampleRecords.createdAt))
      .all(),
    db
      .select()
      .from(schema.supplierOptions)
      .where(eq(schema.supplierOptions.skuId, skuId))
      .all(),
    db
      .select({ shopPaused: schema.workspaces.shopPaused })
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, workspaceId))
      .get(),
  ]);

  if (!skuJourney || skuJourney.workspaceId !== workspaceId) {
    return { ok: false, error: "not_found" };
  }

  const primaryState = workspace?.shopPaused
    ? "paused"
    : effectiveJourneyState({
        primaryState: skuJourney.primaryState,
        pausedFromState: skuJourney.pausedFromState,
      });
  if (primaryState !== "selling") return { ok: false, error: "not_selling" };

  const unavailable = parseUnavailableSuppliers(skuJourney.reorderUnavailableJson);
  // Same path order as panel / orderNextBatch — first approved, not latest
  // (insurance spare must not steal path after can’t-fulfill clears path fields).
  const firstApproved = findFirstApprovedSample(sampleRows);
  const pathId = resolveWorkingPathSupplierId({
    reorderPathSupplierId: skuJourney.reorderPathSupplierId,
    reorderSupplierId: skuJourney.reorderSupplierId,
    firstApprovedSupplierId: firstApproved?.supplierId ?? null,
  });
  if (!pathId) return { ok: false, error: "no_path_supplier" };
  // Already marked unavailable → founder must switch before reporting again.
  if (unavailable[pathId]) return { ok: false, error: "no_path_supplier" };

  const now = nowIso();
  const nextUnavailable = markSupplierUnavailable(
    unavailable,
    pathId,
    opts.reason ?? "other",
    now,
  );

  let cancelledOrdered = false;
  const reorderStatus = normalizeReorderStatus(skuJourney.reorderStatus);
  const cancel = planCancelReorderOrdered({
    primaryState,
    reorderStatus,
  });
  const patch: Parameters<typeof patchSkuJourneyFlags>[1] = {
    reorderUnavailableJson: serializeUnavailableSuppliers(nextUnavailable),
    reorderPathSupplierId: null,
  };
  if (cancel.ok) {
    cancelledOrdered = true;
    patch.reorderStatus = "idle";
    patch.reorderSupplierId = null;
    patch.reorderQty = null;
    patch.reorderEstCost = null;
    patch.reorderArrivalEta = null;
  }

  await patchSkuJourneyFlags(skuId, patch);

  const approvedIds = new Set(
    sampleRows.filter((s) => s.status === "approved").map((s) => s.supplierId),
  );
  const pathRow = suppliers.find((s) => s.id === pathId);
  const pathSource = normalizeSupplierSource(pathRow?.source);
  const backups = listReorderBackupCandidates({
    suppliers: suppliers.map((s) => ({
      id: s.id,
      name: s.name,
      role: s.role,
      source: normalizeSupplierSource(s.source),
      moq: s.moq,
      unitPrice: s.unitPrice,
    })),
    pathSource,
    pathSupplierId: pathId,
    approvedSampleSupplierIds: approvedIds,
    unavailable: nextUnavailable,
  });

  await db.insert(schema.orchestratorEvents).values({
    id: newId(),
    workspaceId,
    kind: "reorder_cant_fulfill",
    message: `Supplier can’t fulfill reorder (${opts.reason ?? "other"})`,
    meta: JSON.stringify({
      skuId,
      supplierId: pathId,
      reason: opts.reason ?? "other",
      cancelledOrdered,
      backupCount: backups.length,
    }),
    createdAt: now,
  });

  return {
    ok: true,
    cancelledOrdered,
    backups,
    exhausted: backups.length === 0,
  };
}

export type SwitchReorderBackupResult =
  | {
      ok: true;
      mode: "warm" | "cold_sample" | "crisis_skip";
    }
  | {
      ok: false;
      error:
        | "not_found"
        | "not_selling"
        | "not_backup"
        | "unavailable"
        | "beginner_no_skip"
        | "needs_skip_ack"
        | "error";
    };

/**
 * After can’t-fulfill: pick a same-source spare (any non-path supplier).
 * Warm → set path for immediate next-batch.
 * Cold → start sample (or crisis skip with ack for some/experienced).
 */
export async function switchReorderBackup(
  workspaceId: string,
  skuId: string,
  backupSupplierId: string,
  opts: { skipSampleAck?: boolean } = {},
): Promise<SwitchReorderBackupResult> {
  ensureMigrated();
  const [skuJourney, sampleRows, onboarding, workspace, suppliers] =
    await Promise.all([
      getSkuJourney(skuId),
      db
        .select({
          supplierId: schema.sampleRecords.supplierId,
          status: schema.sampleRecords.status,
        })
        .from(schema.sampleRecords)
        .where(eq(schema.sampleRecords.skuId, skuId))
        .all(),
      db
        .select({ experience: schema.onboardingProfiles.experience })
        .from(schema.onboardingProfiles)
        .where(eq(schema.onboardingProfiles.workspaceId, workspaceId))
        .get(),
      db
        .select({ shopPaused: schema.workspaces.shopPaused })
        .from(schema.workspaces)
        .where(eq(schema.workspaces.id, workspaceId))
        .get(),
      db
        .select()
        .from(schema.supplierOptions)
        .where(eq(schema.supplierOptions.skuId, skuId))
        .all(),
    ]);

  if (!skuJourney || skuJourney.workspaceId !== workspaceId) {
    return { ok: false, error: "not_found" };
  }

  const primaryState = workspace?.shopPaused
    ? "paused"
    : effectiveJourneyState({
        primaryState: skuJourney.primaryState,
        pausedFromState: skuJourney.pausedFromState,
      });
  if (primaryState !== "selling") return { ok: false, error: "not_selling" };

  const backup = await ownedSupplier(workspaceId, backupSupplierId);
  if (!backup || backup.skuId !== skuId) {
    return { ok: false, error: "not_found" };
  }

  const unavailable = parseUnavailableSuppliers(skuJourney.reorderUnavailableJson);
  if (unavailable[backupSupplierId]) return { ok: false, error: "unavailable" };

  const approvedIds = new Set(
    sampleRows.filter((s) => s.status === "approved").map((s) => s.supplierId),
  );
  const firstApproved = findFirstApprovedSample(sampleRows);
  const pathId =
    skuJourney.reorderPathSupplierId ??
    skuJourney.reorderSupplierId ??
    firstApproved?.supplierId ??
    null;
  if (backupSupplierId === pathId) {
    return { ok: false, error: "not_backup" };
  }
  const pathRow = pathId ? suppliers.find((s) => s.id === pathId) : undefined;
  const pathSource = normalizeSupplierSource(
    pathRow?.source ?? backup.source,
  );
  if (normalizeSupplierSource(backup.source) !== pathSource) {
    return { ok: false, error: "not_backup" };
  }

  const warm = approvedIds.has(backupSupplierId);
  const experience = (onboarding?.experience ?? "beginner") as ExperienceLevel;
  const now = nowIso();

  if (warm) {
    await patchSkuSideFlags(workspaceId, skuId, {
      reorderPathSupplierId: backupSupplierId,
      ...(pathSwitchShouldStaleCostQuotes("warm")
        ? { costQuotesSaved: false }
        : {}),
    });
    await db.insert(schema.orchestratorEvents).values({
      id: newId(),
      workspaceId,
      kind: "reorder_switch_warm",
      message: `Switched reorder path to warm spare ${backup.name}`,
      meta: JSON.stringify({ skuId, backupSupplierId }),
      createdAt: now,
    });
    return { ok: true, mode: "warm" };
  }

  if (opts.skipSampleAck) {
    const skipGate = evaluateCrisisSampleSkip({ experience, warm: false });
    if (!skipGate.ok) {
      return {
        ok: false,
        error:
          skipGate.error === "beginner_no_skip"
            ? "beginner_no_skip"
            : "error",
      };
    }

    const approval = await createApprovalRequest(
      workspaceId,
      "reorder_crisis_skip",
      { data: { backupSupplierId }, skuId },
    );
    if (!approval) return { ok: false, error: "error" };
    const decided = await decideApproval(approval.id, {
      type: "approve",
      acknowledgements: ["reorder_skip_sample_ack"],
    });
    if (!decided.ok) return { ok: false, error: "needs_skip_ack" };

    const crisis = parseCrisisSkipIds(skuJourney.reorderCrisisSkipJson);
    crisis.add(backupSupplierId);
    await patchSkuSideFlags(workspaceId, skuId, {
      reorderPathSupplierId: backupSupplierId,
      reorderCrisisSkipJson: serializeCrisisSkipIds(crisis),
      ...(pathSwitchShouldStaleCostQuotes("crisis_skip")
        ? { costQuotesSaved: false }
        : {}),
    });
    await db.insert(schema.orchestratorEvents).values({
      id: newId(),
      workspaceId,
      kind: "reorder_crisis_skip",
      message: `Crisis sample skip for backup ${backup.name}`,
      meta: JSON.stringify({
        skuId,
        backupSupplierId,
        experience,
        ack: "reorder_skip_sample_ack",
      }),
      createdAt: now,
    });
    return { ok: true, mode: "crisis_skip" };
  }

  const sampleRes = await requestSample(workspaceId, backupSupplierId);
  if (!sampleRes.ok) return { ok: false, error: "error" };

  await db.insert(schema.orchestratorEvents).values({
    id: newId(),
    workspaceId,
    kind: "reorder_cold_sample",
    message: `Cold backup sample started for ${backup.name}`,
    meta: JSON.stringify({ skuId, backupSupplierId }),
    createdAt: now,
  });

  return { ok: true, mode: "cold_sample" };
}
