import { and, eq, isNull } from "drizzle-orm";
import { db, ensureMigrated, schema, withTxResult } from "@/db";
import type { DbExecutor } from "@/db/executor";
import { TxRollback } from "@/db/executor";
import { newId, nowIso } from "@/lib/ids";
import { type ApprovalGateId, type PrimaryJourneyState } from "@/lib/constants";
import {
  GATE_DEFINITIONS,
  approvalPendingClaimSucceeded,
  checkTransitionApproval,
  evaluateApprovalDecision,
  gateTargetState,
  type ApprovalDecision,
  type TransitionGuardResult,
} from "@/lib/approvals/gates";
import { isAtOrPastOnSpine } from "@/lib/approvals/spine";
import { advanceJourney, getJourney } from "@/lib/memory/repos";
import { isPrimaryState, type FsmResult } from "@/lib/journey/fsm";
import { getSkuJourney, listLiveSkus } from "@/lib/sku/journey";
import { resolveAdvanceJourneySkuTarget } from "@/lib/sku/mutation-sku";
import { effectiveJourneyState } from "@/lib/sku/page-sections";
import {
  assertSkuOwned,
  resolveApprovalSkuId,
} from "@/lib/sku/ownership";

/**
 * Human Approvals engine — first-class approval records plus the server-side
 * transition guard. Approving a gate that guards a transition drives the
 * journey FSM forward; side-only gates simply record the decision.
 */

type ApprovalPayload = {
  requiredAcks: string[];
  data: Record<string, unknown>;
};

function parsePayload(raw: string): ApprovalPayload {
  try {
    const parsed = JSON.parse(raw) as Partial<ApprovalPayload>;
    return {
      requiredAcks: Array.isArray(parsed.requiredAcks)
        ? parsed.requiredAcks.map(String)
        : [],
      data:
        parsed.data && typeof parsed.data === "object"
          ? (parsed.data as Record<string, unknown>)
          : {},
    };
  } catch {
    return { requiredAcks: [], data: {} };
  }
}

function isUniqueViolation(err: unknown): boolean {
  const code =
    err && typeof err === "object" && "code" in err
      ? String((err as { code: unknown }).code)
      : "";
  return code === "23505";
}

export async function getApproval(id: string, exec: DbExecutor = db) {
  await ensureMigrated();
  return exec
    .select()
    .from(schema.approvalRequests)
    .where(eq(schema.approvalRequests.id, id))
    .then((rows) => rows[0]);
}

export async function listApprovals(workspaceId: string) {
  await ensureMigrated();
  return db
    .select()
    .from(schema.approvalRequests)
    .where(eq(schema.approvalRequests.workspaceId, workspaceId));
}

export async function listPendingApprovals(workspaceId: string) {
  await ensureMigrated();
  return db
    .select()
    .from(schema.approvalRequests)
    .where(
      and(
        eq(schema.approvalRequests.workspaceId, workspaceId),
        eq(schema.approvalRequests.status, "pending"),
      ),
    );
}

async function findPendingApproval(
  exec: DbExecutor,
  workspaceId: string,
  gateId: ApprovalGateId,
  skuId: string | null,
) {
  return exec
    .select()
    .from(schema.approvalRequests)
    .where(
      and(
        eq(schema.approvalRequests.workspaceId, workspaceId),
        eq(schema.approvalRequests.gateId, gateId),
        eq(schema.approvalRequests.status, "pending"),
        skuId
          ? eq(schema.approvalRequests.skuId, skuId)
          : isNull(schema.approvalRequests.skuId),
      ),
    )
    .then((rows) => rows[0]);
}

/**
 * Open (or return the existing pending) approval request for a gate. A gate has
 * at most one pending request per workspace+sku so the inbox never shows dupes.
 * Enforced by partial unique index + select-then-insert with 23505 retry.
 */
