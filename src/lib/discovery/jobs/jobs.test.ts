import { describe, expect, it } from "vitest";
import {
  DISCOVERY_INTAKE_QUERIES_PER_RUN_MAX,
  DISCOVERY_SCORE_QUERIES_PER_PRODUCT_MAX,
} from "@/lib/constants";
import { runPath1IntakeJob } from "@/lib/discovery/jobs/intake";
import { runScoreRefreshJob } from "@/lib/discovery/jobs/score-refresh";

describe("discovery job entrypoints (unit)", () => {
  it("documents query caps and exports scheduled seams", () => {
    expect(DISCOVERY_SCORE_QUERIES_PER_PRODUCT_MAX).toBe(6);
    expect(DISCOVERY_INTAKE_QUERIES_PER_RUN_MAX).toBe(40);
    expect(typeof runPath1IntakeJob).toBe("function");
    expect(typeof runScoreRefreshJob).toBe("function");
  });

  it("score refresh module uses heuristic seed path (no UI live-search)", async () => {
    const { readFileSync } = await import("fs");
    const { join } = await import("path");
    const src = readFileSync(
      join(process.cwd(), "src/lib/discovery/jobs/score-refresh.ts"),
      "utf8",
    );
    expect(src).toContain("heuristicScoresFromPoolProduct");
    expect(src).toContain("scoresFromSearchEvidence");
    expect(src).toContain("buildScoreRefreshQueryPlan");
    expect(src).not.toContain("from \"@/lib/discovery/service\"");
  });

  it("Path 1 intake is wired to SerpAPI behind the search-provider seam", async () => {
    const { readFileSync } = await import("fs");
    const { join } = await import("path");
    const intake = readFileSync(
      join(process.cwd(), "src/lib/discovery/jobs/intake.ts"),
      "utf8",
    );
    const seam = readFileSync(
      join(process.cwd(), "src/lib/discovery/search-provider.ts"),
      "utf8",
    );
    expect(intake).toContain("DISCOVERY_SEARCH_PROVIDER_NAME");
    expect(seam).toContain("SerpAPI");
    expect(seam).toContain("createSerpApiProvider");
  });
});
