/**
 * WAVE-2 §7 — reject is recoverable for a short window.
 *
 * A mis-tap must not shrink the founder's world, but undo is not a second
 * shortlist: it only reaches the last few rejects of the ACTIVE session, only
 * inside a short window, and only while the card is still accept-ready. Kept
 * pure so every refusal is unit-testable without a database.
 *
 * Two things undo must never do: resurrect an accepted product (that would
 * mean walking back a Human Approval) and touch the exhausted-round ladder.
 */

import {
  DISCOVERY_UNDO_REJECT_MAX,
  DISCOVERY_UNDO_REJECT_WINDOW_MS,
} from "@/lib/constants";

/**
 * `accepted` is deliberately its own refusal: the founder needs to hear that
 * the product moved forward, not that undo "expired".
 */
export type UndoRejectRefusal =
  | "not_found"
  | "accepted"
  | "not_rejected"
  | "expired"
  | "no_longer_accept_ready";

export type UndoRejectDecision =
  | { ok: true }
  | { ok: false; reason: UndoRejectRefusal };

/** Minimum candidate shape undo reasons about. */
export type UndoRejectCandidate = {
  id: string;
  sessionId: string;
  status: string;
  /** Null on legacy rows rejected before this lock — never undoable. */
  rejectedAt: string | null;
};

function rejectedAtMs(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Is the reject still inside the recovery window? An absent or unparseable
 * stamp fails closed — an undatable reject is treated as old, not as fresh.
 */
export function isUndoWindowOpen(
  rejectedAt: string | null | undefined,
  now: Date = new Date(),
  windowMs: number = DISCOVERY_UNDO_REJECT_WINDOW_MS,
): boolean {
  const ms = rejectedAtMs(rejectedAt);
  if (ms == null) return false;
  const age = now.getTime() - ms;
  // A future stamp is clock skew, not a reject from tomorrow.
  return age <= windowMs;
}

/**
 * The rejects currently offered for undo: this session only, newest first,
 * inside the window, capped so the affordance stays a mis-tap fix.
 */
export function selectUndoableRejects<T extends UndoRejectCandidate>(
  rows: readonly T[],
  input: {
    activeSessionId: string;
    now?: Date;
    windowMs?: number;
    max?: number;
  },
): T[] {
  const now = input.now ?? new Date();
  const windowMs = input.windowMs ?? DISCOVERY_UNDO_REJECT_WINDOW_MS;
  const max = input.max ?? DISCOVERY_UNDO_REJECT_MAX;

  return rows
    .filter(
      (r) =>
        r.status === "rejected" &&
        r.sessionId === input.activeSessionId &&
        isUndoWindowOpen(r.rejectedAt, now, windowMs),
    )
    .sort(
      (a, b) => (rejectedAtMs(b.rejectedAt) ?? 0) - (rejectedAtMs(a.rejectedAt) ?? 0),
    )
    .slice(0, max);
}

/**
 * Decide whether one candidate may be restored.
 *
 * `acceptReady` is re-evaluated by the caller against CURRENT scores, not the
 * value stored when the card was first shown: if a score refresh moved the
 * product out of the shortlist while the founder was deciding, undo refuses and
 * says so rather than silently putting a now-blocked card back on the page.
 */
export function evaluateUndoReject(input: {
  candidate: UndoRejectCandidate | null | undefined;
  activeSessionId: string | null | undefined;
  acceptReady: boolean;
  now?: Date;
  windowMs?: number;
  max?: number;
  /** Rejects currently offered for undo — bounds undo to the last few. */
  undoableIds?: readonly string[];
}): UndoRejectDecision {
  const candidate = input.candidate;
  if (!candidate) return { ok: false, reason: "not_found" };
  if (candidate.status === "accepted") {
    return { ok: false, reason: "accepted" };
  }
  if (candidate.status !== "rejected") {
    return { ok: false, reason: "not_rejected" };
  }
  if (!input.activeSessionId || candidate.sessionId !== input.activeSessionId) {
    return { ok: false, reason: "expired" };
  }
  if (!isUndoWindowOpen(candidate.rejectedAt, input.now, input.windowMs)) {
    return { ok: false, reason: "expired" };
  }
  if (input.undoableIds && !input.undoableIds.includes(candidate.id)) {
    return { ok: false, reason: "expired" };
  }
  if (!input.acceptReady) {
    return { ok: false, reason: "no_longer_accept_ready" };
  }
  return { ok: true };
}
