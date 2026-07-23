/**
 * REMOVABLE PREVIEW MODULE — local QA only.
 *
 * Seeds a demo founder and drives the Shared Business Memory to a chosen stage
 * by calling the REAL services / approval engine (never by writing illegal
 * memory fields directly). Re-running resets the demo workspace first so the
 * seed is idempotent. Delete `src/lib/preview/` to remove entirely.
 *
 * DETERMINISTIC FOR QA: re-seeding still resets (full wipe) the demo workspace,
 * but rebuilds the SAME fixture every time. Fixed user / workspace / SKU ids
 * (see PREVIEW_*_ID below) keep everything auditable, and — critically — the
 * supplier shortlist RNG is seeded from the SKU id (generateSuppliers →
 * hashString(skuId)), so pinning the SKU id makes unit prices, MOQs and supplier
 * names repeat across re-seeds. Fixed cost quotes + fixed Topic A weeks then keep
 * every downstream margin identical. No production behaviour changes: this only
 * runs under PREVIEW_MODE.
 */

import bcrypt from "bcryptjs";
import { and, asc, eq } from "drizzle-orm";
import { db, ensureMigrated, schema } from "@/db";
import { newId, nowIso } from "@/lib/ids";
import { MIN_BUDGET_USD } from "@/lib/constants";
import {
  PREVIEW_EMAIL,
  PREVIEW_PASSWORD,
  PREVIEW_USER_NAME,
  type PreviewStage,
  PREVIEW_STAGES,
} from "@/lib/preview/config";
import {
  startDiscoverySession,
  confirmDemand,
  resolveTier1,
  acceptProduct,
} from "@/lib/discovery/service";
import {
  getSupplierPanel,
  requestSample,
  markSampleReceived,
  decideSample,
  saveCostQuotes,
  orderBatch,
  markBatchArrived,
  setBatchArrivalEta,
} from "@/lib/supplier/service";
import {
  getStorePanel,
  saveStoreFields,
  toggleChecklistItem,
  markStoreReady,
} from "@/lib/store/service";
import { generateKit } from "@/lib/marketing/service";
import { startSelling, addWeeklyEntry } from "@/lib/finance/service";
import { STORE_CHECKLIST_KEYS } from "@/lib/constants";

export type SeedResult = {
  ok: boolean;
  stage: PreviewStage;
  email: string;
  password: string;
  userId: string;
  workspaceId: string;
  notes: string[];
};

function stageIndex(stage: PreviewStage): number {
  return PREVIEW_STAGES.indexOf(stage);
}

/**
 * Fixed preview ids. Safe because `resetPreviewData()` wipes any prior preview
 * rows before every seed, so there is only ever one preview user/workspace/SKU.
 * `PREVIEW_SKU_ID` is the important one: the supplier RNG is seeded from the SKU
 * id, so pinning it makes supplier prices/MOQs identical on every re-seed.
 */
const PREVIEW_USER_ID = "preview-user-0001";
const PREVIEW_WORKSPACE_ID = "preview-workspace-0001";
const PREVIEW_SKU_ID = "preview-sku-0001";

/**
 * Fixed, easy-to-audit founder cost quote for the selling fixture. `productCost`
 * is NOT fixed here — it is read at runtime from the approved supplier's unit
 * price via the real Supplier service view. The freight/clearance values are set
 * intentionally higher than the Discovery planning estimate ($2 / $1) so the
 * batch estimate and Topic A actual margins visibly use the quoted numbers.
 */
const PREVIEW_COST_QUOTE = {
  intlShip: 2.5, // real post-sample freight quote (Discovery planning est: $2)
  clearanceTaxes: 1.5, // real clearance quote (Discovery planning est: $1)
  localCourier: 2.5, // Lebanon COD courier, per order
  sellPrice: 30, // founder's final retail price
} as const;

// ---------------------------------------------------------------------------
// Reset: remove any existing preview workspace + user (FK-safe order)
// ---------------------------------------------------------------------------

