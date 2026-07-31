import { and, eq, ne } from "drizzle-orm";
import { db, ensureMigrated, schema } from "@/db";
import { newId, nowIso } from "@/lib/ids";
import type { JourneyState } from "@/lib/constants";
import {
  planAdvance,
  planBlock,
  planPause,
  planResume,
  planUnblock,
  type FsmResult,
  type JourneyView,
} from "@/lib/journey/fsm";

export type SkuLifecycleStatus = "live" | "archived" | "wiped";

export type SkuJourneyRow = typeof schema.skuJourneys.$inferSelect;

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

export async function getSkuJourney(skuId: string) {
  ensureMigrated();
  return db
    .select()
    .from(schema.skuJourneys)
    .where(eq(schema.skuJourneys.skuId, skuId))
    .get();
}

export async function listSkuJourneys(workspaceId: string) {
  ensureMigrated();
  return db
    .select()
    .from(schema.skuJourneys)
    .where(eq(schema.skuJourneys.workspaceId, workspaceId))
    .all();
}

export async function listLiveSkus(workspaceId: string) {
  ensureMigrated();
  return db
    .select()
    .from(schema.skuCards)
    .where(
      and(
        eq(schema.skuCards.workspaceId, workspaceId),
        eq(schema.skuCards.lifecycleStatus, "live"),
      ),
    )
    .all();
}

export async function listArchivedSkus(workspaceId: string) {
  ensureMigrated();
  return db
    .select()
    .from(schema.skuCards)
    .where(
      and(
        eq(schema.skuCards.workspaceId, workspaceId),
        eq(schema.skuCards.lifecycleStatus, "archived"),
      ),
    )
    .all();
}

export async function countLiveSkus(workspaceId: string): Promise<number> {
  const rows = await listLiveSkus(workspaceId);
  return rows.length;
}

/**
 * Create a sku_journeys row for a newly accepted SKU (post accept_product).
 */
export async function createSkuJourney(args: {
  workspaceId: string;
  skuId: string;
  primaryState?: JourneyState;
  okayRiskAck?: boolean;
}) {
  ensureMigrated();
  const existing = await getSkuJourney(args.skuId);
  if (existing) return existing;

  const id = newId();
  const now = nowIso();
  await db.insert(schema.skuJourneys).values({
    id,
    workspaceId: args.workspaceId,
    skuId: args.skuId,
    primaryState: args.primaryState ?? "supplier_sample",
    pausedFromState: null,
    blockedFromState: null,
    blockedReason: null,
    sampleStatus: "none",
    batchOrdered: false,
    batchArrivedReady: false,
    batchArrivalEta: null,
    marketingStage: "none",
    costQuotesSaved: false,
    cashLockAck: false,
    stuckOver10kAck: false,
    okayRiskAck: args.okayRiskAck ?? false,
    tier1Resolved: false,
    reorderStatus: "idle",
    reorderArrivalEta: null,
    reorderSupplierId: null,
    reorderQty: null,
    reorderEstCost: null,
    reorderPathSupplierId: null,
    reorderUnavailableJson: null,
    reorderCrisisSkipJson: null,
    updatedAt: now,
  });
  return getSkuJourney(args.skuId);
}

async function runSkuTransition(
  skuId: string,
  plan: (view: JourneyView) => FsmResult,
): Promise<FsmResult> {
  ensureMigrated();
  const row = await getSkuJourney(skuId);
  if (!row) return { ok: false, error: "invalid_transition" };

  const result = plan(toJourneyView(row));
  if (!result.ok) return result;

  await db
    .update(schema.skuJourneys)
    .set({ ...result.patch, updatedAt: nowIso() })
    .where(eq(schema.skuJourneys.id, row.id));

  // Keep legacy workspace journey_states in sync when this is the active SKU.
  await syncWorkspaceJourneyMirror(row.workspaceId, skuId, result.patch);

  return result;
}

async function syncWorkspaceJourneyMirror(
  workspaceId: string,
  skuId: string,
  patch: {
    primaryState: JourneyState;
    pausedFromState: string | null;
    blockedFromState: string | null;
    blockedReason: string | null;
  },
) {
  const workspace = await db
    .select()
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId))
    .get();
  if (!workspace || workspace.activeSkuId !== skuId) return;
  if (workspace.shopPaused) return;

  await db
    .update(schema.journeyStates)
    .set({ ...patch, updatedAt: nowIso() })
    .where(eq(schema.journeyStates.workspaceId, workspaceId));
}

export function advanceSkuJourney(skuId: string, to: JourneyState) {
  return runSkuTransition(skuId, (view) => planAdvance(view, to));
}

export function pauseSkuJourney(skuId: string) {
  return runSkuTransition(skuId, planPause);
}

