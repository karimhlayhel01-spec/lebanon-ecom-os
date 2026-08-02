import { describe, expect, it } from "vitest";
import {
  REORDER_RUNWAY_WEEKS_THRESHOLD,
  canEditReorderArrivalEta,
  canMarkReorderArrived,
  canMarkReorderOrdered,
  casUpdateSucceeded,
  computeSkuRunway,
  evaluateReorderEconomicsGate,
  isReorderEconomicsHealthy,
  normalizeReorderStatus,
  reorderCasMissError,
  reorderCasPriorStatus,
  reorderInvestNextTone,
} from "@/lib/supplier/reorder";

describe("computeSkuRunway", () => {
  it("nudges when weeks of stock ≤ ~4", () => {
    const r = computeSkuRunway({
      skuLeft: 40,
      recentWeeklySold: [20, 20, 20, 20],
    });
    expect(r.weeks).toBe(2);
    expect(r.nudge).toBe(true);
    expect(r.confidence).toBe("known");
  });

  it("does not nudge when runway is comfortable", () => {
    const r = computeSkuRunway({
      skuLeft: 200,
      recentWeeklySold: [20, 25, 20, 25],
    });
    expect(r.weeks).toBeGreaterThan(REORDER_RUNWAY_WEEKS_THRESHOLD);
    expect(r.nudge).toBe(false);
  });

  it("degrades with a single sold week but still computes", () => {
    const r = computeSkuRunway({
      skuLeft: 30,
      recentWeeklySold: [15],
    });
    expect(r.weeks).toBe(2);
    expect(r.nudge).toBe(true);
    expect(r.confidence).toBe("degraded");
  });

  it("degrades when left known but sold unknown — thin stock nudges", () => {
    const thin = computeSkuRunway({ skuLeft: 20, recentWeeklySold: [] });
    expect(thin.weeks).toBeNull();
    expect(thin.nudge).toBe(true);
    expect(thin.confidence).toBe("degraded");

    const ample = computeSkuRunway({ skuLeft: 100, recentWeeklySold: [] });
    expect(ample.nudge).toBe(false);
  });

  it("unknown when both sides missing — no nudge", () => {
    const r = computeSkuRunway({
      skuLeft: null,
      recentWeeklySold: [],
    });
    expect(r).toMatchObject({
      weeks: null,
      nudge: false,
      confidence: "unknown",
    });
  });
});

describe("evaluateReorderEconomicsGate", () => {
  it("allows everyone when invest-next is reinvest (healthier)", () => {
    for (const experience of ["beginner", "some", "experienced"] as const) {
      expect(
        evaluateReorderEconomicsGate({
          experience,
          investNextRecommendation: "reinvest",
        }),
      ).toEqual({ ok: true });
    }
  });

  it("hard-blocks beginners when not healthier", () => {
    expect(
      evaluateReorderEconomicsGate({
        experience: "beginner",
        investNextRecommendation: "hold",
      }),
    ).toEqual({ ok: false, error: "beginner_blocked" });
    expect(
      evaluateReorderEconomicsGate({
        experience: "beginner",
        investNextRecommendation: "fix_economics",
      }),
    ).toEqual({ ok: false, error: "beginner_blocked" });
    expect(
      evaluateReorderEconomicsGate({
        experience: "beginner",
        investNextRecommendation: null,
      }),
    ).toEqual({ ok: false, error: "beginner_blocked" });
  });

  it("warns some/experienced when weak; allows with warning", () => {
    expect(
      evaluateReorderEconomicsGate({
        experience: "some",
        investNextRecommendation: "hold",
      }),
    ).toEqual({ ok: true, warning: "weak_economics" });
    expect(
      evaluateReorderEconomicsGate({
        experience: "experienced",
        investNextRecommendation: null,
      }),
    ).toEqual({ ok: true, warning: "weak_economics" });
  });
});

describe("isReorderEconomicsHealthy", () => {
  it("only reinvest counts as healthier", () => {
    expect(isReorderEconomicsHealthy("reinvest")).toBe(true);
    expect(isReorderEconomicsHealthy("hold")).toBe(false);
    expect(isReorderEconomicsHealthy(null)).toBe(false);
  });
});

describe("reorder status transitions", () => {
  it("normalizeReorderStatus", () => {
    expect(normalizeReorderStatus("ordered")).toBe("ordered");
    expect(normalizeReorderStatus("idle")).toBe("idle");
    expect(normalizeReorderStatus(null)).toBe("idle");
  });

  it("canMarkReorderOrdered only while selling + idle + first batch done", () => {
    expect(
      canMarkReorderOrdered({
        primaryState: "selling",
        reorderStatus: "idle",
        firstBatchArrived: true,
        sampleApproved: true,
      }),
    ).toBe(true);
    expect(
      canMarkReorderOrdered({
        primaryState: "batch_arrived_ready",
        reorderStatus: "idle",
        firstBatchArrived: true,
        sampleApproved: true,
      }),
    ).toBe(false);
    expect(
      canMarkReorderOrdered({
        primaryState: "selling",
        reorderStatus: "ordered",
        firstBatchArrived: true,
        sampleApproved: true,
      }),
    ).toBe(false);
  });

  it("canMarkReorderArrived / ETA only when ordered", () => {
    expect(
      canMarkReorderArrived({
        primaryState: "selling",
        reorderStatus: "ordered",
      }),
    ).toBe(true);
    expect(
      canMarkReorderArrived({
        primaryState: "selling",
        reorderStatus: "idle",
      }),
    ).toBe(false);
    expect(canEditReorderArrivalEta({ reorderStatus: "ordered" })).toBe(true);
    expect(canEditReorderArrivalEta({ reorderStatus: "idle" })).toBe(false);
  });
});

describe("reorder CAS double-submit rejection", () => {
  it("casUpdateSucceeded accepts only exactly one matched row", () => {
    expect(casUpdateSucceeded(0)).toBe(false);
    expect(casUpdateSucceeded(1)).toBe(true);
    expect(casUpdateSucceeded(2)).toBe(false);
  });

  it("mark_ordered CAS expects idle; miss → reorder_active", () => {
    expect(reorderCasPriorStatus("mark_ordered")).toBe("idle");
    expect(reorderCasMissError("mark_ordered")).toBe("reorder_active");
    // Second click after first claimed idle→ordered:
    expect(canMarkReorderOrdered({
      primaryState: "selling",
      reorderStatus: "ordered",
      firstBatchArrived: true,
      sampleApproved: true,
    })).toBe(false);
    expect(casUpdateSucceeded(0)).toBe(false);
  });

  it("mark_arrived CAS expects ordered; miss → reorder_not_ordered", () => {
    expect(reorderCasPriorStatus("mark_arrived")).toBe("ordered");
    expect(reorderCasMissError("mark_arrived")).toBe("reorder_not_ordered");
    expect(
      canMarkReorderArrived({
        primaryState: "selling",
        reorderStatus: "idle",
      }),
    ).toBe(false);
  });
});

describe("reorderInvestNextTone", () => {
  it("strengthens on reinvest + nudge; warns on hold/fix", () => {
    expect(
      reorderInvestNextTone({
        recommendation: "reinvest",
        runwayNudge: true,
      }),
    ).toBe("strengthen");
    expect(
      reorderInvestNextTone({
        recommendation: "hold",
        runwayNudge: true,
      }),
    ).toBe("warn");
    expect(
      reorderInvestNextTone({
        recommendation: "reinvest",
        runwayNudge: false,
      }),
    ).toBe("neutral");
  });
});
