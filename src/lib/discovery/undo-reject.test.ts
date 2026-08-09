import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  DISCOVERY_UNDO_REJECT_MAX,
  DISCOVERY_UNDO_REJECT_WINDOW_MS,
} from "@/lib/constants";
import {
  evaluateUndoReject,
  isUndoWindowOpen,
  selectUndoableRejects,
  type UndoRejectCandidate,
} from "@/lib/discovery/undo-reject";

const NOW = new Date("2026-08-07T12:00:00.000Z");
const SESSION = "session-1";

function minutesAgo(minutes: number): string {
  return new Date(NOW.getTime() - minutes * 60_000).toISOString();
}

function rejected(
  id: string,
  overrides: Partial<UndoRejectCandidate> = {},
): UndoRejectCandidate {
  return {
    id,
    sessionId: SESSION,
    status: "rejected",
    rejectedAt: minutesAgo(1),
    ...overrides,
  };
}

describe("isUndoWindowOpen", () => {
  it("is open inside the window and closed past it", () => {
    expect(isUndoWindowOpen(minutesAgo(1), NOW)).toBe(true);
    expect(
      isUndoWindowOpen(
        new Date(NOW.getTime() - DISCOVERY_UNDO_REJECT_WINDOW_MS - 1).toISOString(),
        NOW,
      ),
    ).toBe(false);
  });

  it("fails closed on a missing or undatable reject stamp", () => {
    // Legacy rows rejected before this lock carry no stamp — never undoable.
    expect(isUndoWindowOpen(null, NOW)).toBe(false);
    expect(isUndoWindowOpen("nonsense", NOW)).toBe(false);
  });
});

describe("selectUndoableRejects", () => {
  it("offers only this session's recent rejects, newest first", () => {
    const rows = [
      rejected("a", { rejectedAt: minutesAgo(3) }),
      rejected("b", { rejectedAt: minutesAgo(1) }),
      rejected("c", { rejectedAt: minutesAgo(2) }),
    ];
    expect(
      selectUndoableRejects(rows, { activeSessionId: SESSION, now: NOW }).map(
        (r) => r.id,
      ),
    ).toEqual(["b", "c", "a"]);
  });

  it("drops shown, accepted, other-session, and expired rows", () => {
    const rows = [
      rejected("keep"),
      rejected("shown", { status: "shown" }),
      rejected("accepted", { status: "accepted" }),
      rejected("other-session", { sessionId: "session-2" }),
      rejected("expired", { rejectedAt: minutesAgo(60 * 24) }),
      rejected("legacy", { rejectedAt: null }),
    ];
    expect(
      selectUndoableRejects(rows, { activeSessionId: SESSION, now: NOW }).map(
        (r) => r.id,
      ),
    ).toEqual(["keep"]);
  });

  it("caps the affordance so undo never becomes a second shortlist", () => {
    const rows = Array.from({ length: DISCOVERY_UNDO_REJECT_MAX + 3 }, (_, i) =>
      rejected(`r${i}`, { rejectedAt: minutesAgo(i + 1) }),
    );
    expect(
      selectUndoableRejects(rows, { activeSessionId: SESSION, now: NOW }),
    ).toHaveLength(DISCOVERY_UNDO_REJECT_MAX);
  });
});

describe("evaluateUndoReject", () => {
  const base = {
    activeSessionId: SESSION,
    acceptReady: true,
    now: NOW,
    undoableIds: ["undo-me"],
  };

  it("restores exactly one recent, still accept-ready reject", () => {
    expect(evaluateUndoReject({ ...base, candidate: rejected("undo-me") })).toEqual(
      { ok: true },
    );
  });

  it("refuses an accepted product with its own reason", () => {
    // Resurrecting an accept would walk back a Human Approval and an SKU.
    expect(
      evaluateUndoReject({
        ...base,
        undoableIds: undefined,
        candidate: rejected("undo-me", { status: "accepted" }),
      }),
    ).toEqual({ ok: false, reason: "accepted" });
  });

  it("refuses a card that is already on the shortlist", () => {
    expect(
      evaluateUndoReject({
        ...base,
        undoableIds: undefined,
        candidate: rejected("undo-me", { status: "shown" }),
      }),
    ).toEqual({ ok: false, reason: "not_rejected" });
  });

  it("explains rather than restoring a card the gates moved against", () => {
    expect(
      evaluateUndoReject({
        ...base,
        acceptReady: false,
        candidate: rejected("undo-me"),
      }),
    ).toEqual({ ok: false, reason: "no_longer_accept_ready" });
  });

  it("refuses once the window closed or the session moved on", () => {
    expect(
      evaluateUndoReject({
        ...base,
        candidate: rejected("undo-me", { rejectedAt: minutesAgo(60 * 24) }),
      }),
    ).toEqual({ ok: false, reason: "expired" });
    expect(
      evaluateUndoReject({
        ...base,
        candidate: rejected("undo-me", { sessionId: "session-2" }),
      }),
    ).toEqual({ ok: false, reason: "expired" });
    expect(
      evaluateUndoReject({
        ...base,
        activeSessionId: null,
        candidate: rejected("undo-me"),
      }),
    ).toEqual({ ok: false, reason: "expired" });
  });

  it("refuses a reject older than the last few, even inside the window", () => {
    expect(
      evaluateUndoReject({ ...base, candidate: rejected("not-offered") }),
    ).toEqual({ ok: false, reason: "expired" });
  });

  it("refuses a missing candidate", () => {
    expect(evaluateUndoReject({ ...base, candidate: null })).toEqual({
      ok: false,
      reason: "not_found",
    });
  });
});

