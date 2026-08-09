import { afterEach, describe, expect, it, vi } from "vitest";
import { runPath1IntakeJob } from "@/lib/discovery/jobs/intake";
import type { DiscoverySearchProvider } from "@/lib/discovery/search-provider";
import { DISCOVERY_INTAKE_QUERIES_PER_RUN_MAX } from "@/lib/constants";

vi.mock("@/lib/discovery/pool", () => ({
  syncCatalogSeedToPool: vi.fn(async () => ({ upserted: 20 })),
  upsertPath1PoolCandidates: vi.fn(async (rows: unknown[]) => ({
    upserted: rows.length,
    inserted: rows.length,
    updated: 0,
  })),
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

import {
  syncCatalogSeedToPool,
  upsertPath1PoolCandidates,
} from "@/lib/discovery/pool";

afterEach(() => {
  delete process.env.DISCOVERY_POOL_V2;
  delete process.env.DISCOVERY_LIVE_SEARCH;
  delete process.env.DISCOVERY_SEARCH_MONTHLY_QUERY_CAP;
  ledger.used = 0;
  vi.clearAllMocks();
});

describe("runPath1IntakeJob (mock provider — no network)", () => {
  it("seed only when LIVE_SEARCH off", async () => {
    process.env.DISCOVERY_POOL_V2 = "1";
    delete process.env.DISCOVERY_LIVE_SEARCH;

    const result = await runPath1IntakeJob();
    expect(result.skippedLiveSearch).toBe(true);
    expect(result.ingested).toBe(0);
    expect(result.searchQueriesUsed).toBe(0);
    expect(result.seeded).toBe(20);
    expect(upsertPath1PoolCandidates).not.toHaveBeenCalled();
  });

  it("seed only when pool flag off even if live on", async () => {
    delete process.env.DISCOVERY_POOL_V2;
    process.env.DISCOVERY_LIVE_SEARCH = "1";
    const result = await runPath1IntakeJob();
    expect(result.skippedLiveSearch).toBe(true);
    expect(upsertPath1PoolCandidates).not.toHaveBeenCalled();
  });

  it("enforces query cap and upserts normalized winning products", async () => {
    process.env.DISCOVERY_POOL_V2 = "1";
    process.env.DISCOVERY_LIVE_SEARCH = "1";

    let calls = 0;
    const provider: DiscoverySearchProvider = {
      async search() {
        calls += 1;
        return {
          queriesUsed: 1,
          items: [
            {
              title: `Winning Gadget ${calls}`,
              url: `https://shop.example.com/p/${calls}`,
              price: 24 + calls,
              snippet: "US bestseller",
            },
            {
              title: "Alibaba Dump",
              url: "https://www.alibaba.com/product/x",
              price: 1,
            },
          ],
        };
      },
    };

    const cap = 5;
    const result = await runPath1IntakeJob({ provider, queryCap: cap });
    expect(result.queryCap).toBe(cap);
    expect(result.searchQueriesUsed).toBe(cap);
    expect(calls).toBe(cap);
    expect(result.skippedLiveSearch).toBe(false);
    expect(result.provider).toBe("SerpAPI");
    expect(result.ingested).toBeGreaterThan(0);
    expect(upsertPath1PoolCandidates).toHaveBeenCalled();
    const rows = vi.mocked(upsertPath1PoolCandidates).mock.calls[0][0];
    expect(rows.every((r) => r.source === "path1_search")).toBe(true);
    expect(rows.every((r) => !r.sourceUrl.includes("alibaba"))).toBe(true);
    expect(syncCatalogSeedToPool).toHaveBeenCalled();
  });

  it("documents default intake cap constant", () => {
    expect(DISCOVERY_INTAKE_QUERIES_PER_RUN_MAX).toBe(40);
  });
});

describe("runPath1IntakeJob resilience (§7)", () => {
  it("persists candidates from queries that succeeded when one provider call throws", async () => {
    process.env.DISCOVERY_POOL_V2 = "1";
    process.env.DISCOVERY_LIVE_SEARCH = "1";

    let calls = 0;
    const provider: DiscoverySearchProvider = {
      async search() {
        calls += 1;
        // Third leg dies; the two before it must not be thrown away.
        if (calls === 3) throw new Error("SerpAPI HTTP 500");
        return {
          queriesUsed: 1,
          items: [
            {
              title: `Winning Gadget ${calls}`,
              url: `https://shop.example.com/p/${calls}`,
              price: 24 + calls,
              snippet: "US bestseller",
            },
          ],
        };
      },
    };

    const result = await runPath1IntakeJob({ provider, queryCap: 4 });

    expect(result.ok).toBe(true);
    expect(calls).toBe(4);
    expect(result.searchQueriesUsed).toBe(3);
    expect(result.searchQueriesFailed).toBe(1);
    expect(upsertPath1PoolCandidates).toHaveBeenCalled();
    const rows = vi.mocked(upsertPath1PoolCandidates).mock.calls[0][0];
    expect(rows.length).toBe(3);
    expect(result.ingested).toBe(3);
    expect(result.message).toContain("SerpAPI HTTP 500");
  });

  it("reports not-ok when every query fails, leaving the pool untouched", async () => {
    process.env.DISCOVERY_POOL_V2 = "1";
    process.env.DISCOVERY_LIVE_SEARCH = "1";

    const result = await runPath1IntakeJob({
      provider: {
        async search() {
          throw new Error("SerpAPI request timed out after 30000ms");
        },
      },
      queryCap: 3,
    });

    expect(result.ok).toBe(false);
    expect(result.searchQueriesUsed).toBe(0);
    expect(result.searchQueriesFailed).toBe(3);
    expect(result.ingested).toBe(0);
    expect(result.message).toContain("timed out");
    // Seed sync still ran — the curated fallback is never at the vendor's mercy.
    expect(syncCatalogSeedToPool).toHaveBeenCalled();
  });

  it("stops cleanly at the monthly cap before spending a query", async () => {
    process.env.DISCOVERY_POOL_V2 = "1";
    process.env.DISCOVERY_LIVE_SEARCH = "1";
    ledger.used = 100;

    let calls = 0;
    const result = await runPath1IntakeJob({
      provider: {
        async search() {
          calls += 1;
          return { queriesUsed: 1, items: [] };
        },
      },
      queryCap: 5,
      monthlyQueryCap: 100,
    });

    expect(calls).toBe(0);
    expect(result.ok).toBe(true);
    expect(result.quotaStopped).toBe(true);
    expect(result.searchQueriesUsed).toBe(0);
    expect(result.monthlyRemaining).toBe(0);
    expect(result.message).toContain("Monthly search cap 100 reached");
  });

  it("spends only the remaining allowance, then stops", async () => {
    process.env.DISCOVERY_POOL_V2 = "1";
    process.env.DISCOVERY_LIVE_SEARCH = "1";
    ledger.used = 98;

    let calls = 0;
    const result = await runPath1IntakeJob({
      provider: {
        async search() {
          calls += 1;
          return {
            queriesUsed: 1,
            items: [
              {
                title: `Winning Gadget ${calls}`,
                url: `https://shop.example.com/p/${calls}`,
                price: 30,
              },
            ],
          };
        },
      },
      queryCap: 10,
      monthlyQueryCap: 100,
    });

    expect(calls).toBe(2);
    expect(result.searchQueriesUsed).toBe(2);
    expect(result.quotaStopped).toBe(true);
    expect(result.monthlyQueriesUsed).toBe(100);
    expect(result.monthlyRemaining).toBe(0);
    // Partial run still persists what it found.
    expect(result.ingested).toBe(2);
  });
});
