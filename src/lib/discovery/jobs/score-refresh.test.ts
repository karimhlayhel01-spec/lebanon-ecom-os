import { afterEach, describe, expect, it, vi } from "vitest";
import type { DiscoverySearchProvider } from "@/lib/discovery/search-provider";
import { DISCOVERY_SCORE_QUERIES_PER_PRODUCT_MAX } from "@/lib/constants";

vi.mock("@/lib/discovery/pool", () => ({
  syncCatalogSeedToPool: vi.fn(async () => ({ upserted: 2 })),
}));

/** In-memory stand-in for the §7 monthly ledger — pure helpers stay real. */
const ledger = vi.hoisted(() => ({ used: 0 }));

vi.mock("@/lib/discovery/search-usage", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/discovery/search-usage")>();
  return {
    ...actual,
    loadMonthlySearchUsage: vi.fn(async (monthKey?: string) => ({
      monthKey: monthKey ?? actual.currentMonthKey(),
      queriesUsed: ledger.used,
    })),
    recordMonthlySearchQueries: vi.fn(
      async (input: { monthKey?: string; queries: number }) => {
        ledger.used += input.queries;
        return {
          monthKey: input.monthKey ?? actual.currentMonthKey(),
          queriesUsed: ledger.used,
        };
      },
    ),
  };
});

/** Previous status per pool row, so "don't clobber an ok snapshot" is testable. */
const priorStatus = new Map<string, string>();
const ensureScoreRow = vi.fn(async (id: string) => ({
  id,
  lastScoreStatus: priorStatus.get(id) ?? "never",
}));
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
    discoverySearchUsage: { monthKey: "month_key" },
  },
}));

import { runScoreRefreshJob } from "@/lib/discovery/jobs/score-refresh";