async function resetPreviewData(): Promise<void> {
  ensureMigrated();
  const user = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, PREVIEW_EMAIL))
    .get();
  if (!user) return;

  const workspaces = await db
    .select()
    .from(schema.workspaces)
    .where(eq(schema.workspaces.founderUserId, user.id))
    .all();

  for (const ws of workspaces) {
    const id = ws.id;
    // Children first, then parents, to satisfy foreign keys.
    await db.delete(schema.sampleRecords).where(eq(schema.sampleRecords.workspaceId, id));
    await db.delete(schema.supplierOptions).where(eq(schema.supplierOptions.workspaceId, id));
    await db.delete(schema.marketingKits).where(eq(schema.marketingKits.workspaceId, id));
    await db.delete(schema.demandSignals).where(eq(schema.demandSignals.workspaceId, id));
    await db.delete(schema.skuCards).where(eq(schema.skuCards.workspaceId, id));
    await db.delete(schema.productCandidates).where(eq(schema.productCandidates.workspaceId, id));
    await db.delete(schema.discoverySessions).where(eq(schema.discoverySessions.workspaceId, id));
    await db.delete(schema.topicAEntries).where(eq(schema.topicAEntries.workspaceId, id));
    await db.delete(schema.financeVerdicts).where(eq(schema.financeVerdicts.workspaceId, id));
    await db.delete(schema.approvalRequests).where(eq(schema.approvalRequests.workspaceId, id));
    await db.delete(schema.orchestratorEvents).where(eq(schema.orchestratorEvents.workspaceId, id));
    await db.delete(schema.storeReadiness).where(eq(schema.storeReadiness.workspaceId, id));
    await db.delete(schema.onboardingProfiles).where(eq(schema.onboardingProfiles.workspaceId, id));
    await db.delete(schema.journeyStates).where(eq(schema.journeyStates.workspaceId, id));
    await db.delete(schema.sideStatuses).where(eq(schema.sideStatuses.workspaceId, id));
    await db.delete(schema.workspaces).where(eq(schema.workspaces.id, id));
  }

  await db.delete(schema.sessions).where(eq(schema.sessions.userId, user.id));
  await db.delete(schema.users).where(eq(schema.users.id, user.id));
}

// ---------------------------------------------------------------------------
// Foundation: user + workspace + journey + side + completed onboarding
// ---------------------------------------------------------------------------

async function createFoundation(): Promise<{ userId: string; workspaceId: string }> {
  ensureMigrated();
  const now = nowIso();
  const userId = PREVIEW_USER_ID;
  const workspaceId = PREVIEW_WORKSPACE_ID;
  const passwordHash = await bcrypt.hash(PREVIEW_PASSWORD, 10);

  await db.insert(schema.users).values({
    id: userId,
    email: PREVIEW_EMAIL,
    passwordHash,
    name: PREVIEW_USER_NAME,
    createdAt: now,
  });

  await db.insert(schema.workspaces).values({
    id: workspaceId,
    founderUserId: userId,
    name: "Preview Store",
    language: "en",
    activeSkuId: null,
    shopifyStatus: "not_started",
    createdAt: now,
  });

  await db.insert(schema.journeyStates).values({
    id: newId(),
    workspaceId,
    primaryState: "discovery",
    pausedFromState: null,
    blockedFromState: null,
    blockedReason: null,
    updatedAt: now,
  });

  await db.insert(schema.sideStatuses).values({
    id: newId(),
    workspaceId,
    onboardingComplete: true,
    productAccepted: false,
    okayRiskAck: false,
    tier1Resolved: false,
    sampleStatus: "none",
    storeReadyPercent: 0,
    storeReady: false,
    marketingStage: "none",
    batchOrdered: false,
    batchArrivedReady: false,
    topicAWeekCount: 0,
    cashLockAck: false,
    stuckOver10kAck: false,
    updatedAt: now,
  });

  // Valid v1 onboarding values (budget ≥ $2000, Lebanon + COD acknowledged).
  await db.insert(schema.onboardingProfiles).values({
    id: newId(),
    workspaceId,
    budgetUsd: Math.max(MIN_BUDGET_USD, 3500),
    monthlyFollowOnBudget: 600,
    hoursPerWeek: 12,
    experience: "some",
    uiLanguage: "en",
    storageDescription: "A dry spare room at home, roughly 2 shelves free.",
    storageLimits: "No space for oversized boxes; small parcels only.",
    riskTolerance: "medium",
    categoryLikes: JSON.stringify([
      "home_kitchen",
      "phone_tech_accessories",
      "health_wellness_gadgets",
    ]),
    lebanonSellabilityAck: true,
    codComfort: "Comfortable with cash on delivery as the primary method.",
    shopifyStatus: "in_progress",
    maxLandedCost: 18,
    deliveryBandDays: "7-10",
    sampleClearanceReady: true,
    completedAt: now,
    updatedAt: now,
  });

  return { userId, workspaceId };
}

