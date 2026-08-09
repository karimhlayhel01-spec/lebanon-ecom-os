/**
 * Wave 2 Approach A score-refresh job (scheduled, daily-ish intent).
 * LIVE_SEARCH on → capped provider probes per pool row → persist scores.
 * LIVE_SEARCH off → heuristic/seed scores. Failure → last-known kept.
 * Heuristics are only for an intentionally OFF live search: when live is on but
 * no query ran, that is a failure, never a seed score written over live data.
 * Monthly search spend is metered by the §7 ledger — the run stops cleanly at
 * the cap. Discovery shortlist must read DB — never call this on page load.
 */

import { eq } from "drizzle-orm";
import { db, ensureMigrated, schema } from "@/db";
import { DISCOVERY_SCORE_QUERIES_PER_PRODUCT_MAX } from "@/lib/constants";
import {
  isDiscoveryLiveSearchEnabled,
  isDiscoveryPoolV2Enabled,
  isSoftCompetitionBudgetEnabled,
} from "@/lib/discovery/flags";
import { syncCatalogSeedToPool } from "@/lib/discovery/pool";
import {
  getDiscoverySearchProvider,
  type DiscoverySearchProvider,
  type SearchResultItem,
} from "@/lib/discovery/search-provider";
import {
  applyFailedScoreRefresh,
  applySuccessfulScoreRefresh,
  ensureScoreRow,
  type ScoreSnapshot,
} from "@/lib/discovery/scores";
import {
  buildScoreRefreshQueryPlan,
  scoresFromSearchEvidence,
  summarizeGatheredEvidence,
} from "@/lib/discovery/scoring/evidence";
import { heuristicScoresFromPoolProduct } from "@/lib/discovery/scoring/heuristics";
import {
  allowanceForBatch,
  currentMonthKey,
  loadMonthlySearchUsage,
  recordMonthlySearchQueries,
  remainingMonthlyAllowance,
  resolveMonthlySearchQueryCap,
} from "@/lib/discovery/search-usage";

export type ScoreRefreshJobResult = {
  ok: boolean;
  productsConsidered: number;
  refreshedOk: number;
  refreshedFailed: number;
  /** Products whose live gather returned zero hits (empty-rate numerator). */
  emptyEvidenceCount: number;
  /** Empty gathers that kept an existing good snapshot instead of writing. */
  preservedOnEmptyEvidence: number;
  /** Products left untouched because the monthly allowance ran out. */
  skippedForQuota: number;
  /** True when the run stopped early on the monthly cap (not a failure). */
  quotaStopped: boolean;
  queriesUsed: number;
  queryCapPerProduct: number;
  monthlyQueryCap: number;
  monthlyQueriesUsed: number;
  monthlyRemaining: number;
  softCompetitionBudget: boolean;
  liveSearch: boolean;
  message: string;
};

export type ScoreRefreshJobOptions = {
  /** Limit products in one run (ops). */
  limit?: number;
  /** Inject failure for tests — catalogKey → error message. */
  failKeys?: ReadonlyMap<string, string>;
  /** Inject mock provider (unit tests — no network). */
  provider?: DiscoverySearchProvider;
  /** Override per-product query cap (tests). */
  queryCapPerProduct?: number;
  /** Override the monthly allowance (tests / ops dry-runs). */
  monthlyQueryCap?: number;
};

type GatherResult =
  | {
      ok: true;
      snapshot: ScoreSnapshot;
      queriesUsed: number;
      emptyEvidence: boolean;
    }
  /**
   * Either the provider never ran a query (missing key / noop bind) or it
   * failed partway. Heuristics must NOT stand in — that would overwrite real
   * live scores with a seed guess and still report "ok".
   * `queriesUsed` still bills the month for whatever was spent before the fault.
   */
  | { ok: false; reason: string; queriesUsed: number };

