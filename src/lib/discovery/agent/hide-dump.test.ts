import { describe, expect, it } from "vitest";
import { COMPETITION_HIGH_MIN } from "@/lib/discovery/scoring/constants";
import {
  applyHideDumpToRanked,
  collectHideDumpTier1Names,
  isDiscoveryDumpHidden,
} from "@/lib/discovery/agent/hide-dump";

describe("isDiscoveryDumpHidden", () => {
  it("hides high competition with Ishtari/EGLOW/Platza", () => {
    expect(
      isDiscoveryDumpHidden({
        competition: COMPETITION_HIGH_MIN,
        tier1Names: ["Ishtari"],
      }),
    ).toBe(true);
    expect(
      isDiscoveryDumpHidden({
        competition: 0.9,
        tier1Names: ["eglow.store"],
      }),
    ).toBe(true);
  });

  it("does not hide high competition with no Tier-1 names", () => {
    expect(
      isDiscoveryDumpHidden({
        competition: 0.99,
        tier1Names: [],
      }),
    ).toBe(false);
  });

  it("does not hide medium/low competition even with Ishtari", () => {
    expect(
      isDiscoveryDumpHidden({
        competition: COMPETITION_HIGH_MIN - 0.01,
        tier1Names: ["Ishtari"],
      }),
    ).toBe(false);
  });

  it("does not hide when scores are missing", () => {
    expect(
      isDiscoveryDumpHidden({ competition: null, tier1Names: ["Ishtari"] }),
    ).toBe(false);
    expect(
      isDiscoveryDumpHidden({ competition: undefined, tier1Names: ["Platza"] }),
    ).toBe(false);
  });
});

describe("applyHideDumpToRanked retrieve", () => {
  const dump = {
    p: { key: "dump", tier1Marketplaces: ["Ishtari"] },
  };
  const gap = {
    p: { key: "gap", tier1Marketplaces: [] as string[] },
  };
  const scores = new Map([
    [
      "dump",
      { competitionScore: COMPETITION_HIGH_MIN, rawEvidenceJson: null },
    ],
    ["gap", { competitionScore: 0.2, rawEvidenceJson: null }],
  ]);

  it("drops high+Ishtari when POOL_V2 + agent UI and scores exist", () => {
    const kept = applyHideDumpToRanked([dump, gap], scores, {
      poolV2: true,
      agentUi: true,
    });
    expect(kept.map((r) => r.p.key)).toEqual(["gap"]);
  });

  it("does not hide when scores are missing", () => {
    const noScores = new Map<string, { competitionScore: null }>([
      ["dump", { competitionScore: null }],
      ["gap", { competitionScore: null }],
    ]);
    const kept = applyHideDumpToRanked([dump, gap], noScores, {
      poolV2: true,
      agentUi: true,
    });
    expect(kept.map((r) => r.p.key)).toEqual(["dump", "gap"]);
  });

  it("does not hide when agent UI is off (current 5-card retrieve)", () => {
    const kept = applyHideDumpToRanked([dump, gap], scores, {
      poolV2: true,
      agentUi: false,
    });
    expect(kept.map((r) => r.p.key)).toEqual(["dump", "gap"]);
  });

  it("does not fake an Ishtari filter on catalog-only (POOL_V2 off)", () => {
    const kept = applyHideDumpToRanked([dump, gap], scores, {
      poolV2: false,
      agentUi: true,
    });
    expect(kept.map((r) => r.p.key)).toEqual(["dump", "gap"]);
  });

  it("hides from live evidence names even when pool JSON is empty", () => {
    const liveDump = { p: { key: "live", tier1Marketplaces: [] as string[] } };
    const liveScores = new Map([
      [
        "live",
        {
          competitionScore: 0.9,
          rawEvidenceJson: JSON.stringify({ tier1Found: ["Ishtari"] }),
        },
      ],
    ]);
    const kept = applyHideDumpToRanked([liveDump], liveScores, {
      poolV2: true,
      agentUi: true,
    });
    expect(kept).toEqual([]);
  });

  it("keeps existing rank order of remaining rows (no new scorer)", () => {
    const a = { p: { key: "a", tier1Marketplaces: [] as string[] } };
    const b = { p: { key: "b", tier1Marketplaces: [] as string[] } };
    const kept = applyHideDumpToRanked([dump, a, b], scores, {
      poolV2: true,
      agentUi: true,
    });
    expect(kept.map((r) => r.p.key)).toEqual(["a", "b"]);
  });
});

describe("collectHideDumpTier1Names", () => {
  it("merges pool names with evidence tier1Found", () => {
    expect(
      collectHideDumpTier1Names(
        ["EGLOW"],
        JSON.stringify({ tier1Found: ["Platza"] }),
      ),
    ).toEqual(["EGLOW", "Platza"]);
  });
});
