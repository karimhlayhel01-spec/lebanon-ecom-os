/**
 * WAVE-2 §14 PR3 — Explore more (same session) + why chips + narrowing + empty.
 */

import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { DISCOVERY_INITIAL_COUNT } from "@/lib/constants";
import { containsSellAsIsWording } from "@/lib/discovery/agent/differ-blocklist";
import {
  AGENT_HELD_RANK_BASE,
  agentWindowRange,
  excludeShownFromRanked,
  gridKeysInRetrieveSet,
  isInAgentGridWindow,
  isInAgentVisibleGrid,
  keepLookingRequiresNarrowing,
  parseShownCatalogKeys,
  sessionHasAgentTail,
  takeExploreBatch,
  unionCatalogKeys,
  wasCandidatePresented,
} from "@/lib/discovery/agent/explore";
import {
  applyDifferAnswer,
  applySkipRefuseAnswer,
  applyWhyExploreAnswer,
  beginNarrowing,
  EMPTY_AGENT_FRAME,
  isNarrowingFieldsWritten,
} from "@/lib/discovery/agent/frame";
import { pickCompareWinner } from "@/lib/discovery/compare/pick";

const srcRoot = path.join(process.cwd(), "src");

function read(rel: string): string {
  return readFileSync(path.join(srcRoot, rel), "utf8");
}

function messages(locale: "en" | "ar"): Record<string, string> {
  return JSON.parse(
    readFileSync(
      path.join(process.cwd(), `messages/${locale}.json`),
      "utf8",
    ),
  ).Discovery as Record<string, string>;
}

const PR3_I18N_KEYS = [
  "agentExploreMore",
  "agentWhyExploreTitle",
  "agentWhyExploreHint",
  "agentWhyExplore_not_convinced",
  "agentWhyExplore_keep_looking",
  "agentWhyExploreNoteLabel",
  "agentWhyExploreNotePlaceholder",
  "agentWhyExploreContinue",
  "agentNothingFitsTitle",
  "agentNothingFitsBody",
] as const;

describe("§14 PR3 i18n", () => {
  it("has EN+AR keys; AR is Arabic; no sell-as-is", () => {
    const en = messages("en");
    const ar = messages("ar");
    for (const key of PR3_I18N_KEYS) {
      expect(en[key]?.length ?? 0, `en.${key}`).toBeGreaterThan(2);
      expect(ar[key]?.length ?? 0, `ar.${key}`).toBeGreaterThan(2);
      expect(ar[key]).not.toBe(en[key]);
      expect(ar[key]).toMatch(/[\u0600-\u06FF]/);
      expect(containsSellAsIsWording(en[key]!)).toBe(false);
      expect(containsSellAsIsWording(ar[key]!)).toBe(false);
    }
  });
});

describe("§14 PR3 explore helpers", () => {
  it("excludes shown keys and only renders ids in the retrieve set", () => {
    const ranked = [{ key: "a" }, { key: "b" }, { key: "c" }, { key: "d" }];
    const shown = new Set(["a", "c"]);
    const next = takeExploreBatch(excludeShownFromRanked(ranked, shown), 2);
    expect(next.map((p) => p.key)).toEqual(["b", "d"]);
    expect(gridKeysInRetrieveSet(["b", "d"], new Set(["b", "d"]))).toBe(true);
    expect(gridKeysInRetrieveSet(["a"], new Set(["b", "d"]))).toBe(false);
    expect(takeExploreBatch(next, DISCOVERY_INITIAL_COUNT)).toHaveLength(2);
  });

  it("unions shown keys; 6th keep_looking requires narrowing", () => {
    expect(unionCatalogKeys(["a"], ["a", "b"])).toEqual(["a", "b"]);
    expect(keepLookingRequiresNarrowing(4)).toBe(false);
    expect(keepLookingRequiresNarrowing(5)).toBe(true);
    expect(parseShownCatalogKeys(null)).toEqual([]);
    expect(parseShownCatalogKeys('["x"]')).toEqual(["x"]);
  });

  it("pages 5 of 11: keep_looking appends; unrevealed ranks are not presented", () => {
    expect(agentWindowRange(0)).toEqual({ start: 0, end: 5 });
    expect(agentWindowRange(1)).toEqual({ start: 5, end: 10 });
    expect(isInAgentVisibleGrid(0, 0)).toBe(true);
    expect(isInAgentVisibleGrid(4, 0)).toBe(true);
    expect(isInAgentVisibleGrid(5, 0)).toBe(false);
    expect(isInAgentVisibleGrid(0, 1)).toBe(true);
    expect(isInAgentVisibleGrid(5, 1)).toBe(true);
    expect(isInAgentVisibleGrid(9, 1)).toBe(true);
    expect(isInAgentVisibleGrid(10, 1)).toBe(false);
    expect(isInAgentVisibleGrid(AGENT_HELD_RANK_BASE, 0)).toBe(false);
    expect(isInAgentGridWindow(5, 0)).toBe(false);
    expect(isInAgentGridWindow(5, 1)).toBe(true);
    expect(sessionHasAgentTail(11, 0)).toBe(true);
    expect(sessionHasAgentTail(5, 0)).toBe(false);
    expect(sessionHasAgentTail(11, 1)).toBe(true);
    expect(sessionHasAgentTail(11, 2)).toBe(false);
    expect(wasCandidatePresented("shown", 4, 5)).toBe(true);
    expect(wasCandidatePresented("shown", 5, 5)).toBe(false);
    expect(wasCandidatePresented("shown", 10, 5)).toBe(false);
    expect(wasCandidatePresented("rejected", 10, 5)).toBe(true);
  });

  it("not_convinced starts narrowing; skipped fields are not written", () => {
    const why = applyWhyExploreAnswer(EMPTY_AGENT_FRAME, "not_convinced", "note");
    const narrowed = beginNarrowing(why);
    expect(narrowed.narrowing).toBe(true);
    expect(narrowed.askStep).toBe(0);
    expect(narrowed.whyExplore).toBe("not_convinced");
    expect(isNarrowingFieldsWritten(narrowed)).toBe(false);
    expect(applySkipRefuseAnswer(narrowed, "skipped")).toEqual({
      error: "skip_not_allowed",
    });
    const afterSkip = applySkipRefuseAnswer(narrowed, "cheap_storage");
    expect("error" in afterSkip).toBe(false);
    if ("error" in afterSkip) return;
    const afterDiffer = applyDifferAnswer(
      { ...afterSkip, audience: "gifts", askStep: 3 },
      "skipped",
    );
    expect(afterDiffer).toEqual({ error: "skip_not_allowed" });
    expect(applyDifferAnswer(EMPTY_AGENT_FRAME, "skipped")).toEqual({
      error: "skip_not_allowed",
    });
  });
});