async function gatherLiveEvidence(input: {
  product: {
    catalogKey: string;
    nameEn: string;
    category: string;
    difficulty: number;
    risk: number;
    tier1Marketplaces: string;
  };
  provider: DiscoverySearchProvider;
  queryCap: number;
}): Promise<GatherResult> {
  const plan = buildScoreRefreshQueryPlan(input.product, input.queryCap);
  const abroadItems: SearchResultItem[] = [];
  const lebanonItems: SearchResultItem[] = [];
  const tier1Items: SearchResultItem[] = [];
  const localItems: SearchResultItem[] = [];
  let queriesUsed = 0;

  for (const q of plan) {
    if (queriesUsed >= input.queryCap) break;
    const remaining = input.queryCap - queriesUsed;
    let res;
    try {
      res = await input.provider.search(q);
    } catch (err) {
      // Bill what was already spent before the fault, then fail the product.
      return {
        ok: false,
        reason: err instanceof Error ? err.message : String(err),
        queriesUsed,
      };
    }
    const used = Math.min(Math.max(0, res.queriesUsed), remaining);
    queriesUsed += used;

    if (used === 0 && res.queriesUsed === 0) {
      // Noop / missing key — stop probing this product.
      break;
    }

    switch (q.kind) {
      case "abroad_demand":
        abroadItems.push(...res.items);
        break;
      case "lebanon_demand":
        lebanonItems.push(...res.items);
        break;
      case "tier1_competition":
        tier1Items.push(...res.items);
        break;
      case "local_competition":
        localItems.push(...res.items);
        break;
      default:
        break;
    }
  }

  const bags = summarizeGatheredEvidence({
    abroadItems,
    lebanonItems,
    tier1Items,
    localItems,
    queriesUsed,
    emptyEvidence: false,
  });

  // Live was requested but nothing was actually queried. Report failure so the
  // caller preserves last-known scores (WAVE-2 §7 last-known rule).
  if (bags.queriesUsed === 0) {
    return {
      ok: false,
      reason:
        "Live search is enabled but no search query ran — check the provider API key (SERPAPI_API_KEY / SEARCH_API_KEY, or BRAVE_SEARCH_API_KEY when DISCOVERY_SEARCH_VENDOR=brave)",
      queriesUsed: 0,
    };
  }

  const softCompetitionBudget = isSoftCompetitionBudgetEnabled();
  const snapshot = scoresFromSearchEvidence({
    productName: input.product.nameEn,
    abroadItems: bags.abroadItems,
    lebanonItems: bags.lebanonItems,
    tier1Items: bags.tier1Items,
    localItems: bags.localItems,
    poolTier1Json: input.product.tier1Marketplaces,
    softCompetitionBudget,
    queriesUsed: bags.queriesUsed,
  });

  return {
    ok: true,
    snapshot,
    queriesUsed: bags.queriesUsed,
    emptyEvidence: bags.emptyEvidence,
  };
}

/**
 * Refresh scores for active pool products.
 * On per-product failure: last-known scores stay; status → failed.
 */
