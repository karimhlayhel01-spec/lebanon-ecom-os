import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { WORKSPACE_CASCADE_TABLES } from "@/lib/account/cascade-order";
import {
  DISCOVERY_FALLBACK_SHORTLIST_MIN,
  DISCOVERY_INTAKE_QUERIES_PER_RUN_MAX,
  DISCOVERY_SCORE_QUERIES_PER_PRODUCT_MAX,
} from "@/lib/constants";

const root = path.join(process.cwd(), "src");

function read(rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

describe("Wave 2 Discovery isolation", () => {
  it("keeps global pool/score tables out of workspace cascade", () => {
    expect(WORKSPACE_CASCADE_TABLES).not.toContain("discovery_product_pool");
    expect(WORKSPACE_CASCADE_TABLES).not.toContain("discovery_product_scores");
  });

  it("documents query caps and fallback min", () => {
    expect(DISCOVERY_SCORE_QUERIES_PER_PRODUCT_MAX).toBeGreaterThan(0);
    expect(DISCOVERY_INTAKE_QUERIES_PER_RUN_MAX).toBeGreaterThan(
      DISCOVERY_SCORE_QUERIES_PER_PRODUCT_MAX,
    );
    expect(DISCOVERY_FALLBACK_SHORTLIST_MIN).toBe(5);
  });

  it("finance / journey / accept paths do not import discovery jobs", () => {
    const forbidden = [
      "lib/discovery/jobs/intake",
      "lib/discovery/jobs/score-refresh",
      "runPath1IntakeJob",
      "runScoreRefreshJob",
      "lib/discovery/providers/serpapi",
      "createSerpApiProvider",
    ];
    const surfaces = [
      "lib/finance/service.ts",
      "lib/journey/fsm.ts",
      "actions/finance.ts",
      "actions/journey.ts",
      "actions/discovery.ts",
      "lib/discovery/service.ts",
    ];
    for (const file of surfaces) {
      const src = read(file);
      for (const needle of forbidden) {
        expect(src, `${file} must not reference ${needle}`).not.toContain(
          needle,
        );
      }
    }
  });

  it("Discovery service does not import live search provider for page path", () => {
    const service = read("lib/discovery/service.ts");
    expect(service).not.toContain("search-provider");
    expect(service).not.toContain("getDiscoverySearchProvider");
    expect(service).not.toContain("DISCOVERY_LIVE_SEARCH");
    expect(service).not.toContain("serpapi");
    expect(service).not.toContain("SERPAPI");
    expect(service).not.toContain("scoresFromSearchEvidence");
    expect(service).not.toContain("buildScoreRefreshQueryPlan");
  });

  it("Why we suggested this explain does not import accept or score writers", () => {
    const explainDir = [
      "lib/discovery/explain/service.ts",
      "lib/discovery/explain/why-pick.ts",
      "lib/discovery/explain/llm.ts",
      "lib/discovery/explain/compare-service.ts",
      "lib/discovery/explain/compare.ts",
      "lib/discovery/explain/compare-llm.ts",
      "lib/discovery/compare/pick.ts",
    ];
    for (const file of explainDir) {
      const src = read(file);
      expect(src).not.toContain("acceptProduct");
      expect(src).not.toContain("applySuccessfulScoreRefresh");
      expect(src).not.toContain("runScoreRefreshJob");
    }
  });

  it("compare path is advice-only and does not write scores", () => {
    const compareService = read("lib/discovery/explain/compare-service.ts");
    expect(compareService).toContain("explainWorthConsideringCompare");
    expect(compareService).toContain("pickCompareWinner");
    expect(compareService).not.toContain(".insert(");
    expect(compareService).not.toContain(".update(");
    expect(compareService).not.toContain("acceptProduct");
    const actions = read("actions/discovery.ts");
    expect(actions).toContain("compareWorthConsideringAction");
    expect(actions).toContain("Do not revalidatePath — compare");
    const board = read("components/discovery/DiscoveryBoard.tsx");
    expect(board).toContain("worthConsidering");
    expect(board).toContain("compareWorthConsideringAction");
    expect(board).toContain("revalidateWorthConsideringMarks");
  });

  it("Discovery service does not call score refresh / intake jobs", () => {
    const service = read("lib/discovery/service.ts");
    expect(service).not.toContain("runScoreRefreshJob");
    expect(service).not.toContain("runPath1IntakeJob");
    expect(service).not.toContain("jobs/score-refresh");
    expect(service).not.toContain("jobs/intake");
  });

  it("Discovery view path does not full-scan the active product pool", () => {
    // getDiscoveryView must resolve Path 1 text via keyed batch only
    // (loadPoolProductsByCatalogKeys), not the full-pool loader (~800 rows).
    const service = read("lib/discovery/service.ts");
    expect(service).not.toContain("loadActivePoolAsCatalog");
    expect(service).toContain("loadPoolProductsByCatalogKeys");
    const viewFn = service.slice(service.indexOf("export async function getDiscoveryView"));
    expect(viewFn).toContain("loadPoolProductsByCatalogKeys");
    expect(viewFn).toContain("visibleCatalogKeys");
  });

  it("POOL_V2 refresh suggestions closes session and re-scores with seen keys", () => {
    const service = read("lib/discovery/service.ts");
    expect(service).toContain("export async function refreshDiscoverySuggestions");
    expect(service).toContain("canRefreshSuggestions");
    const actions = read("actions/discovery.ts");
    expect(actions).toContain("refreshSuggestionsAction");
    expect(actions).toContain("refreshDiscoverySuggestions");
    const board = read("components/discovery/DiscoveryBoard.tsx");
    expect(board).toContain("refreshSuggestionsAction");
    expect(board).toContain("canRefreshSuggestions");
  });

  it("score fail helper does not clear numeric fields in source", () => {
    const scores = read("lib/discovery/scores.ts");
    const failFn = scores.slice(
      scores.indexOf("export function buildFailedScoreRefreshPatch"),
      scores.indexOf("/** Ensure a score row exists"),
    );
    expect(failFn).toContain('lastScoreStatus: "failed"');
    expect(failFn).toContain("lastError");
    expect(failFn).not.toContain("abroadDemandScore");
    expect(failFn).not.toContain("compositeScore");
  });
});
