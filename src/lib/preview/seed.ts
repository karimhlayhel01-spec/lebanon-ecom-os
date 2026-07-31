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
 * every downstream margin identical.
 *
 * Identity exception: first/last name, workspace name, and language are snapshotted
 * before wipe and restored after createFoundation so Settings renames survive
 * stage jumps. First-ever seed still uses Preview / Founder / Preview's Store.
 * No production behaviour changes: this only runs under PREVIEW_MODE.
 */

import bcrypt from "bcryptjs";
import { and, asc, desc, eq, ne } from "drizzle-orm";
import { db, ensureMigrated, schema } from "@/db";
import { newId, nowIso } from "@/lib/ids";
import { MIN_BUDGET_USD } from "@/lib/constants";
import {
  PREVIEW_EMAIL,
  PREVIEW_PASSWORD,
  type ClassicPreviewStage,
  type PreviewStage,
  type Wave1PreviewStage,
  CLASSIC_PREVIEW_STAGES,
  isWave1PreviewStage,
} from "@/lib/preview/config";
import {
  resolvePreviewIdentity,
  type PreviewIdentity,
} from "@/lib/preview/identity";
import { fullDisplayName } from "@/lib/workspace-name";
import { deleteUserAndWorkspace } from "@/lib/account/delete-user";
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
import { archiveSku } from "@/lib/sku/lifecycle";
import { ADD_SKU_HEALTHY_WEEKS_MIN } from "@/lib/sku/add-sku-gate";

export type SeedResult = {
  ok: boolean;
  stage: PreviewStage;
  email: string;
  password: string;
  userId: string;
  workspaceId: string;
  notes: string[];
};

function classicStageIndex(stage: ClassicPreviewStage): number {
  return CLASSIC_PREVIEW_STAGES.indexOf(stage);
}

/**
 * Fixed preview ids. Safe because `resetPreviewData()` wipes any prior preview
 * rows before every seed. `PREVIEW_SKU_ID*` pin supplier RNG across re-seeds.
 */
const PREVIEW_USER_ID = "preview-user-0001";
const PREVIEW_WORKSPACE_ID = "preview-workspace-0001";
const PREVIEW_SKU_ID = "preview-sku-0001";
const PREVIEW_SKU_ID_2 = "preview-sku-0002";
const PREVIEW_SKU_ID_3 = "preview-sku-0003";

const PREVIEW_COST_QUOTE = {
  intlShip: 2.5,
  clearanceTaxes: 1.5,
  localCourier: 2.5,
  sellPrice: 30,
} as const;

type ExperienceLevel = "beginner" | "some" | "experienced";

// ---------------------------------------------------------------------------
// Reset / foundation
// ---------------------------------------------------------------------------

async function readPreviewIdentity(): Promise<PreviewIdentity | null> {
  ensureMigrated();
  const user = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, PREVIEW_EMAIL))
    .get();
  if (!user) return null;

  const workspace = await db
    .select()
    .from(schema.workspaces)
    .where(eq(schema.workspaces.founderUserId, user.id))
    .get();
  if (!workspace) return null;

  const onboarding = await db
    .select()
    .from(schema.onboardingProfiles)
    .where(eq(schema.onboardingProfiles.workspaceId, workspace.id))
    .get();

  return {
    firstName: user.firstName,
    lastName: user.lastName,
    workspaceName: workspace.name,
    language: workspace.language,
    uiLanguage: onboarding?.uiLanguage ?? workspace.language,
  };
}

async function resetPreviewData(): Promise<void> {
  ensureMigrated();
  const user = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, PREVIEW_EMAIL))
    .get();
  if (!user) return;
  await deleteUserAndWorkspace(user.id);
}

