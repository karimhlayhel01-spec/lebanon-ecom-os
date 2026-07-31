import { eq } from "drizzle-orm";
import { db, ensureMigrated, schema } from "@/db";
import { nowIso } from "@/lib/ids";
import { enforceFounderEdit } from "@/lib/memory/allowed-fields";
import {
  planAdvance,
  planBlock,
  planUnblock,
  type FsmResult,
  type JourneyView,
} from "@/lib/journey/fsm";
import type { JourneyState } from "@/lib/constants";
import {
  advanceSkuJourney,
  blockSkuJourney,
  getSkuJourney,
  pauseSkuJourney,
  resolveActiveSkuId,
  resumeSkuJourney,
  setShopPaused,
  unblockSkuJourney,
} from "@/lib/sku/journey";

/**
 * Repositories for the Shared Business Memory — the single source of truth for
 * a workspace. Reads are unrestricted. Writes come in two flavours:
 *
 *  - `systemWrite*` helpers: used by agents / server actions, no field limits.
 *  - `founderEdit*` helpers: enforce the allowed-field policy so founders can
 *    only touch the fields they own.
 *
 * Journey transitions go through the pure FSM in `@/lib/journey/fsm` and are
 * persisted on per-SKU journeys (Wave 1), with a legacy workspace mirror.
 */

export async function getWorkspace(workspaceId: string) {
  await ensureMigrated();
  return db
    .select()
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId))
    .then((rows) => rows[0]);
}

export async function getWorkspaceForUser(userId: string) {
  await ensureMigrated();
  return db
    .select()
    .from(schema.workspaces)
    .where(eq(schema.workspaces.founderUserId, userId))
    .then((rows) => rows[0]);
}

/** Full memory snapshot for a workspace — the shared source of truth read. */
export async function loadBusinessMemory(workspaceId: string) {
  await ensureMigrated();

  const [
    workspace,
    onboarding,
    journey,
    side,
    skuCards,
    suppliers,
    samples,
    store,
    marketingKits,
    topicA,
    financeVerdicts,
    approvals,
  ] = await Promise.all([
    getWorkspace(workspaceId),
    db
      .select()
      .from(schema.onboardingProfiles)
      .where(eq(schema.onboardingProfiles.workspaceId, workspaceId))
      .then((rows) => rows[0]),
    getJourney(workspaceId),
    db
      .select()
      .from(schema.sideStatuses)
      .where(eq(schema.sideStatuses.workspaceId, workspaceId))
      .then((rows) => rows[0]),
    db
      .select()
      .from(schema.skuCards)
      .where(eq(schema.skuCards.workspaceId, workspaceId)),
    db
      .select()
      .from(schema.supplierOptions)
      .where(eq(schema.supplierOptions.workspaceId, workspaceId)),
    db
      .select()
      .from(schema.sampleRecords)
      .where(eq(schema.sampleRecords.workspaceId, workspaceId)),
    db
      .select()
      .from(schema.storeReadiness)
      .where(eq(schema.storeReadiness.workspaceId, workspaceId))
      .then((rows) => rows[0]),
    db
      .select()
      .from(schema.marketingKits)
      .where(eq(schema.marketingKits.workspaceId, workspaceId)),
    db
      .select()
      .from(schema.topicAEntries)
      .where(eq(schema.topicAEntries.workspaceId, workspaceId)),
    db
      .select()
      .from(schema.financeVerdicts)
      .where(eq(schema.financeVerdicts.workspaceId, workspaceId)),
    db
      .select()
      .from(schema.approvalRequests)
      .where(eq(schema.approvalRequests.workspaceId, workspaceId)),
  ]);

  return {
    workspace,
    onboarding,
    journey,
    side,
    skuCards,
    suppliers,
    samples,
    store,
    marketingKits,
    topicA,
    financeVerdicts,
    approvals,
  };
}

// ---------------------------------------------------------------------------
// Journey FSM persistence (Wave 1: per-SKU with workspace fallback)
// ---------------------------------------------------------------------------

