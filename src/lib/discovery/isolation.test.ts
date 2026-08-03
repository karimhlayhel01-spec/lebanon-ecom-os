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