// ---------------------------------------------------------------------------
// Stage drivers (each uses the real services / approval gates)
// ---------------------------------------------------------------------------

async function driveDiscovery(workspaceId: string, notes: string[]): Promise<void> {
  const onboarding = await db
    .select()
    .from(schema.onboardingProfiles)
    .where(eq(schema.onboardingProfiles.workspaceId, workspaceId))
    .get();
  if (!onboarding) throw new Error("preview: onboarding missing");
  await startDiscoverySession(workspaceId, onboarding);
  notes.push("Started a discovery session (5 products revealed).");
}

/** Accept the first acceptable candidate through the real approval gate. */
async function driveAccept(workspaceId: string, notes: string[]): Promise<void> {
  const session = await db
    .select()
    .from(schema.discoverySessions)
    .where(
      and(
        eq(schema.discoverySessions.workspaceId, workspaceId),
        eq(schema.discoverySessions.status, "active"),
      ),
    )
    .get();
  if (!session) throw new Error("preview: no active discovery session");

  // Order by rank so the picked candidate is deterministic (not dependent on
  // arbitrary row order) — the top-ranked acceptable product every re-seed.
  const candidates = await db
    .select()
    .from(schema.productCandidates)
    .where(eq(schema.productCandidates.sessionId, session.id))
    .orderBy(asc(schema.productCandidates.rank))
    .all();

  const pick = candidates.find(
    (c) => c.status === "shown" && c.marginsPass && !c.oversizedHardBlock,
  );
  if (!pick) throw new Error("preview: no acceptable candidate found");

  if (pick.tier1Conflict) {
    await resolveTier1(workspaceId, pick.id, "customize");
    notes.push(`Resolved Tier-1 conflict (customize) for ${pick.name}.`);
  }

  const demand = await confirmDemand(
    workspaceId,
    pick.id,
    {
      url: "https://www.tiktok.com/@demo/video/1234567890",
      note: "Several local creators showing this; comments asking where to buy.",
      screenshotNote: "Screenshot: 3 posts, 40k+ combined views.",
    },
    "en",
  );
  if (!demand.ok) throw new Error(`preview: confirmDemand failed (${demand.error})`);

  const accepted = await acceptProduct(workspaceId, pick.id, true);
  if (!accepted.ok) throw new Error(`preview: acceptProduct failed (${accepted.error})`);
  notes.push(`Accepted "${pick.name}" (${pick.strength}) — Topic B SKU created.`);

  // Pin the freshly created SKU id to a fixed value so the supplier RNG (seeded
  // from skuId in generateSuppliers) is identical on every re-seed. Safe here:
  // this runs right after accept, before getSupplierPanel/ensureSuppliers, so no
  // supplier/sample rows reference the SKU yet. workspaces.activeSkuId is a plain
  // text pointer (no FK), so we update it to match.
  const created = await db
    .select({ id: schema.skuCards.id })
    .from(schema.skuCards)
    .where(eq(schema.skuCards.workspaceId, workspaceId))
    .get();
  if (created && created.id !== PREVIEW_SKU_ID) {
    await db
      .update(schema.skuCards)
      .set({ id: PREVIEW_SKU_ID })
      .where(eq(schema.skuCards.id, created.id));
    await db
      .update(schema.workspaces)
      .set({ activeSkuId: PREVIEW_SKU_ID })
      .where(eq(schema.workspaces.id, workspaceId));
  }
}

async function seedStore(workspaceId: string, markReady: boolean, notes: string[]): Promise<void> {
  await getStorePanel(workspaceId); // ensures the store row + starter drafts
  await saveStoreFields(workspaceId, {
    whatsappNumber: "+961 3 000 000",
    storeUrl: "https://preview-store.myshopify.com",
    courierChoice: "partner_a",
  });
  // Tick most of the checklist so the panel looks realistic.
  for (const key of STORE_CHECKLIST_KEYS) {
    if (!markReady && key === "whatsappConnected") continue;
    await toggleChecklistItem(workspaceId, key, true);
  }
  if (markReady) {
    await markStoreReady(workspaceId);
    notes.push("Store marked ready (side status — never blocks batch).");
  } else {
    notes.push("Store checklist partially filled (WhatsApp + drafts).");
  }
}

