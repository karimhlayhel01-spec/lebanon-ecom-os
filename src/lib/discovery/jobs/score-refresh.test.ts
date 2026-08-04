import { afterEach, describe, expect, it, vi } from "vitest";
import type { DiscoverySearchProvider } from "@/lib/discovery/search-provider";
import { DISCOVERY_SCORE_QUERIES_PER_PRODUCT_MAX } from "@/lib/constants";

vi.mock("@/lib/discovery/pool", () => ({
  syncCatalogSeedToPool: vi.fn(async () => ({ upserted: 2 })),
}));

const ensureScoreRow = vi.fn(async (id: string) => ({ id }));
const applySuccessfulScoreRefresh = vi.fn(
  async (id: string, snap: unknown) => ({
    id,
    snap,
  }),
);
const applyFailedScoreRefresh = vi.fn(async (id: string, err: string) => ({
  id,
  err,
}));

vi.mock("@/lib/discovery/scores", () => ({
  ensureScoreRow: (id: string) => ensureScoreRow(id),
  applySuccessfulScoreRefresh: (id: string, snap: unknown) =>
    applySuccessfulScoreRefresh(id, snap),
  applyFailedScoreRefresh: (id: string, err: string) =>
    applyFailedScoreRefresh(id, err),
}));

const poolRows = [
  {
    id: "pool-1",
    catalogKey: "led_facial_wand",
    nameEn: "LED Facial Wand",
    category: "beauty_personal_care",
    difficulty: 1,
    risk: 1,
    tier1Marketplaces: "[]",
    active: true,
  },
  {
    id: "pool-2",
    catalogKey: "crowded_sku",
    nameEn: "Crowded Gadget",
    category: "phone_tech_accessories",
    difficulty: 1,
    risk: 1,
    tier1Marketplaces: JSON.stringify(["Ishtari", "EGLOW"]),
    active: true,
  },
];

vi.mock("@/db", () => ({
  ensureMigrated: vi.fn(async () => {}),
  db: {
    select: () => ({
      from: () => ({
        where: async () => poolRows,
      }),
    }),
  },
  schema: {
    discoveryProductPool: { active: "active" },
  },
}));

import { runScoreRefreshJob } from "@/lib/discovery/jobs/score-refresh";

afterEach(() => {
  delete process.env.DISCOVERY_POOL_V2;
  delete process.env.DISCOVERY_LIVE_SEARCH;
  delete process.env.DISCOVERY_SOFT_COMPETITION_BUDGET;
  vi.clearAllMocks();
});

describe("runScoreRefreshJob live evidence (mock provider)", () => {
  it("uses heuristics when LIVE_SEARCH off (no provider calls)", async () => {
    process.env.DISCOVERY_POOL_V2 = "1";
    delete process.env.DISCOVERY_LIVE_SEARCH;

    let calls = 0;
    const provider: DiscoverySearchProvider = {
      async search() {
        calls += 1;
        return { items: [], queriesUsed: 1 };
      },
    };

    const result = await runScoreRefreshJob({ provider, limit: 2 });
    expect(result.liveSearch).toBe(false);
    expect(calls).toBe(0);
    expect(result.refreshedOk).toBe(2);
    expect(applySuccessfulScoreRefresh).toHaveBeenCalled();
    const snap = applySuccessfulScoreRefresh.mock.calls[0][1] as {
      rawEvidenceJson?: string;
    };
    expect(JSON.stringify(snap)).toContain("heuristic");
  });

  it("persists live scores from mocked provider under flag + enforces cap", async () => {
    process.env.DISCOVERY_POOL_V2 = "1";
    process.env.DISCOVERY_LIVE_SEARCH = "1";

    let calls = 0;
    const provider: DiscoverySearchProvider = {
      async search(input) {
        calls += 1;
        if (input.kind === "abroad_demand") {
          return {
            queriesUsed: 1,
            items: [
              {
                title: "Amazon US bestseller",
                url: "https://www.amazon.com/dp/1",
              },
            ],
          };
        }
        if (input.kind === "lebanon_demand") {
          return {
            queriesUsed: 1,
            items: [
              {
                title: "Quiet in Lebanon",
                url: "https://example.com/lb-mention",
                snippet: "rarely seen in Beirut",
              },
            ],
          };
        }
        return { queriesUsed: 1, items: [] };
      },
    };

    const cap = 4;
    const result = await runScoreRefreshJob({
      provider,
      queryCapPerProduct: cap,
      limit: 1,
    });

    expect(result.liveSearch).toBe(true);
    expect(result.queryCapPerProduct).toBe(cap);
    expect(result.queriesUsed).toBeLessThanOrEqual(cap);
    expect(calls).toBeLessThanOrEqual(cap);
    expect(result.refreshedOk).toBe(1);
    expect(result.emptyEvidenceCount).toBe(0);

    const snap = applySuccessfulScoreRefresh.mock.calls[0][1] as {
      abroadDemandScore: number;
      lebanonDemandScore: number;
      demandPath: string | null;
      confidence: number;
    };
    expect(snap.abroadDemandScore).toBeGreaterThan(0.3);
    expect(snap.demandPath).toBeTruthy();
    expect(snap.confidence).toBeGreaterThan(0.3);
  });

  it("counts empty-evidence and still writes scores (shadow log)", async () => {
    process.env.DISCOVERY_POOL_V2 = "1";
    process.env.DISCOVERY_LIVE_SEARCH = "1";

    const provider: DiscoverySearchProvider = {
      async search() {
        return { queriesUsed: 1, items: [] };
      },
    };

    const result = await runScoreRefreshJob({
      provider,
      limit: 1,
      queryCapPerProduct: 3,
    });
    expect(result.emptyEvidenceCount).toBe(1);
    expect(result.refreshedOk).toBe(1);
    const snap = applySuccessfulScoreRefresh.mock.calls[0][1] as {
      shadowWouldExclude: boolean;
      shadowExcludeReason: string | null;
    };
    expect(snap.shadowWouldExclude).toBe(true);
    expect(snap.shadowExcludeReason).toBe("empty_search_evidence");
  });

  it("failure keeps last-known via applyFailedScoreRefresh (no success overwrite)", async () => {
    process.env.DISCOVERY_POOL_V2 = "1";
    process.env.DISCOVERY_LIVE_SEARCH = "1";

    const result = await runScoreRefreshJob({
      limit: 1,
      failKeys: new Map([["led_facial_wand", "simulated provider timeout"]]),
      provider: {
        async search() {
          throw new Error("should not be called for failKeys");
        },
      },
    });

    expect(result.refreshedFailed).toBe(1);
    expect(applyFailedScoreRefresh).toHaveBeenCalledWith(
      "pool-1",
      "simulated provider timeout",
    );
    expect(applySuccessfulScoreRefresh).not.toHaveBeenCalled();
  });

  it("documents per-product query cap constant", () => {
    expect(DISCOVERY_SCORE_QUERIES_PER_PRODUCT_MAX).toBe(6);
  });
});
