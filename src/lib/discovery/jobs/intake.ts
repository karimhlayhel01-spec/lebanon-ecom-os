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
import {
  allowanceForBatch,
  currentMonthKey,
  loadMonthlySearchUsage,
  recordMonthlySearchQueries,
  remainingMonthlyAllowance,
  resolveMonthlySearchQueryCap,
} from "@/lib/discovery/search-usage";

export type IntakeJobResult = {
  ok: boolean;
  seeded: number;
  ingested: number;
  searchQueriesUsed: number;
  /** Queries that threw (timeout / persistent provider failure). */
  searchQueriesFailed: number;
  queryCap: number;
  monthlyQueryCap: number;
  monthlyQueriesUsed: number;
  monthlyRemaining: number;
  /** True when the run stopped early on the monthly cap (not a failure). */
  quotaStopped: boolean;
  skippedLiveSearch: boolean;
  provider: typeof DISCOVERY_SEARCH_PROVIDER_NAME | "noop";
  message: string;
};

export type Path1IntakeJobOptions = {
  /** Inject mock provider in unit tests (no network). */
  provider?: DiscoverySearchProvider;
  /** Override query cap (tests). */
  queryCap?: number;
  /** Override the monthly allowance (tests / ops dry-runs). */
  monthlyQueryCap?: number;
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
  const monthlyQueryCap = opts?.monthlyQueryCap ?? resolveMonthlySearchQueryCap();
  const monthKey = currentMonthKey();
  const { upserted } = await syncCatalogSeedToPool();

  const seedOnly = (message: string): IntakeJobResult => ({
    ok: true,
    seeded: upserted,
    ingested: 0,
    searchQueriesUsed: 0,
    searchQueriesFailed: 0,
    queryCap,
    monthlyQueryCap,
    monthlyQueriesUsed: 0,
    monthlyRemaining: monthlyQueryCap,
    quotaStopped: false,
    skippedLiveSearch: true,
    provider: "noop",
    message,
  });

  if (!isDiscoveryPoolV2Enabled()) {
    return seedOnly("Pool flag off — catalog seed synced only");
  }

  if (!isDiscoveryLiveSearchEnabled()) {
    return seedOnly("Live search off — catalog seed synced; no Path 1 search");
  }

  const provider = opts?.provider ?? getDiscoverySearchProvider();
  const planned = buildPath1IntakeQueries(queryCap);
  const monthStart = await loadMonthlySearchUsage(monthKey);
  let monthlySpent = monthStart.queriesUsed;
  let searchQueriesUsed = 0;
  let searchQueriesFailed = 0;
  let quotaStopped = false;
  let firstError: string | null = null;
  const normalized: ReturnType<typeof normalizeSearchItemToPoolCandidate>[] = [];

  for (const plan of planned) {
    const remaining = queryCap - searchQueriesUsed;
    if (remaining <= 0) break;

    // Checked BEFORE the query: stop cleanly rather than burning paid quota.
    if (
      allowanceForBatch({ cap: monthlyQueryCap, used: monthlySpent, requested: 1 }) <= 0
    ) {
      quotaStopped = true;
      break;
    }

    let res;
    try {
      res = await provider.search({ kind: "path1_intake", query: plan.query });
    } catch (err) {
      // One vendor hiccup must not discard the candidates already normalized.
      searchQueriesFailed += 1;
      firstError ??= err instanceof Error ? err.message : String(err);
      continue;
    }

    const used = Math.min(Math.max(0, res.queriesUsed), remaining);
    searchQueriesUsed += used;
    monthlySpent += used;
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

  if (searchQueriesUsed > 0) {
    await recordMonthlySearchQueries({ monthKey, queries: searchQueriesUsed });
  }
  const monthlyQueriesUsed = monthStart.queriesUsed + searchQueriesUsed;

  const liveWorked = searchQueriesUsed > 0;
  // Every attempted query failing is a real outage worth alerting on; a partial
  // failure that still persisted candidates is not.
  const totalFailure = searchQueriesFailed > 0 && searchQueriesUsed === 0;

  let message: string;
  if (quotaStopped && !liveWorked) {
    message = `Monthly search cap ${monthlyQueryCap} reached — catalog seed synced; no Path 1 search`;
  } else if (liveWorked) {
    const partial =
      searchQueriesFailed > 0
        ? ` — ${searchQueriesFailed} query(s) failed: ${firstError}`
        : "";
    const capped = quotaStopped
      ? ` — stopped at monthly search cap ${monthlyQueryCap}`
      : "";
    message = `Path 1 ${DISCOVERY_SEARCH_PROVIDER_NAME}: ${ingested} pool upserts (${searchQueriesUsed}/${queryCap} queries)${partial}${capped}`;
  } else if (totalFailure) {
    message = `Path 1 ${DISCOVERY_SEARCH_PROVIDER_NAME} failed on all ${searchQueriesFailed} query(s): ${firstError} — seed only, pool unchanged`;
  } else {
    message = `Live search enabled but ${DISCOVERY_SEARCH_PROVIDER_NAME} unused (missing key or noop) — seed only`;
  }

  return {
    ok: !totalFailure,
    seeded: upserted,
    ingested,
    searchQueriesUsed,
    searchQueriesFailed,
    queryCap,
    monthlyQueryCap,
    monthlyQueriesUsed,
    monthlyRemaining: remainingMonthlyAllowance(
      monthlyQueryCap,
      monthlyQueriesUsed,
    ),
    quotaStopped,
    skippedLiveSearch: !liveWorked,
    provider: liveWorked ? DISCOVERY_SEARCH_PROVIDER_NAME : "noop",
    message,
  };
}
