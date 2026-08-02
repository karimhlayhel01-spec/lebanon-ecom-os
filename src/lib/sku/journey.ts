import { and, eq, inArray, ne } from "drizzle-orm";
import { db, ensureMigrated, schema } from "@/db";
import type { DbExecutor } from "@/db/executor";
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

/** Index journey rows by skuId (last write wins if duplicates). */
export function mapSkuJourneysBySkuId(
  rows: readonly SkuJourneyRow[],
): Map<string, SkuJourneyRow> {
  return new Map(rows.map((r) => [r.skuId, r]));
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

export async function getSkuJourney(skuId: string, exec: DbExecutor = db) {
  await ensureMigrated();
  return exec
    .select()
    .from(schema.skuJourneys)
    .where(eq(schema.skuJourneys.skuId, skuId))
    .then((rows) => rows[0]);
}

export async function listSkuJourneys(workspaceId: string) {
  await ensureMigrated();
  return db
    .select()
    .from(schema.skuJourneys)
    .where(eq(schema.skuJourneys.workspaceId, workspaceId));
}

/**
 * One query for many SKUs’ journeys (hub chips / orchestration).
 * Prefer this over N× getSkuJourney when building hub status.
 */
export async function listSkuJourneysForSkus(
  skuIds: readonly string[],
): Promise<SkuJourneyRow[]> {
  await ensureMigrated();
  if (skuIds.length === 0) return [];
  return db
    .select()
    .from(schema.skuJourneys)
    .where(inArray(schema.skuJourneys.skuId, [...skuIds]));
}

export async function listLiveSkus(
  workspaceId: string,
  exec: DbExecutor = db,
) {
  await ensureMigrated();
  return exec
    .select()
    .from(schema.skuCards)
    .where(
      and(
        eq(schema.skuCards.workspaceId, workspaceId),
        eq(schema.skuCards.lifecycleStatus, "live"),
      ),
    );
}

export async function listArchivedSkus(workspaceId: string) {
  await ensureMigrated();
  return db
    .select()
    .from(schema.skuCards)
    .where(
      and(
        eq(schema.skuCards.workspaceId, workspaceId),
        eq(schema.skuCards.lifecycleStatus, "archived"),
      ),
    )
    ;
}

export async function countLiveSkus(
  workspaceId: string,
  exec: DbExecutor = db,
): Promise<number> {
  const rows = await listLiveSkus(workspaceId, exec);
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
  await ensureMigrated();
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
  exec: DbExecutor = db,
): Promise<FsmResult> {
  await ensureMigrated();
  const row = await getSkuJourney(skuId, exec);
  if (!row) return { ok: false, error: "invalid_transition" };

  const result = plan(toJourneyView(row));
  if (!result.ok) return result;

  await exec
    .update(schema.skuJourneys)
    .set({ ...result.patch, updatedAt: nowIso() })
    .where(eq(schema.skuJourneys.id, row.id));

  // Keep legacy workspace journey_states in sync when this is the active SKU.
  await syncWorkspaceJourneyMirror(row.workspaceId, skuId, result.patch, exec);

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
  exec: DbExecutor = db,
) {
  const workspace = await exec
    .select()
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId))
    .then((rows) => rows[0]);
  if (!workspace || workspace.activeSkuId !== skuId) return;
  if (workspace.shopPaused) return;

  await exec
    .update(schema.journeyStates)
    .set({ ...patch, updatedAt: nowIso() })
    .where(eq(schema.journeyStates.workspaceId, workspaceId));
}

export function advanceSkuJourney(
  skuId: string,
  to: JourneyState,
  exec: DbExecutor = db,
) {
  return runSkuTransition(skuId, (view) => planAdvance(view, to), exec);
}

export function pauseSkuJourney(skuId: string, exec: DbExecutor = db) {
  return runSkuTransition(skuId, planPause, exec);
}

export function resumeSkuJourney(skuId: string, exec: DbExecutor = db) {
  return runSkuTransition(skuId, planResume, exec);
}

export function blockSkuJourney(
  skuId: string,
  reason: string,
  exec: DbExecutor = db,
) {
  return runSkuTransition(skuId, (view) => planBlock(view, reason), exec);
}

export function unblockSkuJourney(skuId: string, exec: DbExecutor = db) {
  return runSkuTransition(skuId, planUnblock, exec);
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
  exec: DbExecutor = db,
) {
  await ensureMigrated();
  await exec
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
  await ensureMigrated();
  const [workspace, journey] = await Promise.all([
    db
      .select()
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, workspaceId))
      .then((rows) => rows[0]),
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
  await ensureMigrated();
  await db
    .update(schema.workspaces)
    .set({ shopPaused: paused })
    .where(eq(schema.workspaces.id, workspaceId));

  // Mirror onto legacy journey_states for single-SKU UI paths.
  const workspace = await db
    .select()
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId))
    .then((rows) => rows[0]);
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

/**
 * Resolve which SKU journey to use for legacy workspace-scoped callers.
 *
 * `activeSkuId` is a soft preference pointer — NOT updated on /sku/[id] GET.
 * Intentional remaining uses (do not treat as page-scoped mutation target):
 * - Hub Tools / vocab / /sku redirect: which live SKU to deep-link by default
 * - Accept-product / archive / restore / wipe: maintain or clear the pointer
 * - Shop-level reads (getSkuView, journey mirror, hub Tools deep-links):
 *   fallback when the surface has no explicit page skuId (/finance, /supplier,
 *   /marketing shop tools, Mode C rollups)
 * Per-SKU pages and mutations must pass explicit owned skuId instead.
 */
export async function resolveActiveSkuId(
  workspaceId: string,
): Promise<string | null> {
  await ensureMigrated();
  const workspace = await db
    .select()
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId))
    .then((rows) => rows[0]);
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
      .then((rows) => rows[0]);
    if (card && card.lifecycleStatus === "live") return card.id;
  }
  const live = await listLiveSkus(workspaceId);
  return live[0]?.id ?? null;
}
