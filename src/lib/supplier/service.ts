import { and, asc, eq } from "drizzle-orm";
import { db, ensureMigrated, schema } from "@/db";
import { newId, nowIso } from "@/lib/ids";
import { BATCH_SOFT_WARNING_USD } from "@/lib/constants";
import { createApprovalRequest, decideApproval } from "@/lib/approvals/engine";
import { getJourney } from "@/lib/memory/repos";
import { computeMargin } from "@/lib/skills/margin";
import {
  getSkuView,
  type MoneySnapshotSection,
  type QuotedCostsSection,
} from "@/lib/sku/service";
import { generateKit } from "@/lib/marketing/service";
import {
  canEditBatchArrivalEta,
  resolveBatchArrivalEta,
  toStoredEta,
  type BatchArrivalEtaView,
  type SetBatchArrivalEtaInput,
} from "@/lib/supplier/batch-eta";

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

const CITY_POOL = [
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
const SUFFIX_POOL = [
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
const MOQ_LADDER = [50, 100, 150, 200, 300, 500];

type GenSupplier = {
  name: string;
  role: "primary" | "backup";
  rank: number;
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

function emailDraft(
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

function generateSuppliers(
  skuId: string,
  productName: string,
  money: MoneySnapshotSection,
): GenSupplier[] {
  const rng = mulberry32(hashString(skuId));
  const baseUnit = Math.max(1, money.productCost || money.landedCost * 0.5);
  const suppliers: GenSupplier[] = [];

  for (let group = 0; group < 3; group++) {
    // 1 primary + 2 backups per group. Backups include a lower-MOQ alternative.
    const members: Array<{ role: "primary" | "backup"; moqIdx: number }> = [
      { role: "primary", moqIdx: 2 + group },
      { role: "backup", moqIdx: 0 }, // low-MOQ alternative
      { role: "backup", moqIdx: 3 + group },
    ];

    members.forEach((m, i) => {
      const city = CITY_POOL[Math.floor(rng() * CITY_POOL.length)];
      const suffix = SUFFIX_POOL[Math.floor(rng() * SUFFIX_POOL.length)];
      const isPrimary = m.role === "primary";
      const moq = MOQ_LADDER[Math.min(m.moqIdx, MOQ_LADDER.length - 1)];
      const priceJitter = 0.85 + rng() * 0.45;
      const unitPrice = Math.round(baseUnit * priceJitter * 100) / 100;
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
        years,
        rating: Math.min(5, rating),
        verified: isPrimary || rng() > 0.2,
        moq,
        unitPrice,
        sampleReplies,
        negotiationDraft: emailDraft(productName, city, baseUnit, moq),
        paymentMapEstimate: paymentMap(unitPrice, moq),
        redFlags,
      });
      void i;
    });
  }

  return suppliers;
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

/** Generate the supplier shortlist once per SKU (idempotent). */
export async function ensureSuppliers(workspaceId: string): Promise<void> {
  ensureMigrated();
  const sku = await getSkuView(workspaceId);
  if (!sku) return;

  const existing = await db
    .select({ id: schema.supplierOptions.id })
    .from(schema.supplierOptions)
    .where(eq(schema.supplierOptions.skuId, sku.id))
    .all();
  if (existing.length > 0) return;

  const generated = generateSuppliers(sku.id, sku.name, sku.moneySnapshot);
  const now = nowIso();
  await db.insert(schema.supplierOptions).values(
    generated.map((g) => ({
      id: newId(),
      workspaceId,
      skuId: sku.id,
      name: g.name,
      role: g.role,
      rank: g.rank,
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
  rank: number;
  primary: SupplierView | null;
  backups: SupplierView[];
};

export type SampleView = {
  id: string;
  supplierId: string;
  supplierName: string;
  status: string;
  checklist: Record<string, boolean>;
  photoNotes: string;
  packingBrief: string;
};

export type CostQuoteInput = {
  productCost: number;
  intlShip: number;
  clearanceTaxes: number;
  localCourier: number;
  sellPrice: number;
};

export type CostQuotesView = {
  unlocked: boolean;
  saved: boolean;
  prefill: CostQuoteInput;
  quoted: QuotedCostsSection | null;
  planningMarginBefore: number;
  monthlyFollowOnBudget: number;
};

export type SupplierPanelView = {
  skuId: string;
  groups: SupplierGroup[];
  sample: SampleView | null;
  sampleApproved: boolean;
  /**
   * Supplier that currently has an APPROVED sample (source of truth for batch).
   * May differ from `sample` when a newer in-flight sample was started for Path B.
   */
  approvedSampleSupplierId: string | null;
  approvedSampleSupplierName: string | null;
  batchOrdered: boolean;
  batchArrivedReady: boolean;
  /** Expected arrival window — founder-set or default 1 month. */
  batchArrivalEta: BatchArrivalEtaView;
  softLimitUsd: number;
  clearancePartner: string;
  money: MoneySnapshotSection;
  batchBasis: BatchCostBasis;
  costQuotes: CostQuotesView;
};

/** Freight + clearance that drive batch cash. Local courier is per-order and never here. */
export type BatchCostBasis = {
  intlShip: number;
  clearanceTaxes: number;
  /** true once the founder saved post-sample quotes; false = Discovery planning. */
  usesQuotes: boolean;
};

/**
 * Single source of truth for the freight/clearance used in batch cash. When the
 * founder has saved post-sample cost quotes we use those; otherwise we fall back
 * to the Discovery planning moneySnapshot (which is never overwritten).
 */
export function batchCostBasis(
  money: MoneySnapshotSection,
  quoted: QuotedCostsSection | null,
): BatchCostBasis {
  return quoted
    ? {
        intlShip: quoted.intlShip,
        clearanceTaxes: quoted.clearanceTaxes,
        usesQuotes: true,
      }
    : {
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
  basis: BatchCostBasis,
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
  const estBatchCost = batchCost(row.unitPrice, row.moq, basis);
  return {
    id: row.id,
    name: row.name,
    role: row.role as "primary" | "backup",
    rank: row.rank,
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
): Promise<SupplierPanelView | null> {
  ensureMigrated();
  const sku = await getSkuView(workspaceId);
  if (!sku) return null;
  await ensureSuppliers(workspaceId);

  const [rows, side, journey, sampleRows, onboarding] = await Promise.all([
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
    db
      .select()
      .from(schema.sampleRecords)
      .where(eq(schema.sampleRecords.skuId, sku.id))
      .orderBy(asc(schema.sampleRecords.createdAt))
      .all(),
    db
      .select({ monthlyFollowOnBudget: schema.onboardingProfiles.monthlyFollowOnBudget })
      .from(schema.onboardingProfiles)
      .where(eq(schema.onboardingProfiles.workspaceId, workspaceId))
      .get(),
  ]);

  const quoted = sku.quotedCosts;
  const basis = batchCostBasis(sku.moneySnapshot, quoted);
  const views = rows.map((r) => toSupplierView(r, basis));
  const groups: SupplierGroup[] = [0, 1, 2].map((rank) => {
    const inGroup = views.filter((v) => v.rank === rank);
    return {
      rank,
      primary: inGroup.find((v) => v.role === "primary") ?? null,
      backups: inGroup.filter((v) => v.role === "backup"),
    };
  });

  // Active sample = latest non-rejected/replaced record.
  const active = [...sampleRows]
    .reverse()
    .find((s) => s.status !== "rejected" && s.status !== "replace");
  let sample: SampleView | null = null;
  if (active) {
    const supplier = views.find((v) => v.id === active.supplierId);
    let checklist: Record<string, boolean> = {};
    try {
      checklist = JSON.parse(active.qualityChecklist);
    } catch {
      checklist = {};
    }
    sample = {
      id: active.id,
      supplierId: active.supplierId,
      supplierName: supplier?.name ?? "",
      status: active.status,
      checklist,
      photoNotes: active.photoNotes,
      packingBrief: active.packingBrief,
    };
  }

  const primaryState = journey?.primaryState ?? "";
  const sampleApproved =
    side?.sampleStatus === "approved" ||
    ["sample_approved", "store_setup", "batch_ordered", "batch_arrived_ready", "selling"].includes(
      primaryState,
    );

  // Latest approved sample — batch may only be marked for this supplier.
  const approvedSample = [...sampleRows]
    .reverse()
    .find((s) => s.status === "approved");
  const approvedSampleSupplierId = approvedSample?.supplierId ?? null;
  const approvedSampleSupplierName = approvedSampleSupplierId
    ? (views.find((v) => v.id === approvedSampleSupplierId)?.name ?? null)
    : null;

  const chosenSupplierId = active?.supplierId;
  const chosenSupplier = chosenSupplierId
    ? views.find((v) => v.id === chosenSupplierId)
    : views.find((v) => v.role === "primary");
  const prefill: CostQuoteInput = {
    productCost: chosenSupplier?.unitPrice ?? sku.moneySnapshot.productCost,
    intlShip: sku.moneySnapshot.intlShip,
    clearanceTaxes: sku.moneySnapshot.clearanceTaxes,
    localCourier: sku.moneySnapshot.localCourier,
    sellPrice: sku.moneySnapshot.sellPrice,
  };

  return {
    skuId: sku.id,
    groups,
    sample,
    sampleApproved,
    approvedSampleSupplierId,
    approvedSampleSupplierName,
    batchOrdered: side?.batchOrdered ?? false,
    batchArrivedReady: side?.batchArrivedReady ?? false,
    batchArrivalEta: resolveBatchArrivalEta(side?.batchArrivalEta ?? null),
    softLimitUsd: BATCH_SOFT_WARNING_USD,
    clearancePartner: "Clearance partner TBD",
    money: sku.moneySnapshot,
    batchBasis: basis,
    costQuotes: {
      unlocked: sampleApproved,
      saved: side?.costQuotesSaved ?? false,
      prefill: quoted
        ? {
            productCost: quoted.productCost,
            intlShip: quoted.intlShip,
            clearanceTaxes: quoted.clearanceTaxes,
            localCourier: quoted.localCourier,
            sellPrice: quoted.sellPrice,
          }
        : prefill,
      quoted,
      planningMarginBefore: sku.moneySnapshot.marginBefore,
      monthlyFollowOnBudget: onboarding?.monthlyFollowOnBudget ?? 0,
    },
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

  await db
    .update(schema.sideStatuses)
    .set({ sampleStatus: "in_flight", updatedAt: now })
    .where(eq(schema.sideStatuses.workspaceId, workspaceId));

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

  const now = nowIso();

  if (decision === "approve") {
    const approval = await createApprovalRequest(workspaceId, "sample_decision", {
      data: { sampleId, supplierId: row.supplierId },
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
    await db
      .update(schema.sideStatuses)
      .set({ sampleStatus: "approved", updatedAt: now })
      .where(eq(schema.sideStatuses.workspaceId, workspaceId));
    await db.insert(schema.orchestratorEvents).values({
      id: newId(),
      workspaceId,
      kind: "sample_approved",
      message: "Sample approved",
      meta: "{}",
      createdAt: now,
    });
    return { ok: true };
  }

  // Replace or reject: record decision so the founder can try another supplier.
  await db
    .update(schema.sampleRecords)
    .set({ status: decision === "replace" ? "replace" : "rejected", decidedAt: now })
    .where(eq(schema.sampleRecords.id, sampleId));
  await db
    .update(schema.sideStatuses)
    .set({
      sampleStatus: decision === "reject" ? "rejected" : "none",
      updatedAt: now,
    })
    .where(eq(schema.sideStatuses.workspaceId, workspaceId));
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
): Promise<SaveCostQuotesResult> {
  ensureMigrated();
  const sku = await getSkuView(workspaceId);
  if (!sku) return { ok: false, error: "not_found" };

  const [side, journey, onboarding] = await Promise.all([
    db
      .select()
      .from(schema.sideStatuses)
      .where(eq(schema.sideStatuses.workspaceId, workspaceId))
      .get(),
    getJourney(workspaceId),
    db
      .select({ monthlyFollowOnBudget: schema.onboardingProfiles.monthlyFollowOnBudget })
      .from(schema.onboardingProfiles)
      .where(eq(schema.onboardingProfiles.workspaceId, workspaceId))
      .get(),
  ]);

  const primaryState = journey?.primaryState ?? "";
  const sampleApproved =
    side?.sampleStatus === "approved" ||
    ["sample_approved", "store_setup", "batch_ordered", "batch_arrived_ready", "selling"].includes(
      primaryState,
    );
  if (!sampleApproved) return { ok: false, error: "locked" };

  const productCost = Number(input.productCost);
  const intlShip = Number(input.intlShip);
  const clearanceTaxes = Number(input.clearanceTaxes);
  const localCourier = Number(input.localCourier);
  const sellPrice = Number(input.sellPrice);
  if (
    ![productCost, intlShip, clearanceTaxes, localCourier, sellPrice].every(
      (n) => Number.isFinite(n) && n >= 0,
    )
  ) {
    return { ok: false, error: "invalid" };
  }

  const margin = computeMargin({
    sellPrice,
    productCost,
    intlShip,
    clearanceTaxes,
    localCourier,
    monthlyFollowOnBudget: onboarding?.monthlyFollowOnBudget ?? 0,
  });

  const now = nowIso();
  const quoted: QuotedCostsSection = {
    productCost,
    intlShip,
    clearanceTaxes,
    localCourier,
    sellPrice,
    landedCost: margin.landedCost,
    expectedMarginBefore: margin.marginBefore,
    savedAt: now,
  };

  await db
    .update(schema.skuCards)
    .set({
      quotedCosts: JSON.stringify(quoted),
      updatedAt: now,
    })
    .where(eq(schema.skuCards.id, sku.id));

  await db
    .update(schema.sideStatuses)
    .set({ costQuotesSaved: true, updatedAt: now })
    .where(eq(schema.sideStatuses.workspaceId, workspaceId));

  await db.insert(schema.orchestratorEvents).values({
    id: newId(),
    workspaceId,
    kind: "cost_quotes_saved",
    message: `Cost quotes saved — expected margin before ads ${Math.round(margin.marginBefore * 100)}%`,
    meta: JSON.stringify({
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

  const sku = await getSkuView(workspaceId);
  if (!sku) return { ok: false, error: "not_found" };

  // Hard gate (real-life rule): batch only with a supplier who has an
  // APPROVED sample. An approved sample for a different supplier is not enough.
  const samples = await db
    .select({
      supplierId: schema.sampleRecords.supplierId,
      status: schema.sampleRecords.status,
    })
    .from(schema.sampleRecords)
    .where(eq(schema.sampleRecords.workspaceId, workspaceId))
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
    batchCostBasis(sku.moneySnapshot, sku.quotedCosts),
  );
  const now = nowIso();

  // Stuck ladder: over the soft limit, the founder must acknowledge cash + risk
  // (Path C) before we open the batch gate.
  if (estCost > BATCH_SOFT_WARNING_USD) {
    if (!stuckAcks) return { ok: false, error: "needs_stuck_acks" };
    const stuck = await createApprovalRequest(
      workspaceId,
      "stuck_over_10k_path_c",
      { data: { supplierId, qty, estCost } },
    );
    if (stuck) {
      await decideApproval(stuck.id, {
        type: "approve",
        acknowledgements: ["cash_ack", "risk_ack"],
      });
    }
    await db
      .update(schema.sideStatuses)
      .set({ cashLockAck: true, stuckOver10kAck: true, updatedAt: now })
      .where(eq(schema.sideStatuses.workspaceId, workspaceId));
  }

  const approval = await createApprovalRequest(workspaceId, "batch_ordered", {
    data: { supplierId, qty, estCost },
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

  await db
    .update(schema.sideStatuses)
    .set({ batchOrdered: true, updatedAt: now })
    .where(eq(schema.sideStatuses.workspaceId, workspaceId));

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
  inventoryAck: boolean,
): Promise<{ ok: boolean; error?: string }> {
  ensureMigrated();
  if (!inventoryAck) return { ok: false, error: "needs_inventory_ack" };

  const sku = await getSkuView(workspaceId);
  if (!sku) return { ok: false, error: "not_found" };

  const approval = await createApprovalRequest(
    workspaceId,
    "batch_arrived_ready",
    { data: {} },
  );
  if (!approval) return { ok: false, error: "error" };
  const decided = await decideApproval(approval.id, {
    type: "approve",
    acknowledgements: ["inventory_ack"],
  });
  if (!decided.ok) return { ok: false, error: "error" };

  const now = nowIso();
  await db
    .update(schema.sideStatuses)
    .set({ batchArrivedReady: true, updatedAt: now })
    .where(eq(schema.sideStatuses.workspaceId, workspaceId));

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
    meta: "{}",
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
 */
export async function setBatchArrivalEta(
  workspaceId: string,
  input: SetBatchArrivalEtaInput,
): Promise<SetBatchArrivalEtaResult> {
  ensureMigrated();
  const side = await db
    .select()
    .from(schema.sideStatuses)
    .where(eq(schema.sideStatuses.workspaceId, workspaceId))
    .get();
  if (!side) return { ok: false, error: "not_found" };
  if (
    !canEditBatchArrivalEta({
      batchOrdered: side.batchOrdered,
      batchArrivedReady: side.batchArrivedReady,
    })
  ) {
    if (side.batchArrivedReady) {
      return { ok: false, error: "batch_already_arrived" };
    }
    return { ok: false, error: "batch_not_ordered" };
  }

  const stored = toStoredEta(input);
  const now = nowIso();
  await db
    .update(schema.sideStatuses)
    .set({
      batchArrivalEta: JSON.stringify(stored),
      updatedAt: now,
    })
    .where(eq(schema.sideStatuses.workspaceId, workspaceId));

  await db.insert(schema.orchestratorEvents).values({
    id: newId(),
    workspaceId,
    kind: "batch_arrival_eta",
    message: `Batch arrival ETA set: ${stored.preset} (~${stored.weeks} weeks)`,
    meta: JSON.stringify(stored),
    createdAt: now,
  });

  // Auto-rebuild pre-launch plan when one already exists (latest ETA wins).
  const existingPre = await db
    .select({ id: schema.marketingKits.id })
    .from(schema.marketingKits)
    .where(
      and(
        eq(schema.marketingKits.workspaceId, workspaceId),
        eq(schema.marketingKits.stage, "pre_launch"),
      ),
    )
    .get();

  let preLaunchRegenerated = false;
  if (existingPre) {
    const gen = await generateKit(workspaceId, "pre_launch", false);
    preLaunchRegenerated = gen.ok;
  }

  return { ok: true, preLaunchRegenerated };
}
