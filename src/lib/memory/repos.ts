import { eq } from "drizzle-orm";
import { db, ensureMigrated, schema } from "@/db";
import { nowIso } from "@/lib/ids";
import { enforceFounderEdit } from "@/lib/memory/allowed-fields";
import {
  planAdvance,
  planBlock,
  planPause,
  planResume,
  planUnblock,
  type FsmResult,
  type JourneyView,
} from "@/lib/journey/fsm";
import type { JourneyState } from "@/lib/constants";

/**
 * Repositories for the Shared Business Memory — the single source of truth for
 * a workspace. Reads are unrestricted. Writes come in two flavours:
 *
 *  - `systemWrite*` helpers: used by agents / server actions, no field limits.
 *  - `founderEdit*` helpers: enforce the allowed-field policy so founders can
 *    only touch the fields they own.
 *
 * Journey transitions go through the pure FSM in `@/lib/journey/fsm` and are
 * persisted atomically here.
 */

export async function getWorkspace(workspaceId: string) {
  ensureMigrated();
  return db
    .select()
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId))
    .get();
}

export async function getWorkspaceForUser(userId: string) {
  ensureMigrated();
  return db
    .select()
    .from(schema.workspaces)
    .where(eq(schema.workspaces.founderUserId, userId))
    .get();
}

/** Full memory snapshot for a workspace — the shared source of truth read. */
export async function loadBusinessMemory(workspaceId: string) {
  ensureMigrated();

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
      .get(),
    db
      .select()
      .from(schema.journeyStates)
      .where(eq(schema.journeyStates.workspaceId, workspaceId))
      .get(),
    db
      .select()
      .from(schema.sideStatuses)
      .where(eq(schema.sideStatuses.workspaceId, workspaceId))
      .get(),
    db
      .select()
      .from(schema.skuCards)
      .where(eq(schema.skuCards.workspaceId, workspaceId))
      .all(),
    db
      .select()
      .from(schema.supplierOptions)
      .where(eq(schema.supplierOptions.workspaceId, workspaceId))
      .all(),
    db
      .select()
      .from(schema.sampleRecords)
      .where(eq(schema.sampleRecords.workspaceId, workspaceId))
      .all(),
    db
      .select()
      .from(schema.storeReadiness)
      .where(eq(schema.storeReadiness.workspaceId, workspaceId))
      .get(),
    db
      .select()
      .from(schema.marketingKits)
      .where(eq(schema.marketingKits.workspaceId, workspaceId))
      .all(),
    db
      .select()
      .from(schema.topicAEntries)
      .where(eq(schema.topicAEntries.workspaceId, workspaceId))
      .all(),
    db
      .select()
      .from(schema.financeVerdicts)
      .where(eq(schema.financeVerdicts.workspaceId, workspaceId))
      .all(),
    db
      .select()
      .from(schema.approvalRequests)
      .where(eq(schema.approvalRequests.workspaceId, workspaceId))
      .all(),
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
// Journey FSM persistence
// ---------------------------------------------------------------------------

export async function getJourney(workspaceId: string) {
  ensureMigrated();
  return db
    .select()
    .from(schema.journeyStates)
    .where(eq(schema.journeyStates.workspaceId, workspaceId))
    .get();
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

async function runTransition(
  workspaceId: string,
  plan: (view: JourneyView) => FsmResult,
): Promise<FsmResult> {
  ensureMigrated();
  const row = await getJourney(workspaceId);
  if (!row) return { ok: false, error: "invalid_transition" };

  const result = plan(toJourneyView(row));
  if (!result.ok) return result;

  await db
    .update(schema.journeyStates)
    .set({ ...result.patch, updatedAt: nowIso() })
    .where(eq(schema.journeyStates.id, row.id));

  return result;
}

export function advanceJourney(workspaceId: string, to: JourneyState) {
  return runTransition(workspaceId, (view) => planAdvance(view, to));
}

export function pauseJourney(workspaceId: string) {
  return runTransition(workspaceId, planPause);
}

export function resumeJourney(workspaceId: string) {
  return runTransition(workspaceId, planResume);
}

export function blockJourney(workspaceId: string, reason: string) {
  return runTransition(workspaceId, (view) => planBlock(view, reason));
}

export function unblockJourney(workspaceId: string) {
  return runTransition(workspaceId, planUnblock);
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
  ensureMigrated();
  const clean = enforceFounderEdit("workspace", patch);
  if (Object.keys(clean).length === 0) return;
  await db
    .update(schema.workspaces)
    .set(clean)
    .where(eq(schema.workspaces.id, workspaceId));
}

/** Founder edit of a SKU card — only free-text founder notes are editable. */
export async function founderEditSkuCard(skuId: string, patch: SkuCardEdit) {
  ensureMigrated();
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
  ensureMigrated();
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
  ensureMigrated();
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
  ensureMigrated();
  const clean = enforceFounderEdit("onboardingProfile", patch);
  if (Object.keys(clean).length === 0) return;
  await db
    .update(schema.onboardingProfiles)
    .set({ ...clean, updatedAt: nowIso() })
    .where(eq(schema.onboardingProfiles.workspaceId, workspaceId));
}
