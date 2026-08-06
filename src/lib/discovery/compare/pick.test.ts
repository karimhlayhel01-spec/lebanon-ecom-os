import { describe, expect, it } from "vitest";
import {
  DISCOVERY_COMPARE_MAX,
  DISCOVERY_COMPARE_MIN,
} from "@/lib/constants";
import {
  isValidCompareSelectionCount,
  pickCompareWinner,
  revalidateWorthConsideringMarks,
  signalsFromFitBreakdown,
  toggleWorthConsideringMark,
  type CompareCandidateSignal,
} from "@/lib/discovery/compare/pick";

function signal(
  partial: Partial<CompareCandidateSignal> &
    Pick<CompareCandidateSignal, "candidateId" | "name">,
): CompareCandidateSignal {
  return {
    catalogKey: partial.catalogKey ?? partial.candidateId,
    compositeScore: partial.compositeScore ?? null,
    fitScore: partial.fitScore ?? 80,
    rank: partial.rank ?? 0,
    strength: partial.strength ?? "Strong",
    marginsPass: partial.marginsPass ?? true,
    ...partial,
  };
}

describe("worth considering selection", () => {
  it("enforces max 3 and requires 2–3 to compare", () => {
    expect(DISCOVERY_COMPARE_MIN).toBe(2);
    expect(DISCOVERY_COMPARE_MAX).toBe(3);
    expect(isValidCompareSelectionCount(1)).toBe(false);
    expect(isValidCompareSelectionCount(2)).toBe(true);
    expect(isValidCompareSelectionCount(3)).toBe(true);
    expect(isValidCompareSelectionCount(4)).toBe(false);

    let ids: string[] = [];
    for (const id of ["a", "b", "c"]) {
      const next = toggleWorthConsideringMark(ids, id);
      expect(next.blockedAtMax).toBe(false);
      ids = next.ids;
    }
    expect(ids).toEqual(["a", "b", "c"]);
    const blocked = toggleWorthConsideringMark(ids, "d");
    expect(blocked.blockedAtMax).toBe(true);
    expect(blocked.ids).toEqual(["a", "b", "c"]);
  });

  it("clears stale marks when cards leave the shortlist", () => {
    expect(
      revalidateWorthConsideringMarks(["a", "b", "c"], ["a", "c"]),
    ).toEqual(["a", "c"]);
    expect(revalidateWorthConsideringMarks(["a"], new Set(["b"]))).toEqual([]);
  });
});

describe("skills compare winner", () => {
  it("picks highest composite among selected only", () => {
    const pick = pickCompareWinner([
      signal({
        candidateId: "low",
        name: "Low",
        compositeScore: 0.4,
        fitScore: 100,
        rank: 0,
      }),
      signal({
        candidateId: "high",
        name: "High",
        compositeScore: 0.9,
        fitScore: 70,
        rank: 1,
      }),
      signal({
        candidateId: "mid",
        name: "Mid",
        compositeScore: 0.7,
        fitScore: 90,
        rank: 2,
      }),
    ]);
    expect(pick.advised.candidateId).toBe("high");
    expect(pick.advised.catalogKey).toBe("high");
    expect(pick.ordered.map((o) => o.candidateId)).toEqual([
      "high",
      "mid",
      "low",
    ]);
  });

  it("is stable for fixed payloads and falls back to Fit", () => {
    const a = signal({
      candidateId: "a",
      name: "Alpha",
      compositeScore: null,
      fitScore: 95,
      rank: 2,
    });
    const b = signal({
      candidateId: "b",
      name: "Beta",
      compositeScore: null,
      fitScore: 88,
      rank: 0,
    });
    const first = pickCompareWinner([a, b]);
    const second = pickCompareWinner([b, a]);
    expect(first.advised.candidateId).toBe("a");
    expect(second.advised.candidateId).toBe("a");
  });

  it("reads composite + catalogKey from fitBreakdown", () => {
    const s = signalsFromFitBreakdown(
      JSON.stringify({
        catalogKey: "led-wand",
        wave2: { compositeScore: 0.81 },
      }),
      {
        candidateId: "c1",
        name: "LED Wand",
        fitScore: 90,
        rank: 1,
        strength: "Okay",
        marginsPass: true,
      },
    );
    expect(s.catalogKey).toBe("led-wand");
    expect(s.compositeScore).toBe(0.81);
  });
});