export async function getJourney(workspaceId: string) {
  await ensureMigrated();
  const workspace = await getWorkspace(workspaceId);
  if (workspace?.shopPaused) {
    const skuId = await resolveActiveSkuId(workspaceId);
    const skuJourney = skuId ? await getSkuJourney(skuId) : null;
    return {
      id: "shop-paused",
      workspaceId,
      primaryState: "paused",
      pausedFromState:
        skuJourney?.primaryState === "paused"
          ? skuJourney.pausedFromState
          : (skuJourney?.primaryState ?? "discovery"),
      blockedFromState: null,
      blockedReason: null,
      updatedAt: nowIso(),
    };
  }

  const skuId = await resolveActiveSkuId(workspaceId);
  if (skuId) {
    const skuJourney = await getSkuJourney(skuId);
    if (skuJourney) {
      return {
        id: skuJourney.id,
        workspaceId,
        primaryState: skuJourney.primaryState,
        pausedFromState: skuJourney.pausedFromState,
        blockedFromState: skuJourney.blockedFromState,
        blockedReason: skuJourney.blockedReason,
        updatedAt: skuJourney.updatedAt,
      };
    }
  }

  return db
    .select()
    .from(schema.journeyStates)
    .where(eq(schema.journeyStates.workspaceId, workspaceId))
    .then((rows) => rows[0]);
}

export async function getJourneyForSku(workspaceId: string, skuId: string) {
  await ensureMigrated();
  const workspace = await getWorkspace(workspaceId);
  const skuJourney = await getSkuJourney(skuId);
  if (!skuJourney) return null;
  if (workspace?.shopPaused) {
    return {
      ...skuJourney,
      primaryState: "paused",
      pausedFromState:
        skuJourney.primaryState === "paused"
          ? skuJourney.pausedFromState
          : skuJourney.primaryState,
    };
  }
  return skuJourney;
}

function toJourneyView(row: {
  primaryState: string;
  pausedFromState: string | null;
  blockedFromState: string | null;
  blockedReason: string | null;
}): JourneyView {
  return {
    primaryState: row.primaryState as JourneyState,
    pausedFromState: row.pausedFromState,
    blockedFromState: row.blockedFromState,
    blockedReason: row.blockedReason,
  };
}

async function runWorkspaceLegacyTransition(
  workspaceId: string,
  plan: (view: JourneyView) => FsmResult,
): Promise<FsmResult> {
  await ensureMigrated();
  const row = await db
    .select()
    .from(schema.journeyStates)
    .where(eq(schema.journeyStates.workspaceId, workspaceId))
    .then((rows) => rows[0]);
  if (!row) return { ok: false, error: "invalid_transition" };

  const result = plan(toJourneyView(row));
  if (!result.ok) return result;

  await db
    .update(schema.journeyStates)
    .set({ ...result.patch, updatedAt: nowIso() })
    .where(eq(schema.journeyStates.id, row.id));

  return result;
}

/**
 * Advance the active SKU journey (or workspace legacy when no live SKU).
 * Prefer `advanceSkuJourney` / skuId overload for multi-SKU callers.
 */
export async function advanceJourney(
  workspaceId: string,
  to: JourneyState,
  skuId?: string,
): Promise<FsmResult> {
  const targetSku = skuId ?? (await resolveActiveSkuId(workspaceId));
  if (targetSku) {
    return advanceSkuJourney(targetSku, to);
  }
  return runWorkspaceLegacyTransition(workspaceId, (view) =>
    planAdvance(view, to),
  );
}

/** Shop-wide pause (Wave 1). */
export async function pauseJourney(workspaceId: string): Promise<FsmResult> {
  await setShopPaused(workspaceId, true);
  return {
    ok: true,
    patch: {
      primaryState: "paused",
      pausedFromState: "discovery",
      blockedFromState: null,
      blockedReason: null,
    },
  };
}

/** Resume shop-wide pause. */
export async function resumeJourney(workspaceId: string): Promise<FsmResult> {
  await setShopPaused(workspaceId, false);
  const journey = await getJourney(workspaceId);
  if (!journey) return { ok: false, error: "not_paused" };
  return {
    ok: true,
    patch: {
      primaryState: journey.primaryState as JourneyState,
      pausedFromState: null,
      blockedFromState: null,
      blockedReason: null,
    },
  };
}