export async function createApprovalRequest(
  workspaceId: string,
  gateId: ApprovalGateId,
  opts: {
    data?: Record<string, unknown>;
    requiredAcks?: readonly string[];
    skuId?: string | null;
    exec?: DbExecutor;
  } = {},
) {
  await ensureMigrated();
  const exec = opts.exec ?? db;

  const skuId = opts.skuId ?? null;
  if (skuId) {
    const owned = await assertSkuOwned(workspaceId, skuId, exec);
    if (!owned.ok) return null;
  }

  const existing = await findPendingApproval(exec, workspaceId, gateId, skuId);
  if (existing) return existing;

  const requiredAcks = [
    ...(opts.requiredAcks ?? GATE_DEFINITIONS[gateId].requiredAcks),
  ];
  const id = newId();
  // Never copy client-injected data.skuId unless it matches the verified opts.skuId.
  const rawData = { ...(opts.data ?? {}) };
  delete rawData.skuId;
  const payload: ApprovalPayload = {
    requiredAcks,
    data: { ...rawData, ...(skuId ? { skuId } : {}) },
  };

  try {
    await exec.insert(schema.approvalRequests).values({
      id,
      workspaceId,
      skuId,
      gateId,
      status: "pending",
      payload: JSON.stringify(payload),
      acknowledgements: "[]",
      decisionNote: null,
      decidedAt: null,
      createdAt: nowIso(),
    });
  } catch (err) {
    // Concurrent create lost the race — return the winner's pending row.
    if (isUniqueViolation(err)) {
      const raced = await findPendingApproval(
        exec,
        workspaceId,
        gateId,
        skuId,
      );
      if (raced) return raced;
    }
    throw err;
  }

  return getApproval(id, exec);
}

export type DecideApprovalResult =
  | {
      ok: true;
      status: "approved" | "rejected";
      /** FSM result when approval drove a journey transition. */
      transition?: FsmResult;
    }
  | {
      ok: false;
      error:
        | "not_found"
        | "already_decided"
        | "missing_acknowledgements"
        | "transition_failed";
      missing?: string[];
      /** Present when the guarded FSM advance failed. */
      transition?: FsmResult;
    };

/**
 * CAS: claim pending → decided. 0 rows means a concurrent decide already won.
 */
async function commitApprovalRow(
  exec: DbExecutor,
  id: string,
  outcome: {
    status: "approved" | "rejected";
    acknowledgements: string[];
    decisionNote: string | null;
  },
): Promise<boolean> {
  const updated = await exec
    .update(schema.approvalRequests)
    .set({
      status: outcome.status,
      acknowledgements: JSON.stringify(outcome.acknowledgements),
      decisionNote: outcome.decisionNote,
      decidedAt: nowIso(),
    })
    .where(
      and(
        eq(schema.approvalRequests.id, id),
        eq(schema.approvalRequests.status, "pending"),
      ),
    )
    .returning({ id: schema.approvalRequests.id });
  return approvalPendingClaimSucceeded(updated.length);
}

/**
 * Decide an approval request. On approval of a transition gate, applies the
 * FSM advance for the guarded target state — atomically with the approval row
 * when advancing (or when `opts.exec` joins an outer transaction).
 */
