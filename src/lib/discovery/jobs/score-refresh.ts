/**
 * Wave 2 Approach A score-refresh job (scheduled, daily-ish intent).
 * Reads pool rows, optionally probes search (capped), writes score cache.
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
import { getDiscoverySearchProvider } from "@/lib/discovery/search-provider";
import {
  applyFailedScoreRefresh,
  applySuccessfulScoreRefresh,
  ensureScoreRow,
} from "@/lib/discovery/scores";

export type ScoreRefreshJobResult = {
  ok: boolean;
  productsConsidered: number;
  refreshedOk: number;
  refreshedFailed: number;
  queriesUsed: number;
  queryCapPerProduct: number;
  softCompetitionBudget: boolean;
  message: string;
};

/**
 * Refresh scores for active pool products.
 * On per-product failure: last-known scores stay; status → failed.
 */
export async function runScoreRefreshJob(opts?: {
  /** Limit products in one run (ops). */
  limit?: number;
  /** Inject failure for tests — catalogKey → error message. */
  failKeys?: ReadonlyMap<string, string>;
}): Promise<ScoreRefreshJobResult> {
  await ensureMigrated();
  const queryCapPerProduct = DISCOVERY_SCORE_QUERIES_PER_PRODUCT_MAX;
  const softCompetitionBudget = isSoftCompetitionBudgetEnabled();

  if (!isDiscoveryPoolV2Enabled()) {
    return {
      ok: true,
      productsConsidered: 0,
      refreshedOk: 0,
      refreshedFailed: 0,
      queriesUsed: 0,
      queryCapPerProduct,
      softCompetitionBudget,
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
  let queriesUsed = 0;
  const live = isDiscoveryLiveSearchEnabled();
  const provider = getDiscoverySearchProvider();

  for (const product of limited) {
    await ensureScoreRow(product.id);

    const forcedFail = opts?.failKeys?.get(product.catalogKey);
    if (forcedFail) {
      await applyFailedScoreRefresh(product.id, forcedFail);
      refreshedFailed += 1;
      continue;
    }

    try {
      let productQueries = 0;
      if (live) {
        // Cap abroad + Lebanon + Tier-1 family probes (noop provider uses 0).
        const kinds = [
          "abroad_demand",
          "lebanon_demand",
          "tier1_competition",
        ] as const;
        for (const kind of kinds) {
          if (productQueries >= queryCapPerProduct) break;
          const res = await provider.search({
            kind,
            query: `${product.nameEn} ${kind}`,
          });
          const add = Math.min(
            res.queriesUsed,
            queryCapPerProduct - productQueries,
          );
          productQueries += add;
          queriesUsed += add;
        }
      }

      // Foundation: seed a neutral deterministic placeholder until live skills.
      // Soft competition×budget: record shadow would-exclude=false by default.
      await applySuccessfulScoreRefresh(product.id, {
        abroadDemandScore: null,
        lebanonDemandScore: null,
        competitionScore: null,
        budgetFightPenalty: softCompetitionBudget ? 0 : null,
        compositeScore: null,
        demandPath: null,
        confidence: 0,
        explainLine: null,
        shadowWouldExclude: false,
        shadowExcludeReason: null,
        rawEvidenceJson: JSON.stringify({
          foundation: true,
          queriesUsed: productQueries,
          softCompetitionBudget,
        }),
      });
      refreshedOk += 1;
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
    queriesUsed,
    queryCapPerProduct,
    softCompetitionBudget,
    message: `Score refresh: ${refreshedOk} ok, ${refreshedFailed} failed (last-known preserved on fail)`,
  };
}