export async function blockJourney(workspaceId: string, reason: string) {
  const skuId = await resolveActiveSkuId(workspaceId);
  if (skuId) return blockSkuJourney(skuId, reason);
  return runWorkspaceLegacyTransition(workspaceId, (view) =>
    planBlock(view, reason),
  );
}

export async function unblockJourney(workspaceId: string) {
  const skuId = await resolveActiveSkuId(workspaceId);
  if (skuId) return unblockSkuJourney(skuId);
  return runWorkspaceLegacyTransition(workspaceId, planUnblock);
}

/** Pause one or more SKUs (not shop-wide). */
export async function pauseSkuJourneys(skuIds: string[]) {
  const results = [];
  for (const id of skuIds) {
    results.push(await pauseSkuJourney(id));
  }
  return results;
}

export async function resumeSkuJourneys(skuIds: string[]) {
  const results = [];
  for (const id of skuIds) {
    results.push(await resumeSkuJourney(id));
  }
  return results;
}

// ---------------------------------------------------------------------------
// Founder allowed-field edits
// ---------------------------------------------------------------------------

type WorkspaceEdit = Partial<{ name: string; language: string }>;
type SkuCardEdit = Partial<{ founderNotes: string }>;
type MarketingKitEdit = Partial<{ items: string }>;
type StoreReadinessEdit = Partial<{
  checklist: string;
  storeUrl: string | null;
  whatsappNumber: string | null;
  courierChoice: string | null;
}>;
type OnboardingEdit = Partial<{
  budgetUsd: number;
  monthlyFollowOnBudget: number;
  hoursPerWeek: number;
  experience: string;
  uiLanguage: string;
  storageDescription: string;
  storageLimits: string;
  riskTolerance: string;
  categoryLikes: string;
  codComfort: string;
  shopifyStatus: string;
  maxLandedCost: number;
  deliveryBandDays: string;
  sampleClearanceReady: boolean;
}>;

/** Founder edit of workspace fields (name, language). Throws on disallowed. */
export async function founderEditWorkspace(
  workspaceId: string,
  patch: WorkspaceEdit,
) {
  await ensureMigrated();
  const clean = enforceFounderEdit("workspace", patch);
  if (Object.keys(clean).length === 0) return;
  await db
    .update(schema.workspaces)
    .set(clean)
    .where(eq(schema.workspaces.id, workspaceId));
}

/** Founder edit of a SKU card — only free-text founder notes are editable. */
export async function founderEditSkuCard(skuId: string, patch: SkuCardEdit) {
  await ensureMigrated();
  const clean = enforceFounderEdit("skuCard", patch);
  if (Object.keys(clean).length === 0) return;
  await db
    .update(schema.skuCards)
    .set({ ...clean, updatedAt: nowIso() })
    .where(eq(schema.skuCards.id, skuId));
}

/** Founder edit of a marketing kit — only the creative `items` are editable. */
export async function founderEditMarketingKit(
  kitId: string,
  patch: MarketingKitEdit,
) {
  await ensureMigrated();
  const clean = enforceFounderEdit("marketingKit", patch);
  if (Object.keys(clean).length === 0) return;
  await db
    .update(schema.marketingKits)
    .set({ ...clean, updatedAt: nowIso() })
    .where(eq(schema.marketingKits.id, kitId));
}

/** Founder edit of store-readiness marks (checklist, URLs, courier). */
export async function founderEditStoreReadiness(
  workspaceId: string,
  patch: StoreReadinessEdit,
) {
  await ensureMigrated();
  const clean = enforceFounderEdit("storeReadiness", patch);
  if (Object.keys(clean).length === 0) return;
  await db
    .update(schema.storeReadiness)
    .set({ ...clean, updatedAt: nowIso() })
    .where(eq(schema.storeReadiness.workspaceId, workspaceId));
}

/** Founder edit of onboarding preferences. Throws on disallowed fields. */
export async function founderEditOnboardingProfile(
  workspaceId: string,
  patch: OnboardingEdit,
) {
  await ensureMigrated();
  const clean = enforceFounderEdit("onboardingProfile", patch);
  if (Object.keys(clean).length === 0) return;
  await db
    .update(schema.onboardingProfiles)
    .set({ ...clean, updatedAt: nowIso() })
    .where(eq(schema.onboardingProfiles.workspaceId, workspaceId));
}