export async function decideApproval(
  id: string,
  decision: ApprovalDecision,
  opts: { exec?: DbExecutor } = {},
): Promise<DecideApprovalResult> {
  await ensureMigrated();

  const outer = opts.exec;
  const row = await getApproval(id, outer ?? db);
  if (!row) return { ok: false, error: "not_found" };

  const { requiredAcks } = parsePayload(row.payload);
  const outcome = evaluateApprovalDecision(
    { status: row.status as "pending" | "approved" | "rejected" },
    requiredAcks,
    decision,
  );
  if (!outcome.ok) return outcome;

  // Rejects and side-only gates only need the approval row updated.
  if (outcome.status === "rejected") {
    const claimed = await commitApprovalRow(outer ?? db, id, outcome);
    if (!claimed) return { ok: false, error: "already_decided" };
    return { ok: true, status: "rejected" };
  }

  const target = gateTargetState(row.gateId as ApprovalGateId);

  // Transition gates: advance first; only commit approval if the FSM accepts.
  // If already at/past the target (e.g. warm-backup sample while selling),
  // record the approval without moving the primary spine.
  // Journey advance + pending CAS share one transaction (rollback on CAS miss).
  if (target && isPrimaryState(target)) {
    const payload = parsePayload(row.payload);
    const skuFromPayload =
      typeof payload.data.skuId === "string" ? payload.data.skuId : null;
    const candidateSkuId = resolveApprovalSkuId({
      rowSkuId: row.skuId,
      payloadSkuId: skuFromPayload,
    });

    const runExec = outer ?? db;

    let skuId: string | undefined;
    if (candidateSkuId) {
      const owned = await assertSkuOwned(
        row.workspaceId,
        candidateSkuId,
        runExec,
      );
      if (!owned.ok) {
        return { ok: false, error: "not_found" };
      }
      skuId = candidateSkuId;
    } else {
      // Transition gates must not soft-advance activeSkuId in multi-SKU shops.
      // Zero live SKUs → legacy workspace advance (accept_product first-SKU).
      // Live SKUs + null row.skuId → fail closed (add-SKU tolerates transition_failed).
      const live = await listLiveSkus(row.workspaceId, runExec);
      const targetSku = resolveAdvanceJourneySkuTarget({
        skuId: undefined,
        liveCount: live.length,
      });
      if (!targetSku.ok) {
        return {
          ok: false,
          error: "transition_failed",
          transition: { ok: false, error: "invalid_transition" },
        };
      }
    }

    const runAdvanceAndCommit = async (
      exec: DbExecutor,
    ): Promise<DecideApprovalResult> => {
      let currentPrimary: string | null = null;
      if (skuId) {
        const sj = await getSkuJourney(skuId, exec);
        if (sj) {
          currentPrimary = effectiveJourneyState({
            primaryState: sj.primaryState,
            pausedFromState: sj.pausedFromState,
          });
        }
      }
      if (!currentPrimary) {
        const j = await getJourney(row.workspaceId);
        currentPrimary = j
          ? effectiveJourneyState({
              primaryState: j.primaryState,
              pausedFromState: j.pausedFromState,
            })
          : null;
      }

      if (currentPrimary && isAtOrPastOnSpine(currentPrimary, target)) {
        const claimed = await commitApprovalRow(exec, id, outcome);
        if (!claimed) {
          throw new TxRollback({
            ok: false as const,
            error: "already_decided" as const,
          });
        }
        return { ok: true, status: "approved" };
      }

      const transition = await advanceJourney(
        row.workspaceId,
        target,
        skuId,
        exec,
      );
      if (!transition.ok) {
        throw new TxRollback({
          ok: false as const,
          error: "transition_failed" as const,
          transition,
        });
      }

      const claimed = await commitApprovalRow(exec, id, outcome);
      if (!claimed) {
        // Undo journey advance — concurrent decide already claimed this row.
        throw new TxRollback({
          ok: false as const,
          error: "already_decided" as const,
        });
      }
      return { ok: true, status: "approved", transition };
    };

    if (outer) {
      try {
        return await runAdvanceAndCommit(outer);
      } catch (err) {
        if (err instanceof TxRollback) {
          return err.result as DecideApprovalResult;
        }
        throw err;
      }
    }

    return withTxResult<DecideApprovalResult>(
      (tx) => runAdvanceAndCommit(tx),
      () => ({ ok: false, error: "transition_failed" }),
    );
  }

  // Side-only gate: no journey transition.
  const claimed = await commitApprovalRow(outer ?? db, id, outcome);
  if (!claimed) return { ok: false, error: "already_decided" };
  return { ok: true, status: "approved" };
}

// ---------------------------------------------------------------------------
// Server transition guard
// ---------------------------------------------------------------------------

/**
 * Server-side guard: is the workspace allowed to reach `to`? Requires an
 * approved request for the guarding gate (side-only targets always pass).
 */
export async function assertCanTransition(
  workspaceId: string,
  to: PrimaryJourneyState,
): Promise<TransitionGuardResult> {
  await ensureMigrated();
  const approvals = await db
    .select({
      gateId: schema.approvalRequests.gateId,
      status: schema.approvalRequests.status,
    })
    .from(schema.approvalRequests)
    .where(eq(schema.approvalRequests.workspaceId, workspaceId));
  return checkTransitionApproval(to, approvals);
}

export type GuardedAdvanceResult =
  | { ok: true; transition: FsmResult }
  | { ok: false; error: "approval_required"; gate: ApprovalGateId };

/**
 * Advance the journey only when the guarding gate is approved. This is the
 * entry point agents/actions should use instead of the raw FSM advance.
 */
export async function guardedAdvanceJourney(
  workspaceId: string,
  to: PrimaryJourneyState,
  skuId?: string,
): Promise<GuardedAdvanceResult> {
  await ensureMigrated();
  const guard = await assertCanTransition(workspaceId, to);
  if (!guard.ok) return guard;

  const transition = await advanceJourney(workspaceId, to, skuId);
  return { ok: true, transition };
}

export { getJourney };
