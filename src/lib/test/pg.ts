/**
 * Postgres integration harness.
 * Skips when DATABASE_URL is unset (unit CI). Loads `.env` via `@/db` import.
 */
import { eq } from "drizzle-orm";
import { db, ensureMigrated, schema } from "@/db";
import { deleteUserAndWorkspace } from "@/lib/account/delete-user";
import { newId, nowIso } from "@/lib/ids";

/** True when a real DATABASE_URL is configured (`.env` or process env). */
export function postgresIntegrationEnabled(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export type TestWorkspace = {
  userId: string;
  workspaceId: string;
  email: string;
  cleanup: () => Promise<void>;
};

/** Minimal onboarded workspace + empty shop (unique email per call). */
export async function createTestWorkspace(
  label = "it",
): Promise<TestWorkspace> {
  await ensureMigrated();
  const now = nowIso();
  const userId = newId();
  const workspaceId = newId();
  const email = `it-${label}-${userId.slice(0, 10)}@example.test`;

  await db.insert(schema.users).values({
    id: userId,
    email,
    passwordHash: "test-hash",
    name: "IT Founder",
    firstName: "IT",
    lastName: "Founder",
    createdAt: now,
  });

  await db.insert(schema.workspaces).values({
    id: workspaceId,
    founderUserId: userId,
    name: `IT ${label}`,
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
    costQuotesSaved: false,
    discoveryExhaustedRounds: 0,
    experienceRaisedPendingAck: false,
    updatedAt: now,
  });

  await db.insert(schema.onboardingProfiles).values({
    id: newId(),
    workspaceId,
    budgetUsd: 3000,
    monthlyFollowOnBudget: 500,
    hoursPerWeek: 10,
    experience: "beginner",
    uiLanguage: "en",
    storageDescription: "test storage",
    storageLimits: "",
    riskTolerance: "medium",
    categoryLikes: JSON.stringify(["home_kitchen"]),
    lebanonSellabilityAck: true,
    codComfort: "ok",
    shopifyStatus: "not_started",
    maxLandedCost: 25,
    deliveryBandDays: "7-10",
    sampleClearanceReady: false,
    completedAt: now,
    updatedAt: now,
  });

  return {
    userId,
    workspaceId,
    email,
    cleanup: async () => {
      await deleteUserAndWorkspace(userId);
    },
  };
}

export type InsertLiveSkuOpts = {
  name?: string;
  primaryState?: string;
  batchArrivedReady?: boolean;
  founderNotes?: string;
  totalUnitsReceived?: number;
  unitsLeft?: number;
  reorderStatus?: string;
  reorderQty?: number | null;
  reorderSupplierId?: string | null;
};

/** Insert a live SKU + journey; sets workspace.activeSkuId. */
export async function insertLiveSku(
  workspaceId: string,
  opts: InsertLiveSkuOpts = {},
): Promise<{ skuId: string }> {
  await ensureMigrated();
  const now = nowIso();
  const skuId = newId();
  const received = opts.totalUnitsReceived ?? 100;
  const left = opts.unitsLeft ?? received;

  await db.insert(schema.skuCards).values({
    id: skuId,
    workspaceId,
    productCandidateId: null,
    name: opts.name ?? "IT SKU",
    basics: JSON.stringify({ sellPrice: 25 }),
    shipFitness: "{}",
    storageAmbiance: "{}",
    handling: "{}",
    importBatch: JSON.stringify({
      status: "arrived",
      suggestedFirstBatch: received,
      totalUnitsReceived: received,
      unitsLeft: left,
    }),
    moneySnapshot: JSON.stringify({
      sellPrice: 25,
      landedCost: 8,
      marginBefore: 0.68,
      marginAfter: 0.4,
      productCost: 5,
      intlShip: 2,
      clearanceTaxes: 1,
      localCourier: 2.5,
    }),
    quotedCosts: null,
    reportedMargin: null,
    marketingHooks: JSON.stringify({ hooks: [] }),
    founderNotes: opts.founderNotes ?? "",
    lifecycleStatus: "live",
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(schema.skuJourneys).values({
    id: newId(),
    workspaceId,
    skuId,
    primaryState: opts.primaryState ?? "selling",
    pausedFromState: null,
    blockedFromState: null,
    blockedReason: null,
    sampleStatus: "approved",
    batchOrdered: true,
    batchArrivedReady: opts.batchArrivedReady ?? true,
    batchArrivalEta: null,
    marketingStage: "none",
    costQuotesSaved: false,
    cashLockAck: false,
    stuckOver10kAck: false,
    okayRiskAck: false,
    tier1Resolved: true,
    reorderStatus: opts.reorderStatus ?? "idle",
    reorderArrivalEta: null,
    reorderSupplierId: opts.reorderSupplierId ?? null,
    reorderQty: opts.reorderQty ?? null,
    reorderEstCost: null,
    reorderPathSupplierId: null,
    reorderUnavailableJson: null,
    reorderCrisisSkipJson: null,
    updatedAt: now,
  });

  await db
    .update(schema.workspaces)
    .set({ activeSkuId: skuId })
    .where(eq(schema.workspaces.id, workspaceId));

  await db
    .update(schema.sideStatuses)
    .set({
      productAccepted: true,
      sampleStatus: "approved",
      batchOrdered: true,
      batchArrivedReady: true,
      updatedAt: now,
    })
    .where(eq(schema.sideStatuses.workspaceId, workspaceId));

  return { skuId };
}
