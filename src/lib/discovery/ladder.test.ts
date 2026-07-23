import { describe, expect, it } from "vitest";
import {
  classifyDiscoveryLadder,
  suggestionsForPassReasons,
} from "@/lib/discovery/ladder";

describe("classifyDiscoveryLadder (Fix #13)", () => {
  it("returns null while products are visible", () => {
    expect(
      classifyDiscoveryLadder({
        visibleCount: 3,
        canShowMore: true,
        remainingEligible: 10,
        exhaustedRounds: 0,
      }),
    ).toBeNull();
  });

  it("A — empty visible with show-more remaining", () => {
    expect(
      classifyDiscoveryLadder({
        visibleCount: 0,
        canShowMore: true,
        remainingEligible: 10,
        exhaustedRounds: 0,
      }),
    ).toBe("show_more");
  });

  it("B — pool exhausted with remaining eligible and under 3 rounds", () => {
    expect(
      classifyDiscoveryLadder({
        visibleCount: 0,
        canShowMore: false,
        remainingEligible: 5,
        exhaustedRounds: 1,
      }),
    ).toBe("continue");
  });

  it("C — after 3 exhausted rounds with remaining eligible", () => {
    expect(
      classifyDiscoveryLadder({
        visibleCount: 0,
        canShowMore: false,
        remainingEligible: 4,
        exhaustedRounds: 3,
      }),
    ).toBe("why_pass");
  });

  it("D — no eligible products left for this profile", () => {
    expect(
      classifyDiscoveryLadder({
        visibleCount: 0,
        canShowMore: false,
        remainingEligible: 0,
        exhaustedRounds: 1,
      }),
    ).toBe("catalog_exhausted");
  });

  it("D wins over C when the catalog is empty", () => {
    expect(
      classifyDiscoveryLadder({
        visibleCount: 0,
        canShowMore: false,
        remainingEligible: 0,
        exhaustedRounds: 5,
      }),
    ).toBe("catalog_exhausted");
  });
});

describe("suggestionsForPassReasons", () => {
  it("maps reasons to onboarding suggestion keys without duplicates", () => {
    expect(
      suggestionsForPassReasons(["too_expensive", "wrong_categories", "too_expensive"]),
    ).toEqual(["maxLandedCost", "budgetUsd", "categoryLikes"]);
  });

  it("includes demand + likes for weak_demand", () => {
    expect(suggestionsForPassReasons(["weak_demand"])).toEqual([
      "demandConfirm",
      "categoryLikes",
    ]);
  });
});