async function driveSampleApproved(workspaceId: string, notes: string[]): Promise<void> {
  const panel = await getSupplierPanel(workspaceId);
  if (!panel) throw new Error("preview: supplier panel unavailable");
  const primary = panel.groups.find((g) => g.primary)?.primary;
  if (!primary) throw new Error("preview: no primary supplier generated");

  const reqd = await requestSample(workspaceId, primary.id);
  if (!reqd.ok) throw new Error(`preview: requestSample failed (${reqd.error})`);

  const afterReq = await getSupplierPanel(workspaceId);
  const sampleId = afterReq?.sample?.id;
  if (!sampleId) throw new Error("preview: sample record not found");

  const checklist = Object.fromEntries(
    [
      "matchesPhotos",
      "materialQuality",
      "functionsWork",
      "packagingIntact",
      "sizeWeight",
      "safetySmell",
      "arabicLabeling",
    ].map((k) => [k, true]),
  ) as Record<string, boolean>;
  await markSampleReceived(
    workspaceId,
    sampleId,
    checklist,
    "Sample matched photos; solid build; clean packaging.",
  );

  const decided = await decideSample(workspaceId, sampleId, "approve");
  if (!decided.ok) throw new Error(`preview: decideSample failed (${decided.error})`);
  notes.push(`Sample requested from ${primary.name}, received, and approved.`);

  // Intro marketing unlocks at sample approved; store setup opens in parallel.
  await generateKit(workspaceId, "intro_pdf", false);
  notes.push("Generated intro marketing lesson.");
  await seedStore(workspaceId, false, notes);
}

/**
 * Selling fixture only: save post-sample founder cost quotes through the REAL
 * `saveCostQuotes` service (never a raw `quotedCosts` / `costQuotesSaved` write).
 * Runs after sample approval and BEFORE batch ordering so the batch estimate and
 * every Topic A actual-margin surface use the founder-quoted costs.
 */
async function driveCostQuotes(workspaceId: string, notes: string[]): Promise<void> {
  const panel = await getSupplierPanel(workspaceId);
  if (!panel) throw new Error("preview: supplier panel unavailable for cost quotes");
  // Working supplier = the approved sample's supplier; its unit price is exposed
  // by the Supplier view as the cost-quote prefill product cost.
  const productCost = panel.costQuotes.prefill.productCost;

  const saved = await saveCostQuotes(workspaceId, {
    productCost,
    intlShip: PREVIEW_COST_QUOTE.intlShip,
    clearanceTaxes: PREVIEW_COST_QUOTE.clearanceTaxes,
    localCourier: PREVIEW_COST_QUOTE.localCourier,
    sellPrice: PREVIEW_COST_QUOTE.sellPrice,
  });
  if (!saved.ok) throw new Error(`preview: saveCostQuotes failed (${saved.error})`);
  notes.push(
    `Saved founder cost quotes (unit $${productCost} + freight $${PREVIEW_COST_QUOTE.intlShip} + clearance $${PREVIEW_COST_QUOTE.clearanceTaxes}) — expected margin before ads ${Math.round(
      saved.expectedMarginBefore * 100,
    )}%.`,
  );
}

async function driveBatchArrived(workspaceId: string, notes: string[]): Promise<void> {
  const panel = await getSupplierPanel(workspaceId);
  if (!panel) throw new Error("preview: supplier panel unavailable");
  const primary = panel.groups.find((g) => g.primary)?.primary;
  if (!primary) throw new Error("preview: no primary supplier for batch");

  const qty = primary.moq;
  let ordered = await orderBatch(workspaceId, primary.id, qty, false);
  if (!ordered.ok && ordered.error === "needs_stuck_acks") {
    // Batch estimate crossed the $10k soft limit — acknowledge and proceed.
    ordered = await orderBatch(workspaceId, primary.id, qty, true);
    notes.push("Batch over $10k soft limit — acknowledged stuck-ladder acks.");
  }
  if (!ordered.ok) throw new Error(`preview: orderBatch failed (${ordered.error})`);
  notes.push(`Ordered a batch of ${qty} units from ${primary.name}.`);

  // Default ETA so pre-launch week plan is founder-set (not silent default).
  const eta = await setBatchArrivalEta(workspaceId, { preset: "1m" });
  if (!eta.ok) throw new Error(`preview: setBatchArrivalEta failed (${eta.error})`);
  notes.push("Set batch arrival ETA to ~1 month.");

  // Pre-launch marketing unlocks once the batch is ordered.
  await generateKit(workspaceId, "pre_launch", false);

  const arrived = await markBatchArrived(workspaceId, true);
  if (!arrived.ok) throw new Error(`preview: markBatchArrived failed (${arrived.error})`);
  notes.push("Marked batch arrived + inventory checked.");

  // Launch marketing (first launch kit needs the budget-rules ack).
  await generateKit(workspaceId, "launch", true);
  notes.push("Generated pre-launch + launch marketing kits.");

  // Finish the store side so QA can see a ready store next to the batch.
  await seedStore(workspaceId, true, notes);
}