afterEach(() => {
  delete process.env.DISCOVERY_POOL_V2;
  delete process.env.DISCOVERY_LIVE_SEARCH;
  delete process.env.DISCOVERY_SOFT_COMPETITION_BUDGET;
  delete process.env.DISCOVERY_SEARCH_MONTHLY_QUERY_CAP;
  priorStatus.clear();
  ledger.used = 0;
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
    const raw = JSON.parse(snap.rawEvidenceJson!) as Record<string, unknown>;
    expect(raw.source).toBe("heuristic_seed");
    expect(raw).not.toHaveProperty("abroad");
    expect(raw).not.toHaveProperty("lebanon");
    expect(raw).not.toHaveProperty("tier1Found");
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
      rawEvidenceJson: string;
    };
    expect(snap.abroadDemandScore).toBeGreaterThan(0.3);
    expect(snap.demandPath).toBeTruthy();
    expect(snap.confidence).toBeGreaterThan(0.3);
    const raw = JSON.parse(snap.rawEvidenceJson) as {
      source: string;
      abroad: { count: number; results: { domain: string }[] };
      lebanon: { count: number; results: { domain: string }[] };
      tier1Found: string[];
    };
    expect(raw.source).toBe("live_search");
    expect(raw.abroad.count).toBeGreaterThan(0);
    expect(raw.abroad.results[0].domain).toBe("amazon.com");
    expect(raw.lebanon.count).toBeGreaterThan(0);
    expect(raw.tier1Found).toEqual([]);
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

describe("WAVE-2 §7 heuristics never overwrite last-known live scores", () => {
  it("live enabled + noop provider fails the product instead of writing heuristics", async () => {
    process.env.DISCOVERY_POOL_V2 = "1";
    process.env.DISCOVERY_LIVE_SEARCH = "1";

    // Exactly what getDiscoverySearchProvider() returns with no API key.
    const noopProvider: DiscoverySearchProvider = {
      async search() {
        return { items: [], queriesUsed: 0 };
      },
    };

    const result = await runScoreRefreshJob({
      provider: noopProvider,
      limit: 2,
    });

    expect(result.refreshedOk).toBe(0);
    expect(result.refreshedFailed).toBe(2);
    // The bug this guards: a heuristic snapshot written over real live scores.
    expect(applySuccessfulScoreRefresh).not.toHaveBeenCalled();
    expect(applyFailedScoreRefresh).toHaveBeenCalledTimes(2);
    const [, message] = applyFailedScoreRefresh.mock.calls[0];
    expect(message).toContain("no search query ran");
    expect(message).toContain("SERPAPI_API_KEY");
    expect(result.queriesUsed).toBe(0);
    expect(result.ok).toBe(false);
  });

  it("still writes heuristics when live search is intentionally OFF", async () => {
    process.env.DISCOVERY_POOL_V2 = "1";
    delete process.env.DISCOVERY_LIVE_SEARCH;

    const result = await runScoreRefreshJob({
      provider: {
        async search() {
          return { items: [], queriesUsed: 0 };
        },
      },
      limit: 1,
    });

    expect(result.refreshedFailed).toBe(0);
    expect(result.refreshedOk).toBe(1);
    expect(applySuccessfulScoreRefresh).toHaveBeenCalledTimes(1);
  });

  it("a provider throw fails the product and keeps last-known", async () => {
    process.env.DISCOVERY_POOL_V2 = "1";
    process.env.DISCOVERY_LIVE_SEARCH = "1";

    const result = await runScoreRefreshJob({
      provider: {
        async search() {
          throw new Error("SerpAPI request timed out after 30000ms");
        },
      },
      limit: 1,
    });

    expect(result.refreshedFailed).toBe(1);
    expect(applySuccessfulScoreRefresh).not.toHaveBeenCalled();
    expect(applyFailedScoreRefresh).toHaveBeenCalledWith(
      "pool-1",
      "SerpAPI request timed out after 30000ms",
    );
  });

  it("bills the month for queries spent before a mid-plan provider fault", async () => {
    process.env.DISCOVERY_POOL_V2 = "1";
    process.env.DISCOVERY_LIVE_SEARCH = "1";

    let calls = 0;
    const result = await runScoreRefreshJob({
      provider: {
        async search() {
          calls += 1;
          if (calls === 3) throw new Error("SerpAPI HTTP 503 (after 3 attempts)");
          return {
            queriesUsed: 1,
            items: [{ title: "Hit", url: "https://www.amazon.com/dp/1" }],
          };
        },
      },
      limit: 1,
      queryCapPerProduct: 6,
      monthlyQueryCap: 100,
    });

    expect(result.refreshedFailed).toBe(1);
    expect(applySuccessfulScoreRefresh).not.toHaveBeenCalled();
    // Two queries really went out before the fault — the month must pay for them.
    expect(result.queriesUsed).toBe(2);
    expect(ledger.used).toBe(2);
    expect(result.monthlyRemaining).toBe(98);
  });

  it("empty evidence does not clobber a snapshot that previously scored ok", async () => {
    process.env.DISCOVERY_POOL_V2 = "1";
    process.env.DISCOVERY_LIVE_SEARCH = "1";
    priorStatus.set("pool-1", "ok");

    const result = await runScoreRefreshJob({
      provider: {
        async search() {
          return { queriesUsed: 1, items: [] };
        },
      },
      limit: 1,
      queryCapPerProduct: 3,
    });

    expect(result.emptyEvidenceCount).toBe(1);
    expect(result.preservedOnEmptyEvidence).toBe(1);
    expect(result.refreshedOk).toBe(0);
    expect(result.refreshedFailed).toBe(0);
    expect(applySuccessfulScoreRefresh).not.toHaveBeenCalled();
    expect(applyFailedScoreRefresh).not.toHaveBeenCalled();
    // Queries were really spent — the month must still be billed for them.
    expect(result.queriesUsed).toBe(3);
  });

  it("empty evidence still writes when there is no good snapshot to protect", async () => {
    process.env.DISCOVERY_POOL_V2 = "1";
    process.env.DISCOVERY_LIVE_SEARCH = "1";
    priorStatus.set("pool-1", "failed");

    const result = await runScoreRefreshJob({
      provider: {
        async search() {
          return { queriesUsed: 1, items: [] };
        },
      },
      limit: 1,
      queryCapPerProduct: 3,
    });

    expect(result.preservedOnEmptyEvidence).toBe(0);
    expect(result.refreshedOk).toBe(1);
    expect(applySuccessfulScoreRefresh).toHaveBeenCalledTimes(1);
  });
});

describe("WAVE-2 §7 monthly search quota ledger", () => {
  it("stops cleanly at the monthly cap without corrupting scores", async () => {
    process.env.DISCOVERY_POOL_V2 = "1";
    process.env.DISCOVERY_LIVE_SEARCH = "1";
    ledger.used = 10;

    let calls = 0;
    const result = await runScoreRefreshJob({
      provider: {
        async search() {
          calls += 1;
          return { queriesUsed: 1, items: [] };
        },
      },
      limit: 2,
      queryCapPerProduct: 3,
      monthlyQueryCap: 10,
    });

    expect(calls).toBe(0);
    expect(result.quotaStopped).toBe(true);
    expect(result.skippedForQuota).toBe(2);
    expect(result.refreshedOk).toBe(0);
    // Not a failure: cron must exit 0 on a clean quota stop.
    expect(result.refreshedFailed).toBe(0);
    expect(result.ok).toBe(true);
    expect(applySuccessfulScoreRefresh).not.toHaveBeenCalled();
    expect(applyFailedScoreRefresh).not.toHaveBeenCalled();
    expect(result.monthlyRemaining).toBe(0);
    expect(result.message).toContain("monthly search cap 10 reached");
  });

  it("spends only the allowance that is left, then stops", async () => {
    process.env.DISCOVERY_POOL_V2 = "1";
    process.env.DISCOVERY_LIVE_SEARCH = "1";
    ledger.used = 8;

    let calls = 0;
    const result = await runScoreRefreshJob({
      provider: {
        async search() {
          calls += 1;
          return {
            queriesUsed: 1,
            items: [{ title: "Hit", url: "https://www.amazon.com/dp/1" }],
          };
        },
      },
      limit: 2,
      queryCapPerProduct: 6,
      monthlyQueryCap: 10,
    });

    // 2 left in the month: product 1 gets a 2-query budget, product 2 none.
    expect(calls).toBe(2);
    expect(result.queriesUsed).toBe(2);
    expect(result.refreshedOk).toBe(1);
    expect(result.skippedForQuota).toBe(1);
    expect(result.quotaStopped).toBe(true);
    expect(result.monthlyQueriesUsed).toBe(10);
    expect(result.monthlyRemaining).toBe(0);
  });

  it("records the month's spend and reports the remaining allowance", async () => {
    process.env.DISCOVERY_POOL_V2 = "1";
    process.env.DISCOVERY_LIVE_SEARCH = "1";

    const result = await runScoreRefreshJob({
      provider: {
        async search() {
          return {
            queriesUsed: 1,
            items: [{ title: "Hit", url: "https://www.amazon.com/dp/1" }],
          };
        },
      },
      limit: 1,
      queryCapPerProduct: 4,
      monthlyQueryCap: 100,
    });

    expect(result.queriesUsed).toBe(4);
    expect(ledger.used).toBe(4);
    expect(result.monthlyQueriesUsed).toBe(4);
    expect(result.monthlyRemaining).toBe(96);
    expect(result.quotaStopped).toBe(false);
  });

  it("does not touch the ledger when live search is off", async () => {
    process.env.DISCOVERY_POOL_V2 = "1";
    delete process.env.DISCOVERY_LIVE_SEARCH;

    const result = await runScoreRefreshJob({ limit: 2 });
    expect(ledger.used).toBe(0);
    expect(result.queriesUsed).toBe(0);
    expect(result.quotaStopped).toBe(false);
  });
});

describe("WAVE-2 §9 / §10 Serper scoring vendor through the score job", () => {
  it("counts Serper searches on the monthly ledger and stops at the cap", async () => {
    const { createSerperSearchProvider } =
      await import("@/lib/discovery/providers/serper");

    process.env.DISCOVERY_POOL_V2 = "1";
    process.env.DISCOVERY_LIVE_SEARCH = "1";
    ledger.used = 8;

    let calls = 0;
    const provider = createSerperSearchProvider({
      apiKey: "serper-test",
      fetchFn: async () => {
        calls += 1;
        return new Response(
          JSON.stringify({
            organic: [
              {
                title: "Hit",
                link: "https://www.amazon.com/dp/1",
                snippet: "ok",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
      sleepFn: async () => {},
    });

    const result = await runScoreRefreshJob({
      provider,
      limit: 2,
      queryCapPerProduct: 6,
      monthlyQueryCap: 10,
    });

    // 2 credits left in the month → one product's first two legs, then stop.
    expect(calls).toBe(2);
    expect(result.queriesUsed).toBe(2);
    expect(result.quotaStopped).toBe(true);
    expect(result.monthlyRemaining).toBe(0);
    expect(result.ok).toBe(true);
    expect(applyFailedScoreRefresh).not.toHaveBeenCalled();
  });

  it("a Serper 503 after retries fails the product and keeps last-known scores", async () => {
    const { createSerperSearchProvider } =
      await import("@/lib/discovery/providers/serper");

    process.env.DISCOVERY_POOL_V2 = "1";
    process.env.DISCOVERY_LIVE_SEARCH = "1";

    const provider = createSerperSearchProvider({
      apiKey: "serper-test",
      fetchFn: async () => new Response("nope", { status: 503 }),
      maxAttempts: 2,
      sleepFn: async () => {},
    });

    const result = await runScoreRefreshJob({
      provider,
      limit: 1,
      monthlyQueryCap: 100,
    });

    expect(result.refreshedFailed).toBe(1);
    expect(applySuccessfulScoreRefresh).not.toHaveBeenCalled();
    expect(applyFailedScoreRefresh).toHaveBeenCalledWith(
      "pool-1",
      expect.stringMatching(/Serper Search HTTP 503/),
    );
  });
});
