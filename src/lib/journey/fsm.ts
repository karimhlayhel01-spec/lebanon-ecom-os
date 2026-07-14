import {
  PRIMARY_STATES,
  type JourneyState,
  type PrimaryJourneyState,
} from "@/lib/constants";

/**
 * Journey finite state machine for the Shared Business Memory.
 *
 * Coaching spine (linear):
 *   discovery → supplier_sample → sample_approved → store_setup
 *             → batch_ordered → batch_arrived_ready → selling
 *
 * `store_setup` is an optional focus: batch ordering requires `sample_approved`
 * but NOT `store_ready`, so `sample_approved` may advance straight to
 * `batch_ordered`. `paused` and `blocked` are overlays that remember the prior
 * primary state so it can be restored without losing journey context.
 *
 * This module is intentionally pure (no DB, no I/O) so transitions are fully
 * unit-testable. Approval gating on transitions is layered on later (M2).
 */

export const JOURNEY_SPINE = PRIMARY_STATES;

/** Allowed forward moves along the coaching spine, keyed by current state. */
export const FORWARD_TRANSITIONS: Record<
  PrimaryJourneyState,
  readonly PrimaryJourneyState[]
> = {
  discovery: ["supplier_sample"],
  supplier_sample: ["sample_approved"],
  // Store focus is optional; batch ordering does not require store readiness.
  sample_approved: ["store_setup", "batch_ordered"],
  store_setup: ["batch_ordered"],
  batch_ordered: ["batch_arrived_ready"],
  batch_arrived_ready: ["selling"],
  selling: [],
};

export type JourneyView = {
  primaryState: JourneyState;
  pausedFromState: string | null;
  blockedFromState: string | null;
  blockedReason: string | null;
};

export type JourneyPatch = {
  primaryState: JourneyState;
  pausedFromState: string | null;
  blockedFromState: string | null;
  blockedReason: string | null;
};

export type JourneyFsmError =
  | "invalid_transition"
  | "overlay_active"
  | "already_paused"
  | "not_paused"
  | "already_blocked"
  | "not_blocked"
  | "missing_reason";

export type FsmResult =
  | { ok: true; patch: JourneyPatch }
  | { ok: false; error: JourneyFsmError };

export function isPrimaryState(state: string): state is PrimaryJourneyState {
  return (PRIMARY_STATES as readonly string[]).includes(state);
}

/** True when `to` is a legal forward move from a primary state `from`. */
export function canAdvance(from: string, to: string): boolean {
  if (!isPrimaryState(from) || !isPrimaryState(to)) return false;
  return FORWARD_TRANSITIONS[from].includes(to);
}

function clearedOverlays(): Pick<
  JourneyPatch,
  "pausedFromState" | "blockedFromState" | "blockedReason"
> {
  return { pausedFromState: null, blockedFromState: null, blockedReason: null };
}

/** Advance along the coaching spine. Overlays must be cleared first. */
export function planAdvance(view: JourneyView, to: JourneyState): FsmResult {
  if (view.primaryState === "paused" || view.primaryState === "blocked") {
    return { ok: false, error: "overlay_active" };
  }
  if (!canAdvance(view.primaryState, to)) {
    return { ok: false, error: "invalid_transition" };
  }
  return { ok: true, patch: { primaryState: to, ...clearedOverlays() } };
}

export function planPause(view: JourneyView): FsmResult {
  if (view.primaryState === "paused") {
    return { ok: false, error: "already_paused" };
  }
  if (!isPrimaryState(view.primaryState)) {
    return { ok: false, error: "overlay_active" };
  }
  return {
    ok: true,
    patch: {
      primaryState: "paused",
      pausedFromState: view.primaryState,
      blockedFromState: null,
      blockedReason: null,
    },
  };
}

export function planResume(view: JourneyView): FsmResult {
  if (view.primaryState !== "paused") {
    return { ok: false, error: "not_paused" };
  }
  const restore =
    view.pausedFromState && isPrimaryState(view.pausedFromState)
      ? view.pausedFromState
      : "discovery";
  return { ok: true, patch: { primaryState: restore, ...clearedOverlays() } };
}

export function planBlock(view: JourneyView, reason: string): FsmResult {
  const trimmed = reason.trim();
  if (!trimmed) return { ok: false, error: "missing_reason" };
  if (view.primaryState === "blocked") {
    return { ok: false, error: "already_blocked" };
  }
  if (!isPrimaryState(view.primaryState)) {
    return { ok: false, error: "overlay_active" };
  }
  return {
    ok: true,
    patch: {
      primaryState: "blocked",
      blockedFromState: view.primaryState,
      blockedReason: trimmed,
      pausedFromState: null,
    },
  };
}

export function planUnblock(view: JourneyView): FsmResult {
  if (view.primaryState !== "blocked") {
    return { ok: false, error: "not_blocked" };
  }
  const restore =
    view.blockedFromState && isPrimaryState(view.blockedFromState)
      ? view.blockedFromState
      : "discovery";
  return { ok: true, patch: { primaryState: restore, ...clearedOverlays() } };
}