describe("§14 PR3 persist + UI contracts", () => {
  it("Explore more does not create a new Discovery session id; Refresh does", () => {
    const service = read("lib/discovery/service.ts");
    const beginFn = service.slice(
      service.indexOf("export async function beginAgentExploreMore"),
      service.indexOf("export async function submitAgentExploreWhy"),
    );
    const whyFn = service.slice(
      service.indexOf("export async function submitAgentExploreWhy"),
      service.indexOf("export async function continueDiscoverySession"),
    );
    for (const fn of [beginFn, whyFn]) {
      expect(fn).not.toContain("closeAndOpenScoredSession");
      expect(fn).not.toContain("refreshDiscoverySuggestions");
      expect(fn).not.toContain("continueDiscoverySession");
      expect(fn).not.toContain("insertSessionPool");
    }
    expect(whyFn).toContain("sessionHasAgentTail");
    expect(whyFn).toContain("scoreUnseenAgentBatch");
    expect(whyFn).toContain("beginNarrowing");
    expect(whyFn).toContain("keepLookingRequiresNarrowing");
    expect(whyFn).toContain("exploreMoreCount");

    const refreshFn = service.slice(
      service.indexOf("async function closeAndOpenScoredSession"),
      service.indexOf("export async function submitDiscoveryPassFeedback"),
    );
    expect(refreshFn).toContain("insertSessionPool");
    expect(refreshFn).toContain('status: "closed"');
  });

  it("not_convinced narrows before any keep_looking retrieve; 6th is blocked until fields written", () => {
    const service = read("lib/discovery/service.ts");
    const whyFn = service.slice(
      service.indexOf("export async function submitAgentExploreWhy"),
      service.indexOf("export async function continueDiscoverySession"),
    );
    const notConvincedIdx = whyFn.indexOf('input.why === "not_convinced"');
    const tailIdx = whyFn.indexOf("sessionHasAgentTail");
    expect(notConvincedIdx).toBeGreaterThan(0);
    expect(tailIdx).toBeGreaterThan(notConvincedIdx);
    expect(whyFn).toContain("keepLookingRequiresNarrowing(session.exploreMoreCount)");
    expect(whyFn).toContain('return { ok: true, next: "narrowing" }');

    const saveFn = service.slice(
      service.indexOf("export async function saveDiscoveryAgentAsk"),
      service.indexOf("export type AgentAskStepInput"),
    );
    expect(saveFn).toContain("isNarrowingFieldsWritten");
    expect(saveFn).toContain("exploreMoreCount: 0");
  });

  it("keep_looking appends via isInAgentVisibleGrid; not_convinced still replaces", () => {
    const service = read("lib/discovery/service.ts");
    expect(service).toContain("isInAgentVisibleGrid");
    expect(service).toContain("parseShownCatalogKeys");
    expect(service).toContain("extraExcludeKeys");
    expect(service).toContain("AGENT_HELD_RANK_BASE");
    expect(service).toContain("keepCandidateIds");
    expect(service).toContain("takeExploreBatch");
    const viewFn = service.slice(
      service.indexOf("export async function getDiscoveryView"),
    );
    expect(viewFn).toContain("isInAgentVisibleGrid");
    expect(viewFn).not.toContain("isInAgentGridWindow");
    const whyFn = service.slice(
      service.indexOf("export async function submitAgentExploreWhy"),
      service.indexOf("export async function continueDiscoverySession"),
    );
    expect(whyFn).not.toContain("replaceSessionCandidates");
    const replaceFn = service.slice(
      service.indexOf("async function replaceSessionCandidates"),
      service.indexOf("async function mergeShownCatalogKeys"),
    );
    expect(replaceFn).toContain("status, \"shown\"");
    expect(replaceFn).not.toContain("closeAndOpenScoredSession");
  });

  it("narrowing hides Skip; first-ask skip remains on skipRefuse/audience; differ has no Skip", () => {
    const ask = read("components/discovery/DiscoveryAgentAsk.tsx");
    expect(ask).toContain("skipAllowed");
    expect(ask).toContain("{skipAllowed ? (");
    expect(ask).toContain("agentAskSkip");
    expect(ask).toContain("AGENT_WHY_CHIPS");
    expect(ask).toContain("agentWhyExplore_");
    expect(ask).toContain("data-discovery-agent-why");
    expect(ask).toContain("key={chip.key}");
    expect(ask).not.toContain("key={label}");
    expect(ask).toContain("<AskSkipRefuseCard");
    expect(ask).toContain("<AskAudienceCard");
    expect(ask).toContain("<AskDifferCard keepCandidateIds={keepCandidateIds} />");
    const differCard = ask.slice(
      ask.indexOf("function AskDifferCard"),
      ask.indexOf("function SkipButton"),
    );
    expect(differCard).not.toContain("SkipButton");
    expect(differCard).not.toContain("agentAskSkip");
    expect(differCard).not.toContain('value: "skipped"');

    const board = read("components/discovery/DiscoveryBoard.tsx");
    expect(board).toContain("skipAllowed={!view.agentFrame.narrowing}");
    expect(board).toContain("DiscoveryAgentExploreMoreButton");
    expect(board).toContain("empty && view.ladder && !view.agentUiEnabled");
    expect(board).toContain("agentNothingFits");
    expect(board).not.toMatch(
      /agentUiEnabled[\s\S]{0,80}emptyContinueTitle/,
    );

    const actions = read("actions/discovery.ts");
    expect(actions).toContain("beginAgentExploreMoreAction");
    expect(actions).toContain("submitAgentExploreWhyAction");
    expect(actions).not.toContain("serper");
    expect(actions).not.toContain("serpapi");
    expect(actions).not.toContain("SERP");
  });

  it("Explore more action has no live search; Compare is still pickCompareWinner", () => {
    const service = read("lib/discovery/service.ts");
    const whyFn = service.slice(
      service.indexOf("export async function submitAgentExploreWhy"),
      service.indexOf("export async function continueDiscoverySession"),
    );
    expect(whyFn).not.toContain("serper");
    expect(whyFn).not.toContain("serpapi");
    expect(whyFn).not.toContain("getDiscoverySearchProvider");
    expect(whyFn).not.toContain("closeAndOpenScoredSession");
    const retrieveFn = service.slice(
      service.indexOf("async function retrieveAgentGrid"),
      service.indexOf("export async function startDiscoverySession"),
    );
    const unseenFn = service.slice(
      service.indexOf("async function scoreUnseenAgentBatch"),
      service.indexOf("async function retrieveAgentGrid"),
    );
    for (const fn of [whyFn, retrieveFn, unseenFn]) {
      expect(fn).not.toContain("serper");
      expect(fn).not.toContain("serpapi");
      expect(fn).not.toContain("getDiscoverySearchProvider");
    }
    expect(retrieveFn).toContain("applyAgentFrameRank");
    expect(unseenFn).toContain("applyAgentFrameRank");

    const board = read("components/discovery/DiscoveryBoard.tsx");
    expect(board).toContain("compareWorthConsideringAction");
    expect(board).toContain("toggleWorthConsideringMark");
    const pick = pickCompareWinner([
      {
        candidateId: "a",
        catalogKey: "a",
        name: "A",
        compositeScore: 0.2,
        fitScore: 50,
        rank: 0,
        strength: "Okay",
        marginsPass: true,
      },
      {
        candidateId: "b",
        catalogKey: "b",
        name: "B",
        compositeScore: 0.9,
        fitScore: 80,
        rank: 1,
        strength: "Strong",
        marginsPass: true,
      },
    ]);
    expect(pick.advised.candidateId).toBe("b");
  });

  it("migration 0016 when is high enough for Neon and uses IF NOT EXISTS", () => {
    const journal = JSON.parse(
      readFileSync(
        path.join(process.cwd(), "drizzle/meta/_journal.json"),
        "utf8",
      ),
    ) as { entries: { tag: string; when: number }[] };
    const row = journal.entries.find(
      (e) => e.tag === "0016_discovery_agent_explore",
    );
    expect(row?.when).toBeGreaterThanOrEqual(1787500000000);
    const sql = readFileSync(
      path.join(process.cwd(), "drizzle/0016_discovery_agent_explore.sql"),
      "utf8",
    );
    expect(sql).toContain("IF NOT EXISTS");
    expect(sql).toContain("explore_more_count");
    expect(sql).toContain("shown_catalog_keys_json");
  });
});
