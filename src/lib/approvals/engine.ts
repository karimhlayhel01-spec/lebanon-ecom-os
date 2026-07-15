import { and, eq } from "drizzle-orm";
import { db, ensureMigrated, schema } from "@/db";
import { newId, nowIso } from "@/lib/ids";
import { type ApprovalGateId, type PrimaryJourneyState } from "@/lib/constants";
import {
  GATE_DEFINITIONS,
  checkTransitionApproval,
  evaluateApprovalDecision,
  gateTargetState,
  type ApprovalDecision,
  type TransitionGuardResult,
} from "@/lib/approvals/gates";
import { advanceJourney, getJourney } from "@/lib/memory/repos";
import { isPrimaryState, type FsmResult } from "@/lib/journey/fsm";

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

export async function getApproval(id: string) {
  ensureMigrated();
  return db
    .select()
    .from(schema.approvalRequests)
    .where(eq(schema.approvalRequests.id, id))
    .get();
}

export async function listApprovals(workspaceId: string) {
  ensureMigrated();
  return db
    .select()
    .from(schema.approvalRequests)
    .where(eq(schema.approvalRequests.workspaceId, workspaceId))
    .all();
}

export async function listPendingApprovals(workspaceId: string) {
  ensureMigrated();
  return db
    .select()
    .from(schema.approvalRequests)
    .where(
      and(
        eq(schema.approvalRequests.workspaceId, workspaceId),
        eq(schema.approvalRequests.status, "pending"),
      ),
    )
    .all();
}

/**
 * Open (or return the existing pending) approval request for a gate. A gate has
 * at most one pending request per workspace so the inbox never shows dupes.
 */
export async function createApprovalRequest(
  workspaceId: string,
  gateId: ApprovalGateId,
  opts: { data?: Record<string, unknown>; requiredAcks?: readonly string[] } = {},
) {
  ensureMigrated();

  const existing = await db
    .select()
    .from(schema.approvalRequests)
    .where(
      and(
        eq(schema.approvalRequests.workspaceId, workspaceId),
        eq(schema.approvalRequests.gateId, gateId),
        eq(schema.approvalRequests.status, "pending"),
      ),
    )
    .get();
  if (existing) return existing;

  const requiredAcks = [
    ...(opts.requiredAcks ?? GATE_DEFINITIONS[gateId].requiredAcks),
  ];
  const id = newId();
  const payload: ApprovalPayload = { requiredAcks, data: opts.data ?? {} };

  await db.insert(schema.approvalRequests).values({
    id,
    workspaceId,
    gateId,
    status: "pending",
    payload: JSON.stringify(payload),
    acknowledgements: "[]",
    decisionNote: null,
    decidedAt: null,
    createdAt: nowIso(),
  });

  return getApproval(id);
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
      error: "not_found" | "already_decided" | "missing_acknowledgements";
      missing?: string[];
    };

/**
 * Decide an approval request. On approval of a transition gate, applies the
 * FSM advance for the guarded target state.
 */
export async function decideApproval(
  id: string,
  decision: ApprovalDecision,
): Promise<DecideApprovalResult> {
  ensureMigrated();

  const row = await getApproval(id);
  if (!row) return { ok: false, error: "not_found" };

  const { requiredAcks } = parsePayload(row.payload);
  const outcome = evaluateApprovalDecision(
    { status: row.status as "pending" | "approved" | "rejected" },
    requiredAcks,
    decision,
  );
  if (!outcome.ok) return outcome;

  await db
    .update(schema.approvalRequests)
    .set({
      status: outcome.status,
      acknowledgements: JSON.stringify(outcome.acknowledgements),
      decisionNote: outcome.decisionNote,
      decidedAt: nowIso(),
    })
    .where(eq(schema.approvalRequests.id, id));

  if (outcome.status === "rejected") {
    return { ok: true, status: "rejected" };
  }

  const target = gateTargetState(row.gateId as ApprovalGateId);
  if (target && isPrimaryState(target)) {
    const transition = await advanceJourney(row.workspaceId, target);
    return { ok: true, status: "approved", transition };
  }

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
  ensureMigrated();
  const approvals = await db
    .select({
      gateId: schema.approvalRequests.gateId,
      status: schema.approvalRequests.status,
    })
    .from(schema.approvalRequests)
    .where(eq(schema.approvalRequests.workspaceId, workspaceId))
    .all();
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
): Promise<GuardedAdvanceResult> {
  ensureMigrated();
  const guard = await assertCanTransition(workspaceId, to);
  if (!guard.ok) return guard;

  const transition = await advanceJourney(workspaceId, to);
  return { ok: true, transition };
}

export { getJourney };