describe("undo copy", () => {
  const messages = Object.fromEntries(
    (["en", "ar"] as const).map((locale) => [
      locale,
      (
        JSON.parse(
          readFileSync(
            path.join(process.cwd(), `messages/${locale}.json`),
            "utf8",
          ),
        ) as { Discovery: Record<string, string> }
      ).Discovery,
    ]),
  );

  const KEYS = [
    "undoRejectTitle",
    "undoRejectBody",
    "undoReject",
    "undoRejectPending",
    "undoRejectAccepted",
    "undoRejectExpired",
    "undoRejectNotRejected",
    "undoRejectNoLongerReady",
    "undoRejectFailed",
  ] as const;

  it("ships every refusal in EN and AR with no English fallback in AR", () => {
    for (const key of KEYS) {
      expect(messages.en[key]?.length ?? 0).toBeGreaterThan(3);
      expect(messages.ar[key]?.length ?? 0).toBeGreaterThan(3);
      expect(messages.ar[key]).not.toBe(messages.en[key]);
      expect(messages.ar[key]).toMatch(/[\u0600-\u06FF]/);
    }
  });

  it("reads each refusal distinctly, so a founder can tell them apart", () => {
    for (const locale of ["en", "ar"] as const) {
      const refusals = [
        messages[locale].undoRejectAccepted,
        messages[locale].undoRejectExpired,
        messages[locale].undoRejectNotRejected,
        messages[locale].undoRejectNoLongerReady,
        messages[locale].undoRejectFailed,
      ];
      expect(new Set(refusals).size).toBe(refusals.length);
    }
  });

  it("names the product on the undo control", () => {
    for (const locale of ["en", "ar"] as const) {
      expect(messages[locale].undoReject).toContain("{name}");
    }
  });
});

describe("undoRejectCandidate contract", () => {
  const src = readFileSync(
    path.join(process.cwd(), "src/lib/discovery/service.ts"),
    "utf8",
  );
  const undoFn = src.slice(
    src.indexOf("export async function undoRejectCandidate"),
    src.indexOf("/** Rejected rows of one session"),
  );

  it("re-checks accept-readiness through the shared gate resolver", () => {
    // Reuses the resolver the page uses, so undo can never restore a card the
    // shortlist itself would filter out.
    expect(undoFn).toContain("resolveCandidateGate");
    expect(undoFn).toContain("evaluateUndoReject");
    expect(undoFn).toContain("selectUndoableRejects");
  });

  it("never bumps the exhausted-round ladder or touches approvals", () => {
    expect(undoFn).not.toContain("maybeCountExhaustion");
    expect(undoFn).not.toContain("discoveryExhaustedRounds");
    expect(undoFn).not.toContain("exhaustionCounted");
    expect(undoFn).not.toContain("approvalRequests");
    expect(undoFn).not.toContain("decideApproval");
    expect(undoFn).not.toContain("skuCards");
  });

  it("clears the reject stamp so one mis-tap cannot be undone twice", () => {
    expect(undoFn).toContain('status: "shown", rejectedAt: null');
  });

  it("stamps rejectedAt on reject so the window can be bounded", () => {
    const rejectFn = src.slice(
      src.indexOf("export async function rejectCandidate"),
      src.indexOf("export type UndoRejectResult"),
    );
    expect(rejectFn).toContain('status: "rejected", rejectedAt: nowIso()');
    // Exhaustion is still counted once per session pool by reject itself; the
    // session's own `exhaustionCounted` flag is what stops a re-reject after
    // undo counting a second round.
    expect(rejectFn).toContain("maybeCountExhaustion");
  });

  it("counts a session's exhaustion at most once, so undo cannot double-count", () => {
    const exhaustionFn = src.slice(
      src.indexOf("async function maybeCountExhaustion"),
      src.indexOf("async function insertSessionPool"),
    );
    expect(exhaustionFn).toContain("if (!session || session.exhaustionCounted) return;");
    expect(exhaustionFn).toContain("exhaustionCounted: true");
  });
});