export async function runScoreRefreshJob(
  opts?: ScoreRefreshJobOptions,
): Promise<ScoreRefreshJobResult> {
  await ensureMigrated();
  const queryCapPerProduct =
    opts?.queryCapPerProduct ?? DISCOVERY_SCORE_QUERIES_PER_PRODUCT_MAX;
  const softCompetitionBudget = isSoftCompetitionBudgetEnabled();
  const live = isDiscoveryLiveSearchEnabled();

  const monthlyQueryCap = opts?.monthlyQueryCap ?? resolveMonthlySearchQueryCap();
  const monthKey = currentMonthKey();

  if (!isDiscoveryPoolV2Enabled()) {
    return {
      ok: true,
      productsConsidered: 0,
      refreshedOk: 0,
      refreshedFailed: 0,
      emptyEvidenceCount: 0,
      preservedOnEmptyEvidence: 0,
      skippedForQuota: 0,
      quotaStopped: false,
      queriesUsed: 0,
      queryCapPerProduct,
      monthlyQueryCap,
      monthlyQueriesUsed: 0,
      monthlyRemaining: monthlyQueryCap,
      softCompetitionBudget,
      liveSearch: live,
      message: "Pool flag off — score refresh no-op",
    };
  }

  await syncCatalogSeedToPool();

  const rows = await db
    .select()
    .from(schema.discoveryProductPool)
    .where(eq(schema.discoveryProductPool.active, true));

  const limited =
    opts?.limit !== undefined ? rows.slice(0, Math.max(0, opts.limit)) : rows;

  let refreshedOk = 0;
  let refreshedFailed = 0;
  let emptyEvidenceCount = 0;
  let preservedOnEmptyEvidence = 0;
  let skippedForQuota = 0;
  let quotaStopped = false;
  let queriesUsed = 0;
  const provider = opts?.provider ?? getDiscoverySearchProvider();

  // Only live runs spend quota; a heuristic run costs nothing.
  const monthStart = live
    ? await loadMonthlySearchUsage(monthKey)
    : { monthKey, queriesUsed: 0 };
  let monthlySpent = monthStart.queriesUsed;

  for (const product of limited) {
    const scoreRow = await ensureScoreRow(product.id);

    const forcedFail = opts?.failKeys?.get(product.catalogKey);
    if (forcedFail) {
      await applyFailedScoreRefresh(product.id, forcedFail);
      refreshedFailed += 1;
      continue;
    }

    // Checked BEFORE the batch: stop cleanly rather than burning paid quota.
    // Doubles as this product's budget when the month is nearly spent.
    const batchAllowance = live
      ? allowanceForBatch({
          cap: monthlyQueryCap,
          used: monthlySpent,
          requested: queryCapPerProduct,
        })
      : 0;
    if (live && batchAllowance <= 0) {
      quotaStopped = true;
      skippedForQuota += 1;
      continue;
    }

    try {
      let snapshot: ScoreSnapshot;
      let productQueries = 0;
      let emptyEvidence = false;

      if (live) {
        const gathered = await gatherLiveEvidence({
          product,
          provider,
          queryCap: batchAllowance,
        });
        if (!gathered.ok) {
          monthlySpent += gathered.queriesUsed;
          queriesUsed += gathered.queriesUsed;
          await applyFailedScoreRefresh(product.id, gathered.reason);
          refreshedFailed += 1;
          continue;
        }
        snapshot = gathered.snapshot;
        productQueries = gathered.queriesUsed;
        emptyEvidence = gathered.emptyEvidence;
        monthlySpent += productQueries;
      } else {
        snapshot = heuristicScoresFromPoolProduct(product);
      }

      // A zero-hit gather is real but low-confidence: never let it overwrite a
      // snapshot that previously scored ok (WAVE-2 §7 last-known).
      if (emptyEvidence && scoreRow.lastScoreStatus === "ok") {
        emptyEvidenceCount += 1;
        preservedOnEmptyEvidence += 1;
        queriesUsed += productQueries;
        continue;
      }

      let evidence: Record<string, unknown> = {
        queriesUsed: productQueries,
        softCompetitionBudget,
        liveSearch: live,
      };
      if (snapshot.rawEvidenceJson) {
        try {
          evidence = {
            ...(JSON.parse(snapshot.rawEvidenceJson) as Record<string, unknown>),
            ...evidence,
          };
        } catch {
          /* keep base evidence */
        }
      }
      snapshot.rawEvidenceJson = JSON.stringify(evidence);

      await applySuccessfulScoreRefresh(product.id, snapshot);
      refreshedOk += 1;
      queriesUsed += productQueries;
      if (emptyEvidence) emptyEvidenceCount += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await applyFailedScoreRefresh(product.id, msg);
      refreshedFailed += 1;
    }
  }

  if (live && queriesUsed > 0) {
    await recordMonthlySearchQueries({ monthKey, queries: queriesUsed });
  }
  const monthlyQueriesUsed = monthStart.queriesUsed + (live ? queriesUsed : 0);

  const quotaNote = quotaStopped
    ? ` — monthly search cap ${monthlyQueryCap} reached, ${skippedForQuota} product(s) left on last-known scores`
    : "";
  return {
    // A quota stop is a clean stop, not a failure: cron must not alert on it.
    ok: refreshedFailed === 0,
    productsConsidered: limited.length,
    refreshedOk,
    refreshedFailed,
    emptyEvidenceCount,
    preservedOnEmptyEvidence,
    skippedForQuota,
    quotaStopped,
    queriesUsed,
    queryCapPerProduct,
    monthlyQueryCap,
    monthlyQueriesUsed,
    monthlyRemaining: remainingMonthlyAllowance(
      monthlyQueryCap,
      monthlyQueriesUsed,
    ),
    softCompetitionBudget,
    liveSearch: live,
    message: `Score refresh: ${refreshedOk} ok, ${refreshedFailed} failed, ${emptyEvidenceCount} empty-evidence (${preservedOnEmptyEvidence} kept last-known)${quotaNote}`,
  };
}
