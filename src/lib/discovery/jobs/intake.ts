/**
 * Wave 2 Path 1 intake job (scheduled, weekly-ish intent).
 * Always syncs catalog.ts seed/fallback. Live SerpAPI search is gated by
 * DISCOVERY_LIVE_SEARCH + API key — never called from Discovery page loads.
 *
 * Isolation: only ops/cron may call this — never Discovery page handlers,
 * accept, journey, or Finance.
 */

import { DISCOVERY_INTAKE_QUERIES_PER_RUN_MAX } from "@/lib/constants";
import {
  isDiscoveryLiveSearchEnabled,
  isDiscoveryPoolV2Enabled,
} from "@/lib/discovery/flags";
import {
  syncCatalogSeedToPool,
  upsertPath1PoolCandidates,
} from "@/lib/discovery/pool";
import {
  buildPath1IntakeQueries,
  dedupeNormalizedCandidates,
  normalizeSearchItemToPoolCandidate,
} from "@/lib/discovery/normalize";
import {
  DISCOVERY_SEARCH_PROVIDER_NAME,
  getDiscoverySearchProvider,
  type DiscoverySearchProvider,
} from "@/lib/discovery/search-provider";

export type IntakeJobResult = {
  ok: boolean;
  seeded: number;
  ingested: number;
  searchQueriesUsed: number;
  queryCap: number;
  skippedLiveSearch: boolean;
  provider: typeof DISCOVERY_SEARCH_PROVIDER_NAME | "noop";
  message: string;
};

export type Path1IntakeJobOptions = {
  /** Inject mock provider in unit tests (no network). */
  provider?: DiscoverySearchProvider;
  /** Override query cap (tests). */
  queryCap?: number;
};

/**
 * Run Path 1 intake.
 * Flag off → catalog seed only. Flag on + SerpAPI key → US/EU shopping queries
 * → normalize → upsert discovery_product_pool (winning products, not brands).
 */
export async function runPath1IntakeJob(
  opts?: Path1IntakeJobOptions,
): Promise<IntakeJobResult> {
  const queryCap = opts?.queryCap ?? DISCOVERY_INTAKE_QUERIES_PER_RUN_MAX;
  const { upserted } = await syncCatalogSeedToPool();

  if (!isDiscoveryPoolV2Enabled()) {
    return {
      ok: true,
      seeded: upserted,
      ingested: 0,
      searchQueriesUsed: 0,
      queryCap,
      skippedLiveSearch: true,
      provider: "noop",
      message: "Pool flag off — catalog seed synced only",
    };
  }

  if (!isDiscoveryLiveSearchEnabled()) {
    return {
      ok: true,
      seeded: upserted,
      ingested: 0,
      searchQueriesUsed: 0,
      queryCap,
      skippedLiveSearch: true,
      provider: "noop",
      message: "Live search off — catalog seed synced; no Path 1 search",
    };
  }

  const provider = opts?.provider ?? getDiscoverySearchProvider();
  const planned = buildPath1IntakeQueries(queryCap);
  let searchQueriesUsed = 0;
  const normalized: ReturnType<typeof normalizeSearchItemToPoolCandidate>[] = [];

  for (const plan of planned) {
    if (searchQueriesUsed >= queryCap) break;

    const remaining = queryCap - searchQueriesUsed;
    if (remaining <= 0) break;

    const res = await provider.search({
      kind: "path1_intake",
      query: plan.query,
    });

    const used = Math.min(Math.max(0, res.queriesUsed), remaining);
    searchQueriesUsed += used;
    // Cap means we stop issuing further queries even if this response was rich.
    if (used === 0 && res.queriesUsed === 0) {
      // noop provider — no progress; avoid spinning all planned queries.
      break;
    }

    for (const item of res.items) {
      const row = normalizeSearchItemToPoolCandidate(item, plan.category);
      if (row) normalized.push(row);
    }
  }

  const deduped = dedupeNormalizedCandidates(
    normalized.filter((r): r is NonNullable<typeof r> => r != null),
  );
  const { upserted: ingested } = await upsertPath1PoolCandidates(deduped);

  const liveWorked = searchQueriesUsed > 0;
  return {
    ok: true,
    seeded: upserted,
    ingested,
    searchQueriesUsed,
    queryCap,
    skippedLiveSearch: !liveWorked,
    provider: liveWorked ? DISCOVERY_SEARCH_PROVIDER_NAME : "noop",
    message: liveWorked
      ? `Path 1 ${DISCOVERY_SEARCH_PROVIDER_NAME}: ${ingested} pool upserts (${searchQueriesUsed}/${queryCap} queries)`
      : `Live search enabled but ${DISCOVERY_SEARCH_PROVIDER_NAME} unused (missing key or noop) — seed only`,
  };
}
