/**
 * Wave 2 Path 1 intake job entrypoint (scheduled, weekly-ish intent).
 * Foundation stub: seeds catalog into pool; live search is gated and no-op.
 *
 * Isolation: only ops/cron may call this — never Discovery page handlers,
 * accept, journey, or Finance.
 */

import {
  DISCOVERY_INTAKE_QUERIES_PER_RUN_MAX,
} from "@/lib/constants";
import {
  isDiscoveryLiveSearchEnabled,
  isDiscoveryPoolV2Enabled,
} from "@/lib/discovery/flags";
import { syncCatalogSeedToPool } from "@/lib/discovery/pool";
import { getDiscoverySearchProvider } from "@/lib/discovery/search-provider";

export type IntakeJobResult = {
  ok: boolean;
  seeded: number;
  searchQueriesUsed: number;
  queryCap: number;
  skippedLiveSearch: boolean;
  message: string;
};

/**
 * Run Path 1 intake foundation step.
 * Always syncs catalog seed. Live search is skipped unless flag + provider.
 */
export async function runPath1IntakeJob(): Promise<IntakeJobResult> {
  const queryCap = DISCOVERY_INTAKE_QUERIES_PER_RUN_MAX;
  const { upserted } = await syncCatalogSeedToPool();

  if (!isDiscoveryPoolV2Enabled()) {
    return {
      ok: true,
      seeded: upserted,
      searchQueriesUsed: 0,
      queryCap,
      skippedLiveSearch: true,
      message: "Pool flag off — catalog seed synced only",
    };
  }

  if (!isDiscoveryLiveSearchEnabled()) {
    return {
      ok: true,
      seeded: upserted,
      searchQueriesUsed: 0,
      queryCap,
      skippedLiveSearch: true,
      message: "Live search off — catalog seed synced; no Path 1 search",
    };
  }

  // Live provider wired in a later Build. Cap is enforced when real queries run.
  const provider = getDiscoverySearchProvider();
  const probe = await provider.search({
    kind: "path1_intake",
    query: "lebanon winning product candidates",
  });
  const searchQueriesUsed = Math.min(probe.queriesUsed, queryCap);

  return {
    ok: true,
    seeded: upserted,
    searchQueriesUsed,
    queryCap,
    skippedLiveSearch: searchQueriesUsed === 0,
    message:
      searchQueriesUsed === 0
        ? "Live search enabled but provider returned no queries (noop stub)"
        : `Intake used ${searchQueriesUsed}/${queryCap} queries`,
  };
}
