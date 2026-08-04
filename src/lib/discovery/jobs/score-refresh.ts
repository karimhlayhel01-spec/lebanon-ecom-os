/**
 * Wave 2 Approach A score-refresh job (scheduled, daily-ish intent).
 * LIVE_SEARCH on → capped SerpAPI probes per pool row → persist scores.
 * LIVE_SEARCH off → heuristic/seed scores. Failure → last-known kept.
 * Discovery shortlist must read DB — never call this on page load.
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

export type ScoreRefreshJobResult = {
  ok: boolean;
  productsConsidered: number;
  refreshedOk: number;
  refreshedFailed: number;
  /** Products whose live gather returned zero hits (empty-rate numerator). */
  emptyEvidenceCount: number;
  queriesUsed: number;
  queryCapPerProduct: number;
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
};

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
}): Promise<{
  snapshot: ScoreSnapshot;
  queriesUsed: number;
  emptyEvidence: boolean;
}> {
  const plan = buildScoreRefreshQueryPlan(input.product, input.queryCap);
  const abroadItems: SearchResultItem[] = [];
  const lebanonItems: SearchResultItem[] = [];
  const tier1Items: SearchResultItem[] = [];
  const localItems: SearchResultItem[] = [];
  let queriesUsed = 0;

  for (const q of plan) {
    if (queriesUsed >= input.queryCap) break;
    const remaining = input.queryCap - queriesUsed;
    const res = await input.provider.search(q);
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

  // No live query progress → caller should fall back to heuristics.
  if (bags.queriesUsed === 0) {
    return {
      snapshot: heuristicScoresFromPoolProduct(input.product),
      queriesUsed: 0,
      emptyEvidence: false,
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

  if (!isDiscoveryPoolV2Enabled()) {
    return {
      ok: true,
      productsConsidered: 0,
      refreshedOk: 0,
      refreshedFailed: 0,
      emptyEvidenceCount: 0,
      queriesUsed: 0,
      queryCapPerProduct,
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
  let queriesUsed = 0;
  const provider = opts?.provider ?? getDiscoverySearchProvider();

  for (const product of limited) {
    await ensureScoreRow(product.id);

    const forcedFail = opts?.failKeys?.get(product.catalogKey);
    if (forcedFail) {
      await applyFailedScoreRefresh(product.id, forcedFail);
      refreshedFailed += 1;
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
          queryCap: queryCapPerProduct,
        });
        snapshot = gathered.snapshot;
        productQueries = gathered.queriesUsed;
        emptyEvidence = gathered.emptyEvidence;
      } else {
        snapshot = heuristicScoresFromPoolProduct(product);
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

  return {
    ok: refreshedFailed === 0,
    productsConsidered: limited.length,
    refreshedOk,
    refreshedFailed,
    emptyEvidenceCount,
    queriesUsed,
    queryCapPerProduct,
    softCompetitionBudget,
    liveSearch: live,
    message: `Score refresh: ${refreshedOk} ok, ${refreshedFailed} failed, ${emptyEvidenceCount} empty-evidence (last-known preserved on fail)`,
  };
}