async function driveSelling(workspaceId: string, notes: string[]): Promise<void> {
  const started = await startSelling(workspaceId);
  if (!started.ok) throw new Error(`preview: startSelling failed (${started.error})`);
  notes.push("Marked selling — Topic A advice is now live.");

  // 4 consecutive weekly Topic A starts (exactly +7 days). Raw weekly values
  // only — the Finance service computes every margin. Per unit the fixture holds
  // sell $30, import COGS (product + freight + clearance) and $2.50 courier
  // constant, so healthy weeks land well above the 35% after-ads guardrail.
  // Week 3 is an intentional WARNING: a Meta/TikTok spend spike pushes actual
  // after-ads below 35% while before-ads stays healthy. Units sold stay within
  // the 150-unit batch.
  const weeks = [
    { weekStart: "2026-03-17", sales: 720, orders: 24, meta: 90, tiktok: 54, collected: 610, outstanding: 110, courier: 60, sold: 24, left: 126 },
    { weekStart: "2026-03-24", sales: 900, orders: 30, meta: 110, tiktok: 70, collected: 760, outstanding: 140, courier: 75, sold: 30, left: 96 },
    { weekStart: "2026-03-31", sales: 1080, orders: 36, meta: 350, tiktok: 210, collected: 900, outstanding: 180, courier: 90, sold: 36, left: 60 },
    { weekStart: "2026-04-07", sales: 1200, orders: 40, meta: 150, tiktok: 90, collected: 1010, outstanding: 190, courier: 100, sold: 40, left: 20 },
  ];
  for (const w of weeks) {
    const arrived = await addWeeklyEntry(workspaceId, {
      weekStart: w.weekStart,
      sales: w.sales,
      orders: w.orders,
      metaSpend: w.meta,
      tiktokSpend: w.tiktok,
      codCollected: w.collected,
      codOutstanding: w.outstanding,
      courierFees: w.courier,
      skuSold: w.sold,
      skuLeft: w.left,
    });
    if (!arrived.ok) throw new Error(`preview: addWeeklyEntry failed (${arrived.error})`);
  }
  notes.push(
    "Added 4 weekly Topic A entries (1 intentional <35% after-ads warning week; invest-next unlocked).",
  );

  // A monthly-refresh kit rounds out the marketing panel.
  await generateKit(workspaceId, "monthly_refresh", true);
}

// ---------------------------------------------------------------------------
// Public entry
// ---------------------------------------------------------------------------

export async function seedPreview(stage: PreviewStage): Promise<SeedResult> {
  ensureMigrated();
  const notes: string[] = [];

  await resetPreviewData();
  const { userId, workspaceId } = await createFoundation();
  notes.push(`Created demo founder ${PREVIEW_EMAIL} with completed onboarding.`);

  const target = stageIndex(stage);

  // Discovery is always seeded so the board isn't empty at stage A.
  await driveDiscovery(workspaceId, notes);

  if (target >= stageIndex("accepted")) {
    await driveAccept(workspaceId, notes);
  }
  if (target >= stageIndex("sample_approved")) {
    await driveSampleApproved(workspaceId, notes);
  }
  // Selling fixture only: save founder cost quotes BEFORE batch ordering so the
  // batch estimate + Topic A actual margins exercise the founder-quoted path.
  if (target >= stageIndex("selling")) {
    await driveCostQuotes(workspaceId, notes);
  }
  if (target >= stageIndex("batch_arrived_ready")) {
    await driveBatchArrived(workspaceId, notes);
  }
  if (target >= stageIndex("selling")) {
    await driveSelling(workspaceId, notes);
  }

  return {
    ok: true,
    stage,
    email: PREVIEW_EMAIL,
    password: PREVIEW_PASSWORD,
    userId,
    workspaceId,
    notes,
  };
}
