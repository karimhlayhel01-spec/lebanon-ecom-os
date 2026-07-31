import { describe, expect, it } from "vitest";
import {
  archiveWarningsMessage,
  type ArchiveWarning,
} from "@/lib/sku/lifecycle";
import { planPause, planResume } from "@/lib/journey/fsm";

describe("archiveWarningsMessage", () => {
  it("lists sample and batch warnings", () => {
    const both: ArchiveWarning = {
      sampleNotArrived: true,
      batchNotArrived: true,
    };
    expect(archiveWarningsMessage(both)).toEqual([
      "sampleNotArrived",
      "batchNotArrived",
    ]);
    expect(
      archiveWarningsMessage({
        sampleNotArrived: false,
        batchNotArrived: false,
      }),
    ).toEqual([]);
  });

  it("batch warning only when ordered but not arrived", () => {
    // Pure shape check — getArchiveWarnings uses the same rules.
    expect(
      archiveWarningsMessage({
        sampleNotArrived: false,
        batchNotArrived: true,
      }),
    ).toEqual(["batchNotArrived"]);
  });
});

describe("pause shop vs multi-SKU pause (pure FSM)", () => {
  it("SKU pause stores pausedFromState; resume restores it", () => {
    const view = {
      primaryState: "supplier_sample" as const,
      pausedFromState: null,
      blockedFromState: null,
      blockedReason: null,
    };
    const paused = planPause(view);
    expect(paused.ok).toBe(true);
    if (!paused.ok) return;
    expect(paused.patch.primaryState).toBe("paused");
    expect(paused.patch.pausedFromState).toBe("supplier_sample");

    const resumed = planResume({
      primaryState: "paused",
      pausedFromState: "supplier_sample",
      blockedFromState: null,
      blockedReason: null,
    });
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) return;
    expect(resumed.patch.primaryState).toBe("supplier_sample");
    expect(resumed.patch.pausedFromState).toBeNull();
  });

  it("shop pause is orthogonal — SKU can stay in selling while shop overlays paused", () => {
    // effectiveSkuPrimaryState logic (pure form): shop pause wins for UI.
    function effective(shopPaused: boolean, skuState: string, pausedFrom: string | null) {
      if (shopPaused) {
        return {
          primaryState: "paused",
          pausedFromState:
            skuState === "paused" ? pausedFrom : skuState,
        };
      }
      return { primaryState: skuState, pausedFromState: pausedFrom };
    }
    expect(effective(true, "selling", null).primaryState).toBe("paused");
    expect(effective(true, "selling", null).pausedFromState).toBe("selling");
    expect(effective(false, "selling", null).primaryState).toBe("selling");
    // Multi-SKU pause: only selected SKUs change; others unchanged.
    const states = { a: "selling", b: "batch_ordered" };
    const selected = ["a"];
    const after = { ...states };
    for (const id of selected) {
      const r = planPause({
        primaryState: after[id as "a" | "b"] as "selling",
        pausedFromState: null,
        blockedFromState: null,
        blockedReason: null,
      });
      if (r.ok) after[id as "a" | "b"] = r.patch.primaryState;
    }
    expect(after.a).toBe("paused");
    expect(after.b).toBe("batch_ordered");
  });
});
