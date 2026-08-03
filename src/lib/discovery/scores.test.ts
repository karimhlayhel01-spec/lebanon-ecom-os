import { describe, expect, it } from "vitest";
import {
  applyFailedScoreRefresh,
  applySuccessfulScoreRefresh,
  buildFailedScoreRefreshPatch,
} from "@/lib/discovery/scores";

describe("last-known score semantics", () => {
  it("exports fail and success writers (Approach A seam)", () => {
    expect(typeof applyFailedScoreRefresh).toBe("function");
    expect(typeof applySuccessfulScoreRefresh).toBe("function");
  });

  it("failed refresh patch never clears numeric scores", () => {
    const patch = buildFailedScoreRefreshPatch("api timeout", "2026-08-03T00:00:00.000Z");
    expect(patch).toEqual({
      lastScoreStatus: "failed",
      lastError: "api timeout",
      updatedAt: "2026-08-03T00:00:00.000Z",
    });
    expect(Object.keys(patch).sort()).toEqual([
      "lastError",
      "lastScoreStatus",
      "updatedAt",
    ]);
    expect("abroadDemandScore" in patch).toBe(false);
    expect("lebanonDemandScore" in patch).toBe(false);
    expect("competitionScore" in patch).toBe(false);
    expect("compositeScore" in patch).toBe(false);
    expect("lastScoredAt" in patch).toBe(false);
  });

  it("truncates long error messages", () => {
    const long = "x".repeat(600);
    const patch = buildFailedScoreRefreshPatch(long, "t");
    expect(patch.lastError.length).toBe(500);
  });
});
