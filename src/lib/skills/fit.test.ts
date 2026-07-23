import { describe, expect, it } from "vitest";
import { computeFit, type FitProfile, type FitProduct } from "@/lib/skills/fit";

function profile(overrides: Partial<FitProfile> = {}): FitProfile {
  return {
    maxLandedCost: 25,
    experience: "beginner",
    riskTolerance: "low",
    hoursPerWeek: 10,
    categoryLikes: [],
    ...overrides,
  };
}

function product(overrides: Partial<FitProduct> = {}): FitProduct {
  return {
    category: "home_kitchen",
    landedCost: 10,
    difficulty: 0,
    risk: 0,
    timeNeed: 4,
    workload: 0,
    storageFootprint: "small",
    ...overrides,
  };
}

describe("fit skill", () => {
  it("scores an ideal product as Strong", () => {
    const r = computeFit(profile(), product());
    expect(r.score).toBe(100);
    expect(r.strength).toBe("Strong");
    expect(r.riskRead).toBeNull();
    expect(r.notRecommended).toBe(false);
  });

  it("marks a product above risk tolerance as Okay with a risk note", () => {
    const r = computeFit(
      profile({ riskTolerance: "low" }),
      product({ risk: 2 }),
    );
    expect(r.strength).toBe("Okay");
    // Skills return stable note keys; DiscoveryBoard translates for EN/AR UI.
    expect(r.riskRead).toBe("@fit.riskOverTolerance");
  });

  it("marks a moderate-fit product as Okay even within risk tolerance", () => {
    const r = computeFit(
      profile({ riskTolerance: "medium" }),
      product({ landedCost: 50, difficulty: 2, storageFootprint: "medium" }),
    );
    expect(r.score).toBeLessThan(70);
    expect(r.strength).toBe("Okay");
    expect(r.riskRead).toBe("@fit.moderateOkay");
  });

  it("applies a soft +5 bonus for a liked category", () => {
    const liked = computeFit(
      profile({ categoryLikes: ["home_kitchen"] }),
      product({ risk: 1, storageFootprint: "medium" }),
    );
    const notLiked = computeFit(
      profile({ categoryLikes: [] }),
      product({ risk: 1, storageFootprint: "medium" }),
    );
    expect(liked.score - notLiked.score).toBe(5);
  });

  it("lowers the budget dimension when landed cost exceeds the max", () => {
    const within = computeFit(profile({ maxLandedCost: 25 }), product({ landedCost: 10 }));
    const over = computeFit(profile({ maxLandedCost: 25 }), product({ landedCost: 50 }));
    expect(over.breakdown.budget).toBeLessThan(within.breakdown.budget);
    expect(over.breakdown.budget).toBeCloseTo(0.5, 10);
  });

  it("flags a poor all-round match as not recommended", () => {
    const r = computeFit(
      profile({ maxLandedCost: 25, hoursPerWeek: 5 }),
      product({
        landedCost: 100,
        difficulty: 2,
        risk: 2,
        timeNeed: 40,
        workload: 2,
        storageFootprint: "large",
      }),
    );
    expect(r.notRecommended).toBe(true);
    expect(r.score).toBeLessThan(45);
  });
});
