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
});