export function resumeSkuJourney(skuId: string) {
  return runSkuTransition(skuId, planResume);
}

export function blockSkuJourney(skuId: string, reason: string) {
  return runSkuTransition(skuId, (view) => planBlock(view, reason));
}

export function unblockSkuJourney(skuId: string) {
  return runSkuTransition(skuId, planUnblock);
}

export async function patchSkuJourneyFlags(
  skuId: string,
  patch: Partial<{
    sampleStatus: string;
    batchOrdered: boolean;
    batchArrivedReady: boolean;
    batchArrivalEta: string | null;
    marketingStage: string;
    costQuotesSaved: boolean;
    cashLockAck: boolean;
    stuckOver10kAck: boolean;
    okayRiskAck: boolean;
    tier1Resolved: boolean;
    reorderStatus: string;
    reorderArrivalEta: string | null;
    reorderSupplierId: string | null;
    reorderQty: number | null;
    reorderEstCost: number | null;
    reorderPathSupplierId: string | null;
    reorderUnavailableJson: string | null;
    reorderCrisisSkipJson: string | null;
  }>,
) {
  ensureMigrated();
  await db
    .update(schema.skuJourneys)
    .set({ ...patch, updatedAt: nowIso() })
    .where(eq(schema.skuJourneys.skuId, skuId));
}

/** Effective UI state: shop pause overlays individual SKU state. */
export async function effectiveSkuPrimaryState(
  workspaceId: string,
  skuId: string,
): Promise<{
  primaryState: string;
  pausedFromState: string | null;
  shopPaused: boolean;
  skuPaused: boolean;
}> {
  ensureMigrated();
  const [workspace, journey] = await Promise.all([
    db
      .select()
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, workspaceId))
      .get(),
    getSkuJourney(skuId),
  ]);
  const shopPaused = !!workspace?.shopPaused;
  const skuPaused = journey?.primaryState === "paused";
  if (shopPaused) {
    return {
      primaryState: "paused",
      pausedFromState:
        journey?.primaryState === "paused"
          ? journey.pausedFromState
          : (journey?.primaryState ?? null),
      shopPaused: true,
      skuPaused,
    };
  }
  return {
    primaryState: journey?.primaryState ?? "discovery",
    pausedFromState: journey?.pausedFromState ?? null,
    shopPaused: false,
    skuPaused,
  };
}

export async function setShopPaused(workspaceId: string, paused: boolean) {
  ensureMigrated();
  await db
    .update(schema.workspaces)
    .set({ shopPaused: paused })
    .where(eq(schema.workspaces.id, workspaceId));

  // Mirror onto legacy journey_states for single-SKU UI paths.
  const workspace = await db
    .select()
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId))
    .get();
  if (!workspace?.activeSkuId) return;

  if (paused) {
    const j = await getSkuJourney(workspace.activeSkuId);
    if (!j) return;
    const from =
      j.primaryState === "paused"
        ? j.pausedFromState
        : j.primaryState;
    await db
      .update(schema.journeyStates)
      .set({
        primaryState: "paused",
        pausedFromState: from,
        blockedFromState: null,
        blockedReason: null,
        updatedAt: nowIso(),
      })
      .where(eq(schema.journeyStates.workspaceId, workspaceId));
  } else {
    const j = await getSkuJourney(workspace.activeSkuId);
    if (!j) return;
    await db
      .update(schema.journeyStates)
      .set({
        primaryState: j.primaryState,
        pausedFromState: j.pausedFromState,
        blockedFromState: j.blockedFromState,
        blockedReason: j.blockedReason,
        updatedAt: nowIso(),
      })
      .where(eq(schema.journeyStates.workspaceId, workspaceId));
  }
}

export async function pauseSelectedSkus(skuIds: string[]) {
  const results: FsmResult[] = [];
  for (const id of skuIds) {
    results.push(await pauseSkuJourney(id));
  }
  return results;
}

export async function resumeSelectedSkus(skuIds: string[]) {
  const results: FsmResult[] = [];
  for (const id of skuIds) {
    results.push(await resumeSkuJourney(id));
  }
  return results;
}

/** Resolve which SKU journey to use for legacy workspace-scoped callers. */
export async function resolveActiveSkuId(
  workspaceId: string,
): Promise<string | null> {
  ensureMigrated();
  const workspace = await db
    .select()
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId))
    .get();
  if (workspace?.activeSkuId) {
    const card = await db
      .select()
      .from(schema.skuCards)
      .where(
        and(
          eq(schema.skuCards.id, workspace.activeSkuId),
          ne(schema.skuCards.lifecycleStatus, "wiped"),
        ),
      )
      .get();
    if (card && card.lifecycleStatus === "live") return card.id;
  }
  const live = await listLiveSkus(workspaceId);
  return live[0]?.id ?? null;
}