async function createFoundation(
  identity: PreviewIdentity,
  experience: ExperienceLevel = "some",
): Promise<{ userId: string; workspaceId: string }> {
  ensureMigrated();
  const now = nowIso();
  const userId = PREVIEW_USER_ID;
  const workspaceId = PREVIEW_WORKSPACE_ID;
  const passwordHash = await bcrypt.hash(PREVIEW_PASSWORD, 10);

  await db.insert(schema.users).values({
    id: userId,
    email: PREVIEW_EMAIL,
    passwordHash,
    firstName: identity.firstName,
    lastName: identity.lastName,
    name: fullDisplayName(identity.firstName, identity.lastName),
    createdAt: now,
  });

  await db.insert(schema.workspaces).values({
    id: workspaceId,
    founderUserId: userId,
    name: identity.workspaceName,
    language: identity.language,
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

  await db.insert(schema.onboardingProfiles).values({
    id: newId(),
    workspaceId,
    budgetUsd: Math.max(MIN_BUDGET_USD, 3500),
    monthlyFollowOnBudget: 600,
    hoursPerWeek: 12,
    experience,
    uiLanguage: identity.uiLanguage,
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

async function setActiveSku(
  workspaceId: string,
  skuId: string,
): Promise<void> {
  await db
    .update(schema.workspaces)
    .set({ activeSkuId: skuId })
    .where(eq(schema.workspaces.id, workspaceId));
}

/**
 * Pin a freshly accepted SKU to a fixed id (before suppliers/samples exist).
 */
async function pinSkuId(
  workspaceId: string,
  oldId: string,
  fixedId: string,
): Promise<void> {
  if (oldId === fixedId) {
    await setActiveSku(workspaceId, fixedId);
    return;
  }

  const journey = await db
    .select()
    .from(schema.skuJourneys)
    .where(eq(schema.skuJourneys.skuId, oldId))
    .get();

  const approvalIds = (
    await db
      .select({ id: schema.approvalRequests.id })
      .from(schema.approvalRequests)
      .where(eq(schema.approvalRequests.skuId, oldId))
      .all()
  ).map((r) => r.id);

  await db.delete(schema.skuJourneys).where(eq(schema.skuJourneys.skuId, oldId));
  await db
    .update(schema.approvalRequests)
    .set({ skuId: null })
    .where(eq(schema.approvalRequests.skuId, oldId));

  await db
    .update(schema.skuCards)
    .set({ id: fixedId })
    .where(eq(schema.skuCards.id, oldId));
  await setActiveSku(workspaceId, fixedId);

  for (const id of approvalIds) {
    await db
      .update(schema.approvalRequests)
      .set({ skuId: fixedId })
      .where(eq(schema.approvalRequests.id, id));
  }

  if (journey) {
    await db.insert(schema.skuJourneys).values({
      ...journey,
      id: journey.id,
      skuId: fixedId,
    });
  }
}

// ---------------------------------------------------------------------------
// Stage drivers (real services / approval gates)
// ---------------------------------------------------------------------------

async function driveDiscovery(
  workspaceId: string,
  notes: string[],
): Promise<void> {
  const onboarding = await db
    .select()
    .from(schema.onboardingProfiles)
    .where(eq(schema.onboardingProfiles.workspaceId, workspaceId))
    .get();
  if (!onboarding) throw new Error("preview: onboarding missing");
  await startDiscoverySession(workspaceId, onboarding);
  notes.push("Started a discovery session (5 products revealed).");
}

async function pickAcceptableCandidate(
  workspaceId: string,
  excludeCatalogKeys: ReadonlySet<string> = new Set(),
) {
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

  const candidates = await db
    .select()
    .from(schema.productCandidates)
    .where(eq(schema.productCandidates.sessionId, session.id))
    .orderBy(asc(schema.productCandidates.rank))
    .all();

  const pick = candidates.find((c) => {
    if (c.status !== "shown" || !c.marginsPass || c.oversizedHardBlock) {
      return false;
    }
    let key = "";
    try {
      key = String(JSON.parse(c.fitBreakdown).catalogKey ?? "");
    } catch {
      key = "";
    }
    if (key && excludeCatalogKeys.has(key)) return false;
    return true;
  });
  if (!pick) throw new Error("preview: no acceptable candidate found");
  return pick;
}

async function acceptAndPin(
  workspaceId: string,
  fixedSkuId: string,
  notes: string[],
  excludeCatalogKeys: ReadonlySet<string> = new Set(),
): Promise<string> {
  const pick = await pickAcceptableCandidate(workspaceId, excludeCatalogKeys);

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
  if (!demand.ok) {
    throw new Error(`preview: confirmDemand failed (${demand.error})`);
  }

  const accepted = await acceptProduct(workspaceId, pick.id, true);
  if (!accepted.ok) {
    throw new Error(`preview: acceptProduct failed (${accepted.error})`);
  }
  notes.push(`Accepted "${pick.name}" (${pick.strength}) — Topic B SKU created.`);

  const created = await db
    .select({ id: schema.skuCards.id })
    .from(schema.skuCards)
    .where(
      and(
        eq(schema.skuCards.workspaceId, workspaceId),
        ne(schema.skuCards.id, PREVIEW_SKU_ID),
        ne(schema.skuCards.id, PREVIEW_SKU_ID_2),
        ne(schema.skuCards.id, PREVIEW_SKU_ID_3),
      ),
    )
    .orderBy(desc(schema.skuCards.createdAt))
    .get();

  // First pin: card may already be the only one and not match exclusions if
  // somehow already pinned — fall back to newest live card.
  const target =
    created ??
    (
      await db
        .select({ id: schema.skuCards.id })
        .from(schema.skuCards)
        .where(eq(schema.skuCards.workspaceId, workspaceId))
        .orderBy(desc(schema.skuCards.createdAt))
        .get()
    );

  if (!target) throw new Error("preview: SKU card missing after accept");
  await pinSkuId(workspaceId, target.id, fixedSkuId);
  return fixedSkuId;
}

/** Accept the first acceptable candidate (classic path SKU #1). */
async function driveAccept(
  workspaceId: string,
  notes: string[],
): Promise<void> {
  await acceptAndPin(workspaceId, PREVIEW_SKU_ID, notes);
}

/** Catalog keys already accepted in this workspace (for multi-SKU pick). */
async function getAcceptedCatalogKeys(
  workspaceId: string,
): Promise<Set<string>> {
  const rows = await db
    .select({ fitBreakdown: schema.productCandidates.fitBreakdown })
    .from(schema.productCandidates)
    .where(
      and(
        eq(schema.productCandidates.workspaceId, workspaceId),
        eq(schema.productCandidates.status, "accepted"),
      ),
    )
    .all();
  const keys = new Set<string>();
  for (const row of rows) {
    try {
      const key = JSON.parse(row.fitBreakdown).catalogKey;
      if (key) keys.add(String(key));
    } catch {
      /* ignore */
    }
  }
  return keys;
}

/**
 * Open a fresh discovery session and accept a different catalog product as
 * another live SKU (Wave 1). Matches production add-SKU (startDiscoverySession)
 * but skips already-accepted catalog keys so fixtures get distinct products.
 */
async function driveAcceptAnother(
  workspaceId: string,
  fixedSkuId: string,
  notes: string[],
): Promise<string> {
  const onboarding = await db
    .select()
    .from(schema.onboardingProfiles)
    .where(eq(schema.onboardingProfiles.workspaceId, workspaceId))
    .get();
  if (!onboarding) throw new Error("preview: onboarding missing");

  // Close any leftover session so startDiscoverySession opens a fresh pool.
  await db
    .update(schema.discoverySessions)
    .set({ status: "closed" })
    .where(eq(schema.discoverySessions.workspaceId, workspaceId));

  const acceptedKeys = await getAcceptedCatalogKeys(workspaceId);
  await startDiscoverySession(workspaceId, onboarding);
  notes.push("Opened add-SKU discovery.");

  return acceptAndPin(workspaceId, fixedSkuId, notes, acceptedKeys);
}

async function seedStore(
  workspaceId: string,
  markReady: boolean,
  notes: string[],
): Promise<void> {
  await getStorePanel(workspaceId);
  await saveStoreFields(workspaceId, {
    whatsappNumber: "+961 3 000 000",
    storeUrl: "https://preview-store.myshopify.com",
    courierChoice: "partner_a",
  });
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

async function driveSampleApproved(
  workspaceId: string,
  notes: string[],
  opts: { seedStoreSide?: boolean; skuId?: string } = {},
): Promise<void> {
  const seedStoreSide = opts.seedStoreSide !== false;
  const panel = await getSupplierPanel(workspaceId);
  if (!panel) throw new Error("preview: supplier panel unavailable");
  const primary = panel.groups.find((g) => g.primary)?.primary;
  if (!primary) throw new Error("preview: no primary supplier generated");

  const reqd = await requestSample(workspaceId, primary.id);
  if (!reqd.ok) {
    throw new Error(`preview: requestSample failed (${reqd.error})`);
  }

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
  if (!decided.ok) {
    throw new Error(`preview: decideSample failed (${decided.error})`);
  }
  notes.push(`Sample requested from ${primary.name}, received, and approved.`);

  await generateKit(workspaceId, "intro_pdf", false, opts.skuId);
  notes.push("Generated intro marketing lesson.");
  if (seedStoreSide) {
    await seedStore(workspaceId, false, notes);
  }
}

async function driveCostQuotes(
  workspaceId: string,
  notes: string[],
): Promise<void> {
  const panel = await getSupplierPanel(workspaceId);
  if (!panel) throw new Error("preview: supplier panel unavailable for cost quotes");
  const productCost = panel.costQuotes.prefill.productCost;

  const saved = await saveCostQuotes(workspaceId, {
    source: "import",
    productCost,
    intlShip: PREVIEW_COST_QUOTE.intlShip,
    clearanceTaxes: PREVIEW_COST_QUOTE.clearanceTaxes,
    localCourier: PREVIEW_COST_QUOTE.localCourier,
    sellPrice: PREVIEW_COST_QUOTE.sellPrice,
  });
  if (!saved.ok) {
    throw new Error(`preview: saveCostQuotes failed (${saved.error})`);
  }
  notes.push(
    `Saved founder cost quotes (unit $${productCost} + freight $${PREVIEW_COST_QUOTE.intlShip} + clearance $${PREVIEW_COST_QUOTE.clearanceTaxes}) — expected margin before ads ${Math.round(
      saved.expectedMarginBefore * 100,
    )}%.`,
  );
}

async function driveBatchArrived(
  workspaceId: string,
  notes: string[],
  opts: {
    seedStoreSide?: boolean;
    /** Stop after order + pre-launch kit (do not mark arrived / launch). */
    stopAfterOrdered?: boolean;
    skuId?: string;
  } = {},
): Promise<void> {
  const seedStoreSide = opts.seedStoreSide !== false;
  const panel = await getSupplierPanel(workspaceId);
  if (!panel) throw new Error("preview: supplier panel unavailable");
  const primary = panel.groups.find((g) => g.primary)?.primary;
  if (!primary) throw new Error("preview: no primary supplier for batch");

  const qty = primary.moq;
  let ordered = await orderBatch(workspaceId, primary.id, qty, false);
  if (!ordered.ok && ordered.error === "needs_stuck_acks") {
    ordered = await orderBatch(workspaceId, primary.id, qty, true);
    notes.push("Batch over $10k soft limit — acknowledged stuck-ladder acks.");
  }
  if (!ordered.ok) {
    throw new Error(`preview: orderBatch failed (${ordered.error})`);
  }
  notes.push(`Ordered a batch of ${qty} units from ${primary.name}.`);

  const skuId = opts.skuId ?? panel.skuId;
  const eta = await setBatchArrivalEta(workspaceId, skuId, { preset: "1m" });
  if (!eta.ok) {
    throw new Error(`preview: setBatchArrivalEta failed (${eta.error})`);
  }
  notes.push("Set batch arrival ETA to ~1 month.");

  await generateKit(workspaceId, "pre_launch", false, skuId);

  if (opts.stopAfterOrdered) {
    notes.push("Stopped at batch ordered — pre-launch kit only (not arrived).");
    return;
  }

  const arrived = await markBatchArrived(workspaceId, skuId, true);
  if (!arrived.ok) {
    throw new Error(`preview: markBatchArrived failed (${arrived.error})`);
  }
  notes.push("Marked batch arrived + inventory checked.");

  await generateKit(workspaceId, "launch", true, skuId);
  notes.push("Generated pre-launch + launch marketing kits.");

  if (seedStoreSide) {
    await seedStore(workspaceId, true, notes);
  }
}

async function driveMarkSelling(
  workspaceId: string,
  skuId: string,
  notes: string[],
): Promise<void> {
  await setActiveSku(workspaceId, skuId);
  const started = await startSelling(workspaceId, skuId);
  if (!started.ok) {
    throw new Error(`preview: startSelling failed (${started.error})`);
  }
  notes.push(`Marked selling for ${skuId} — Topic A advice is now live.`);
}

/** Classic selling fixture weeks (includes one intentional watch week). */
async function driveClassicTopicAWeeks(
  workspaceId: string,
  notes: string[],
): Promise<void> {
  const weeks = [
    {
      weekStart: "2026-03-17",
      sales: 720,
      orders: 24,
      meta: 90,
      tiktok: 54,
      collected: 610,
      outstanding: 110,
      courier: 60,
      sold: 24,
      left: 126,
    },
    {
      weekStart: "2026-03-24",
      sales: 900,
      orders: 30,
      meta: 110,
      tiktok: 70,
      collected: 760,
      outstanding: 140,
      courier: 75,
      sold: 30,
      left: 96,
    },
    {
      weekStart: "2026-03-31",
      sales: 1080,
      orders: 36,
      meta: 350,
      tiktok: 210,
      collected: 900,
      outstanding: 180,
      courier: 90,
      sold: 36,
      left: 60,
    },
    {
      weekStart: "2026-04-07",
      sales: 1200,
      orders: 40,
      meta: 150,
      tiktok: 90,
      collected: 1010,
      outstanding: 190,
      courier: 100,
      sold: 40,
      left: 20,
    },
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
    if (!arrived.ok) {
      throw new Error(`preview: addWeeklyEntry failed (${arrived.error})`);
    }
  }
  notes.push(
    "Added 4 weekly Topic A entries (1 intentional <35% after-ads warning week; invest-next unlocked).",
  );
  await generateKit(workspaceId, "monthly_refresh", true);
}

async function driveSelling(
  workspaceId: string,
  notes: string[],
): Promise<void> {
  await driveMarkSelling(workspaceId, PREVIEW_SKU_ID, notes);
  await driveClassicTopicAWeeks(workspaceId, notes);
}

/**
 * Seed N weeks that the Finance service scores as `healthy` (same computeHealth
 * path as production). Used for Wave 1 add-SKU bar QA.
 */
async function driveHealthyTopicAWeeks(
  workspaceId: string,
  count: number,
  notes: string[],
  opts: {
    startDate?: string;
    skuLines?: Array<{
      skuId: string;
      sold: number;
      left: number;
      sales: number;
    }>;
  } = {},
): Promise<void> {
  const start = opts.startDate ?? "2025-12-01";
  const startMs = Date.parse(`${start}T12:00:00Z`);
  if (Number.isNaN(startMs)) {
    throw new Error(`preview: bad week start ${start}`);
  }

  for (let i = 0; i < count; i++) {
    const d = new Date(startMs + i * 7 * 24 * 60 * 60 * 1000);
    const weekStart = d.toISOString().slice(0, 10);
    // Conservative healthy shape: strong ROAS, low COD outstanding, positive net.
    const sold = 8;
    const sales = sold * PREVIEW_COST_QUOTE.sellPrice; // 240
    const meta = 24;
    const tiktok = 12; // ads 36 → ROAS 240/36 ≈ 6.7
    const collected = 200;
    const outstanding = 40; // ratio 40/240 ≈ 0.17
    const courier = sold * PREVIEW_COST_QUOTE.localCourier; // 20
    const left = Math.max(0, 120 - sold * (i + 1));

    const payload =
      opts.skuLines && opts.skuLines.length > 0
        ? {
            weekStart,
            sales,
            orders: sold,
            metaSpend: meta,
            tiktokSpend: tiktok,
            codCollected: collected,
            codOutstanding: outstanding,
            courierFees: courier,
            skuSold: sold,
            skuLeft: left,
            skuLines: opts.skuLines.map((l) => ({
              ...l,
              // Keep per-SKU lines stable; shop roll-up still healthy.
              sold: Math.max(1, Math.floor(l.sold)),
              left: l.left,
              sales: l.sales,
            })),
          }
        : {
            weekStart,
            sales,
            orders: sold,
            metaSpend: meta,
            tiktokSpend: tiktok,
            codCollected: collected,
            codOutstanding: outstanding,
            courierFees: courier,
            skuSold: sold,
            skuLeft: left,
          };

    const arrived = await addWeeklyEntry(workspaceId, payload);
    if (!arrived.ok) {
      throw new Error(`preview: healthy addWeeklyEntry failed (${arrived.error})`);
    }
  }
  notes.push(
    `Added ${count} healthy Topic A weeks (Finance verdict healthy; add-SKU bar path).`,
  );
}

type SkuPipelineTarget =
  | "sample_approved"
  | "batch_ordered"
  | "batch_arrived_ready"
  | "selling";

async function driveSkuPipeline(
  workspaceId: string,
  skuId: string,
  target: SkuPipelineTarget,
  notes: string[],
  opts: { seedStoreSide?: boolean } = {},
): Promise<void> {
  await setActiveSku(workspaceId, skuId);
  const seedStoreSide = opts.seedStoreSide !== false;

  await driveSampleApproved(workspaceId, notes, { seedStoreSide, skuId });
  if (target === "sample_approved") return;

  await driveCostQuotes(workspaceId, notes);

  if (target === "batch_ordered") {
    await driveBatchArrived(workspaceId, notes, {
      seedStoreSide: false,
      stopAfterOrdered: true,
      skuId,
    });
    return;
  }

  await driveBatchArrived(workspaceId, notes, { seedStoreSide, skuId });
  if (target === "batch_arrived_ready") return;

  await driveMarkSelling(workspaceId, skuId, notes);
}

async function seedClassicPath(
  workspaceId: string,
  stage: ClassicPreviewStage,
  notes: string[],
): Promise<void> {
  const target = classicStageIndex(stage);

  await driveDiscovery(workspaceId, notes);

  if (target >= classicStageIndex("accepted")) {
    await driveAccept(workspaceId, notes);
  }
  if (target >= classicStageIndex("sample_approved")) {
    await driveSampleApproved(workspaceId, notes);
  }
  if (target >= classicStageIndex("selling")) {
    await driveCostQuotes(workspaceId, notes);
  }
  if (target >= classicStageIndex("batch_arrived_ready")) {
    await driveBatchArrived(workspaceId, notes);
  }
  if (target >= classicStageIndex("selling")) {
    await driveSelling(workspaceId, notes);
  }
}

// ---------------------------------------------------------------------------
// Wave 1 multi-SKU fixtures
// ---------------------------------------------------------------------------

async function seedWave1(
  workspaceId: string,
  stage: Wave1PreviewStage,
  notes: string[],
): Promise<void> {
  switch (stage) {
    case "wave1_two_sku": {
      // 2 live selling SKUs + Mode C Topic A roll-up.
      await driveDiscovery(workspaceId, notes);
      await driveAccept(workspaceId, notes);
      await driveSkuPipeline(workspaceId, PREVIEW_SKU_ID, "selling", notes, {
        seedStoreSide: true,
      });
      await driveAcceptAnother(workspaceId, PREVIEW_SKU_ID_2, notes);
      await driveSkuPipeline(workspaceId, PREVIEW_SKU_ID_2, "selling", notes, {
        seedStoreSide: false,
      });
      await driveHealthyTopicAWeeks(workspaceId, 4, notes, {
        startDate: "2026-03-17",
        skuLines: [
          {
            skuId: PREVIEW_SKU_ID,
            sold: 5,
            left: 80,
            sales: 5 * PREVIEW_COST_QUOTE.sellPrice,
          },
          {
            skuId: PREVIEW_SKU_ID_2,
            sold: 4,
            left: 70,
            sales: 4 * PREVIEW_COST_QUOTE.sellPrice,
          },
        ],
      });
      await generateKit(workspaceId, "monthly_refresh", true);
      await setActiveSku(workspaceId, PREVIEW_SKU_ID);
      notes.push(
        "Wave 1 two-SKU: hub + Mode C; both selling → Marketing Current = weekly refresh by design (use wave1_marketing_paths for per-SKU stage diffs).",
      );
      break;
    }
    case "wave1_beginner_blocked": {
      // Experience set at foundation; classic selling has only 4 weeks (<15).
      await seedClassicPath(workspaceId, "selling", notes);
      notes.push(
        "Wave 1 beginner blocked: experience=beginner, <15 healthy weeks — Add SKU hard-blocked.",
      );
      break;
    }
    case "wave1_ready_add": {
      await driveDiscovery(workspaceId, notes);
      await driveAccept(workspaceId, notes);
      await driveSkuPipeline(workspaceId, PREVIEW_SKU_ID, "selling", notes, {
        seedStoreSide: true,
      });
      await driveHealthyTopicAWeeks(
        workspaceId,
        ADD_SKU_HEALTHY_WEEKS_MIN,
        notes,
        { startDate: "2025-12-01" },
      );
      await generateKit(workspaceId, "monthly_refresh", true);
      notes.push(
        "Wave 1 ready-add: seeds 15 healthy Topic A weeks for add-SKU gate QA — re-seed another stage before clean path tests (weeks remain until wipe).",
      );
      break;
    }
    case "wave1_archived": {
      await driveDiscovery(workspaceId, notes);
      await driveAccept(workspaceId, notes);
      await driveSkuPipeline(workspaceId, PREVIEW_SKU_ID, "selling", notes, {
        seedStoreSide: true,
      });
      await driveClassicTopicAWeeks(workspaceId, notes);
      await driveAcceptAnother(workspaceId, PREVIEW_SKU_ID_2, notes);
      await driveSkuPipeline(
        workspaceId,
        PREVIEW_SKU_ID_2,
        "sample_approved",
        notes,
        { seedStoreSide: false },
      );
      const archived = await archiveSku(workspaceId, PREVIEW_SKU_ID_2);
      if (!archived.ok) {
        throw new Error(`preview: archiveSku failed (${archived.error})`);
      }
      await setActiveSku(workspaceId, PREVIEW_SKU_ID);
      notes.push(
        "Wave 1 archived: 1 live + 1 archived — restore visible on hub.",
      );
      break;
    }
    case "wave1_marketing_paths": {
      // Per-SKU Marketing QA: A selling (weekly refresh), B sample (intro),
      // C batch_ordered (pre-launch). Journeys must differ — no shop bleed.
      await driveDiscovery(workspaceId, notes);
      await driveAccept(workspaceId, notes);

      await driveSkuPipeline(workspaceId, PREVIEW_SKU_ID, "selling", notes, {
        seedStoreSide: true,
      });
      const refreshA = await generateKit(
        workspaceId,
        "monthly_refresh",
        true,
        PREVIEW_SKU_ID,
      );
      if (!refreshA.ok) {
        throw new Error(
          `preview: monthly_refresh for SKU A failed (${refreshA.error})`,
        );
      }
      notes.push(
        "SKU A (preview-sku-0001): selling + full kit path — Current = weekly refresh.",
      );

      await driveAcceptAnother(workspaceId, PREVIEW_SKU_ID_2, notes);
      await driveSkuPipeline(
        workspaceId,
        PREVIEW_SKU_ID_2,
        "sample_approved",
        notes,
        { seedStoreSide: false },
      );
      notes.push(
        "SKU B (preview-sku-0002): sample_approved + intro only — later stages locked.",
      );

      await driveAcceptAnother(workspaceId, PREVIEW_SKU_ID_3, notes);
      await driveSkuPipeline(
        workspaceId,
        PREVIEW_SKU_ID_3,
        "batch_ordered",
        notes,
        { seedStoreSide: false },
      );
      notes.push(
        "SKU C (preview-sku-0003): batch_ordered + pre-launch — Current = pre_launch.",
      );

      await setActiveSku(workspaceId, PREVIEW_SKU_ID);
      notes.push(
        "Wave 1 marketing paths: on Marketing, switch A→B→C — each SKU’s own Current/unlocks.",
      );
      break;
    }
    default: {
      const _exhaustive: never = stage;
      throw new Error(`preview: unknown wave1 stage ${_exhaustive}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Public entry
// ---------------------------------------------------------------------------

export async function seedPreview(stage: PreviewStage): Promise<SeedResult> {
  ensureMigrated();
  const notes: string[] = [];

  const identity = resolvePreviewIdentity(await readPreviewIdentity());
  await resetPreviewData();

  const experience: ExperienceLevel =
    stage === "wave1_beginner_blocked" || stage === "wave1_ready_add"
      ? "beginner"
      : "some";

  const { userId, workspaceId } = await createFoundation(identity, experience);
  notes.push(
    `Created demo founder ${PREVIEW_EMAIL} with completed onboarding (experience=${experience}).`,
  );

  if (isWave1PreviewStage(stage)) {
    await seedWave1(workspaceId, stage, notes);
  } else {
    await seedClassicPath(workspaceId, stage, notes);
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
