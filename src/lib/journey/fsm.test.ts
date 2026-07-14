import { describe, expect, it } from "vitest";
import {
  canAdvance,
  planAdvance,
  planBlock,
  planPause,
  planResume,
  planUnblock,
  type JourneyView,
} from "@/lib/journey/fsm";

function view(overrides: Partial<JourneyView> = {}): JourneyView {
  return {
    primaryState: "discovery",
    pausedFromState: null,
    blockedFromState: null,
    blockedReason: null,
    ...overrides,
  };
}

describe("journey FSM — spine transitions", () => {
  it("allows each legal forward step", () => {
    expect(canAdvance("discovery", "supplier_sample")).toBe(true);
    expect(canAdvance("supplier_sample", "sample_approved")).toBe(true);
    expect(canAdvance("sample_approved", "store_setup")).toBe(true);
    expect(canAdvance("store_setup", "batch_ordered")).toBe(true);
    expect(canAdvance("batch_ordered", "batch_arrived_ready")).toBe(true);
    expect(canAdvance("batch_arrived_ready", "selling")).toBe(true);
  });

  it("lets sample_approved skip store_setup straight to batch_ordered", () => {
    expect(canAdvance("sample_approved", "batch_ordered")).toBe(true);
  });

  it("rejects skipping and backward moves", () => {
    expect(canAdvance("discovery", "sample_approved")).toBe(false);
    expect(canAdvance("supplier_sample", "discovery")).toBe(false);
    expect(canAdvance("selling", "discovery")).toBe(false);
    expect(canAdvance("discovery", "paused")).toBe(false);
  });

  it("planAdvance clears overlay fields on success", () => {
    const result = planAdvance(view(), "supplier_sample");
    expect(result).toEqual({
      ok: true,
      patch: {
        primaryState: "supplier_sample",
        pausedFromState: null,
        blockedFromState: null,
        blockedReason: null,
      },
    });
  });

  it("planAdvance rejects invalid transitions", () => {
    expect(planAdvance(view(), "selling")).toEqual({
      ok: false,
      error: "invalid_transition",
    });
  });

  it("planAdvance refuses to advance while paused or blocked", () => {
    expect(
      planAdvance(view({ primaryState: "paused" }), "supplier_sample"),
    ).toEqual({ ok: false, error: "overlay_active" });
    expect(
      planAdvance(view({ primaryState: "blocked" }), "supplier_sample"),
    ).toEqual({ ok: false, error: "overlay_active" });
  });
});

describe("journey FSM — pause / resume overlay", () => {
  it("pauses from a primary state and remembers it", () => {
    const result = planPause(view({ primaryState: "store_setup" }));
    expect(result).toEqual({
      ok: true,
      patch: {
        primaryState: "paused",
        pausedFromState: "store_setup",
        blockedFromState: null,
        blockedReason: null,
      },
    });
  });

  it("rejects pausing when already paused", () => {
    expect(planPause(view({ primaryState: "paused" }))).toEqual({
      ok: false,
      error: "already_paused",
    });
  });

  it("resumes to the remembered state", () => {
    const result = planResume(
      view({ primaryState: "paused", pausedFromState: "batch_ordered" }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.patch.primaryState).toBe("batch_ordered");
  });

  it("resume falls back to discovery when memory is missing/invalid", () => {
    const result = planResume(
      view({ primaryState: "paused", pausedFromState: "bogus" }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.patch.primaryState).toBe("discovery");
  });

  it("rejects resume when not paused", () => {
    expect(planResume(view())).toEqual({ ok: false, error: "not_paused" });
  });
});

describe("journey FSM — block / unblock overlay", () => {
  it("blocks from a primary state with a reason", () => {
    const result = planBlock(
      view({ primaryState: "supplier_sample" }),
      "supplier unresponsive",
    );
    expect(result).toEqual({
      ok: true,
      patch: {
        primaryState: "blocked",
        blockedFromState: "supplier_sample",
        blockedReason: "supplier unresponsive",
        pausedFromState: null,
      },
    });
  });

  it("requires a non-empty reason", () => {
    expect(planBlock(view(), "   ")).toEqual({
      ok: false,
      error: "missing_reason",
    });
  });

  it("unblocks back to the remembered state", () => {
    const result = planUnblock(
      view({ primaryState: "blocked", blockedFromState: "sample_approved" }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.patch.primaryState).toBe("sample_approved");
  });

  it("rejects unblock when not blocked", () => {
    expect(planUnblock(view())).toEqual({ ok: false, error: "not_blocked" });
  });
});
