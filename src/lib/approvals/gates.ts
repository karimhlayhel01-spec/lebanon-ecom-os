import {
  type ApprovalGateId,
  type PrimaryJourneyState,
} from "@/lib/constants";

/**
 * Human Approval gates — the enforceable checkpoints that stand between the
 * founder and a state transition or irreversible action.
 *
 * This module is pure (no DB, no I/O): it declares which gate guards each
 * journey transition, which acknowledgements a gate requires, and the reducers
 * that decide an approval and check a transition guard. The DB-backed engine in
 * `@/lib/approvals/engine` composes these with persistence.
 */

export type GateDefinition = {
  gateId: ApprovalGateId;
  /** Forward primary state this gate unlocks, or null for side-only gates. */
  targetState: PrimaryJourneyState | null;
  /** Acknowledgements required by default before this gate can be approved. */
  requiredAcks: readonly string[];
};

export const GATE_DEFINITIONS: Record<ApprovalGateId, GateDefinition> = {
  accept_product: {
    gateId: "accept_product",
    targetState: "supplier_sample",
    // Okay-strength products add "okay_risk_read" at request creation time.
    requiredAcks: [],
  },
  tier1_customize_or_drop: {
    gateId: "tier1_customize_or_drop",
    targetState: null,
    requiredAcks: ["tier1_choice"],
  },
  sample_decision: {
    gateId: "sample_decision",
    targetState: "sample_approved",
    requiredAcks: [],
  },
  stuck_over_10k_path_c: {
    gateId: "stuck_over_10k_path_c",
    targetState: null,
    requiredAcks: ["cash_ack", "risk_ack"],
  },
  batch_ordered: {
    gateId: "batch_ordered",
    // Requires sample approved; does NOT require store_ready.
    targetState: "batch_ordered",
    requiredAcks: [],
  },
  batch_arrived_ready: {
    gateId: "batch_arrived_ready",
    targetState: "batch_arrived_ready",
    requiredAcks: ["inventory_ack"],
  },
  store_ready: {
    gateId: "store_ready",
    // Side status only — never a prerequisite for batch/selling transitions.
    targetState: null,
    requiredAcks: [],
  },
  start_launch_marketing: {
    gateId: "start_launch_marketing",
    targetState: null,
    requiredAcks: ["budget_rules_ack"],
  },
  mark_selling: {
    gateId: "mark_selling",
    targetState: "selling",
    requiredAcks: [],
  },
  reorder_ordered: {
    gateId: "reorder_ordered",
    // Side-only — primary stays selling; never re-enters batch_ordered.
    targetState: null,
    // weak_economics_ack added at request time for some/experienced when needed.
    requiredAcks: [],
  },
  reorder_arrived: {
    gateId: "reorder_arrived",
    targetState: null,
    requiredAcks: ["inventory_ack"],
  },
  reorder_crisis_skip: {
    gateId: "reorder_crisis_skip",
    targetState: null,
    requiredAcks: ["reorder_skip_sample_ack"],
  },
};

/** Primary state → the single gate that guards reaching it (if any). */
const TARGET_STATE_GATE: Partial<Record<PrimaryJourneyState, ApprovalGateId>> = {
  supplier_sample: "accept_product",
  sample_approved: "sample_decision",
  batch_ordered: "batch_ordered",
  batch_arrived_ready: "batch_arrived_ready",
  selling: "mark_selling",
};

export function gateTargetState(
  gateId: ApprovalGateId,
): PrimaryJourneyState | null {
  return GATE_DEFINITIONS[gateId].targetState;
}

/**
 * The approval gate that must be approved to reach `to`, or null when the
 * transition needs no approval (e.g. focusing store setup).
 */
export function gateForTransition(to: PrimaryJourneyState): ApprovalGateId | null {
  return TARGET_STATE_GATE[to] ?? null;
}

// ---------------------------------------------------------------------------
// Pure reducers
// ---------------------------------------------------------------------------

export type ApprovalStatus = "pending" | "approved" | "rejected";

export type ApprovalDecision =
  | { type: "approve"; acknowledgements: string[]; note?: string | null }
  | { type: "reject"; note?: string | null };

export type ApprovalDecisionResult =
  | {
      ok: true;
      status: Extract<ApprovalStatus, "approved" | "rejected">;
      acknowledgements: string[];
      decisionNote: string | null;
    }
  | {
      ok: false;
      error: "already_decided" | "missing_acknowledgements";
      missing?: string[];
    };

/** Decide a pending approval, enforcing that required acknowledgements exist. */
export function evaluateApprovalDecision(
  current: { status: ApprovalStatus },
  requiredAcks: readonly string[],
  decision: ApprovalDecision,
): ApprovalDecisionResult {
  if (current.status !== "pending") {
    return { ok: false, error: "already_decided" };
  }

  if (decision.type === "reject") {
    return {
      ok: true,
      status: "rejected",
      acknowledgements: [],
      decisionNote: decision.note ?? null,
    };
  }

  const provided = new Set(decision.acknowledgements);
  const missing = requiredAcks.filter((ack) => !provided.has(ack));
  if (missing.length > 0) {
    return { ok: false, error: "missing_acknowledgements", missing };
  }

  return {
    ok: true,
    status: "approved",
    acknowledgements: decision.acknowledgements,
    decisionNote: decision.note ?? null,
  };
}

export type TransitionGuardResult =
  | { ok: true }
  | { ok: false; error: "approval_required"; gate: ApprovalGateId };

/**
 * Server transition guard: reaching `to` is only allowed when its guarding
 * gate has an approved request. Side-only targets (no gate) always pass.
 */
export function checkTransitionApproval(
  to: PrimaryJourneyState,
  approvals: readonly { gateId: string; status: string }[],
): TransitionGuardResult {
  const gate = TARGET_STATE_GATE[to];
  if (!gate) return { ok: true };

  const approved = approvals.some(
    (a) => a.gateId === gate && a.status === "approved",
  );
  return approved
    ? { ok: true }
    : { ok: false, error: "approval_required", gate };
}
