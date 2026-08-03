/**
 * Postgres integration — Wave 2 Discovery Approach A last-known + seed jobs.
 * Skips when DATABASE_URL unset / unreachable (see postgresIntegrationEnabled).
 */
import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { runPath1IntakeJob } from "@/lib/discovery/jobs/intake";
import { runScoreRefreshJob } from "@/lib/discovery/jobs/score-refresh";
import {
  loadActivePoolAsCatalog,
  syncCatalogSeedToPool,
} from "@/lib/discovery/pool";
import {
  applySuccessfulScoreRefresh,
  getScoreForPoolProduct,
} from "@/lib/discovery/scores";
import { postgresIntegrationEnabled } from "@/lib/test/pg";
import {
  DISCOVERY_INTAKE_QUERIES_PER_RUN_MAX,
  DISCOVERY_SCORE_QUERIES_PER_PRODUCT_MAX,
} from "@/lib/constants";

const describePg = postgresIntegrationEnabled() ? describe : describe.skip;
const PG_TIMEOUT_MS = 45_000;

describePg("postgres integration — discovery Approach A", () => {
  afterEach(() => {
    delete process.env.DISCOVERY_POOL_V2;
    delete process.env.DISCOVERY_LIVE_SEARCH;
  });

  it(
    "intake seeds catalog and skips live search by default",
    async () => {
      const intake = await runPath1IntakeJob();
      expect(intake.ok).toBe(true);
      expect(intake.seeded).toBeGreaterThan(0);
      expect(intake.skippedLiveSearch).toBe(true);
      expect(intake.queryCap).toBe(DISCOVERY_INTAKE_QUERIES_PER_RUN_MAX);
    },
    PG_TIMEOUT_MS,
  );

  it(
    "score refresh no-ops when pool flag off",
    async () => {
      delete process.env.DISCOVERY_POOL_V2;
      const scores = await runScoreRefreshJob({ limit: 1 });
      expect(scores.productsConsidered).toBe(0);
      expect(scores.queryCapPerProduct).toBe(
        DISCOVERY_SCORE_QUERIES_PER_PRODUCT_MAX,
      );
      expect(scores.softCompetitionBudget).toBe(true);
    },
    PG_TIMEOUT_MS,
  );

  it(
    "failed score refresh keeps last-known numeric scores",
    async () => {
      process.env.DISCOVERY_POOL_V2 = "1";

      await syncCatalogSeedToPool();
      const products = await loadActivePoolAsCatalog();
      expect(products.length).toBeGreaterThan(0);

      const poolRow = await db
        .select()
        .from(schema.discoveryProductPool)
        .where(eq(schema.discoveryProductPool.catalogKey, products[0].key))
        .then((rows) => rows[0]);
      expect(poolRow).toBeTruthy();

      await applySuccessfulScoreRefresh(poolRow!.id, {
        abroadDemandScore: 0.8,
        lebanonDemandScore: 0.2,
        competitionScore: 0.3,
        compositeScore: 0.55,
        confidence: 0.7,
        demandPath: "whitespace",
      });

      const before = await getScoreForPoolProduct(poolRow!.id);
      expect(before?.abroadDemandScore).toBe(0.8);
      expect(before?.compositeScore).toBe(0.55);

      await runScoreRefreshJob({
        limit: 50,
        failKeys: new Map([[products[0].key, "simulated api failure"]]),
      });

      const after = await getScoreForPoolProduct(poolRow!.id);
      expect(after?.abroadDemandScore).toBe(0.8);
      expect(after?.lebanonDemandScore).toBe(0.2);
      expect(after?.competitionScore).toBe(0.3);
      expect(after?.compositeScore).toBe(0.55);
      expect(after?.lastScoreStatus).toBe("failed");
      expect(after?.lastError).toContain("simulated api failure");
    },
    PG_TIMEOUT_MS,
  );
});
