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

import {
  syncCatalogSeedToPool,
  upsertPath1PoolCandidates,
} from "@/lib/discovery/pool";

afterEach(() => {
  delete process.env.DISCOVERY_POOL_V2;
  delete process.env.DISCOVERY_LIVE_SEARCH;
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
