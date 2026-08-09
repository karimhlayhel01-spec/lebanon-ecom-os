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

  it("live search stays behind the seam — no page-load or server-action path", () => {
    const forbidden = [
      "createSerpApiProvider",
      "createBraveSearchProvider",
      "createSerperSearchProvider",
      "getDiscoverySearchProvider",
      "search-usage",
      "BRAVE_SEARCH_API_KEY",
      "SERPER_API_KEY",
      "DISCOVERY_SEARCH_VENDOR",
    ];
    const surfaces = [
      "lib/discovery/service.ts",
      "actions/discovery.ts",
      "lib/discovery/explain/service.ts",
      "lib/discovery/explain/compare-service.ts",
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

  it("providers are constructed only by the search-provider seam", () => {
    // getDiscoverySearchProvider() is the single production bind point: jobs
    // receive a provider, they never build one.
    for (const file of [
      "lib/discovery/jobs/intake.ts",
      "lib/discovery/jobs/score-refresh.ts",
    ]) {
      const src = read(file);
      expect(src).toContain("getDiscoverySearchProvider");
      expect(src).not.toContain("createSerpApiProvider");
      expect(src).not.toContain("createBraveSearchProvider");
      expect(src).not.toContain("createSerperSearchProvider");
    }
    const seam = read("lib/discovery/search-provider.ts");
    expect(seam).toContain("createSerpApiProvider");
    expect(seam).toContain("createBraveSearchProvider");
    expect(seam).toContain("createSerperSearchProvider");
  });

  it("every outbound search goes through the bounded-attempt wrapper", () => {
    for (const file of [
      "lib/discovery/providers/serpapi.ts",
      "lib/discovery/providers/brave.ts",
      "lib/discovery/providers/serper.ts",
    ]) {
      const src = read(file);
      expect(src).toContain("runBoundedSearchAttempts");
      // Without the abort signal on the request, the timeout is decorative.
      expect(src).toMatch(/fetchFn\(url, \{[\s\S]*?signal,[\s\S]*?\}\)/);
    }
  });

  it("keeps the metrics table workspace-scoped, unlike the global pool", () => {
    // Funnel counters carry a workspace id, so they must be wiped with the
    // workspace — no founder identifier outlives the account.
    expect(WORKSPACE_CASCADE_TABLES).toContain("discovery_metric_events");
  });

  it("undo restores through the same gate the shortlist filters with", () => {
    const service = read("lib/discovery/service.ts");
    expect(service).toContain("export async function undoRejectCandidate");
    expect(service).toContain("function resolveCandidateGate");
    // One resolver for the page and for undo — they cannot drift apart.
    const viewFn = service.slice(
      service.indexOf("export async function getDiscoveryView"),
    );
    expect(viewFn).toContain("resolveCandidateGate");
    const actions = read("actions/discovery.ts");
    expect(actions).toContain("undoRejectAction");
    const board = read("components/discovery/DiscoveryBoard.tsx");
    expect(board).toContain("undoRejectAction");
    expect(board).toContain("undoableRejects");
  });

  it("score freshness reaches the card as display-only view data", () => {
    const service = read("lib/discovery/service.ts");
    expect(service).toContain("resolveScoreFreshness");
    expect(service).toContain("scoreFreshness");
    const board = read("components/discovery/DiscoveryBoard.tsx");
    expect(board).toContain("scoreFreshnessNote");
    // Freshness must not be wired into accept or shortlist filtering.
    expect(service).not.toContain("scoreFreshness.state ===");
    expect(service).not.toMatch(/acceptReady[^\n]*freshness/i);
  });

  it("Compare tray spacer clears Coaching nested under DiscoveryBoard", () => {
    const board = read("components/discovery/DiscoveryBoard.tsx");
    expect(board).toContain("data-discovery-compare-tray-spacer");
    expect(board).toContain("data-discovery-compare-tray");
    expect(board).toContain("ResizeObserver");
    expect(board).toContain("children?: ReactNode");
    expect(board).not.toMatch(/className="space-y-5 pb-24"/);
    // Fixed tray must portal to body — not sit under `.animate-rise` transform.
    const trayFn = board.slice(
      board.indexOf("function WorthConsideringCompareBox"),
      board.indexOf("function UndoRejectNote"),
    );
    expect(trayFn).toContain("createPortal");
    expect(trayFn).toContain("document.body");
    const page = read("app/[locale]/dashboard/page.tsx");
    expect(page).toContain("<DiscoveryBoard view={discovery}>");
    expect(page).toContain("OrchestratorPanel view={orchestration} coachingOnly");
  });
});
