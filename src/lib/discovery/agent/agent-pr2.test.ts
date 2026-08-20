/**
 * WAVE-2 §14 PR2 — intro + ask + Other classifier + session chips.
 */

import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { containsSellAsIsWording } from "@/lib/discovery/agent/differ-blocklist";
import { INDUSTRY_OPTIONS } from "@/lib/constants";

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

const PR2_I18N_KEYS = [
  "agentIntroTitle",
  "agentIntroBody",
  "agentIntroNext",
  "agentAskSellTitle",
  "agentAskSellHint",
  "agentAskOtherLabel",
  "agentAskOtherPlaceholder",
  "agentAskSkip",
  "agentAskNext",
  "agentAskSellEmpty",
  "agentAskSkipRefuseTitle",
  "agentAskSkipRefuseHint",
  "agentAskSkipRefuse_cheap_storage",
  "agentAskAudienceTitle",
  "agentAskAudience_myself",
  "agentAskAudience_gifts",
  "agentAskAudience_households",
  "agentAskAudience_creators",
  "agentAskDifferTitle",
  "agentAskDifferHint",
  "agentAskDiffer_demo",
  "agentAskDiffer_bundle",
  "agentAskDiffer_niche",
  "agentDontDealTitle",
  "agentDontDealBody",
  "agentChipSkipped",
] as const;

describe("§14 PR2 i18n", () => {
  it("has EN+AR intro/ask/don’t-deal keys; AR is Arabic", () => {
    const en = messages("en");
    const ar = messages("ar");
    expect(INDUSTRY_OPTIONS).toHaveLength(10);
    for (const key of PR2_I18N_KEYS) {
      expect(en[key]?.length ?? 0, `en.${key}`).toBeGreaterThan(2);
      expect(ar[key]?.length ?? 0, `ar.${key}`).toBeGreaterThan(2);
      expect(ar[key]).not.toBe(en[key]);
      expect(ar[key]).toMatch(/[\u0600-\u06FF]/);
      expect(containsSellAsIsWording(en[key]!)).toBe(false);
      expect(containsSellAsIsWording(ar[key]!)).toBe(false);
    }
  });

  it("intro copy lists none as used cars / bakery, not paintings", () => {
    const en = messages("en");
    const ar = messages("ar");
    expect(en.agentIntroBody.toLowerCase()).toContain("used cars");
    expect(en.agentIntroBody.toLowerCase()).toContain("bakery");
    expect(en.agentIntroBody.toLowerCase()).toContain("paintings");
    expect(en.agentIntroBody.toLowerCase()).toContain("home");
    expect(ar.agentIntroBody).toMatch(/مخبز|مخابز/);
    expect(en.agentDontDealBody.toLowerCase()).toContain("baker");
    expect(en.agentDontDealBody.toLowerCase()).toContain("will not change");
    expect(ar.agentDontDealBody).toMatch(/[\u0600-\u06FF]/);
    expect(ar.agentDontDealBody).toMatch(/مخبز|مخابز/);
  });
});

describe("§14 PR2 persist + retrieve contracts", () => {
  it("intro-seen is profile-scoped; Refresh opens a new session with a fresh frame", () => {
    const schema = read("db/schema.ts");
    expect(schema).toContain("discoveryIntroSeen");
    expect(schema).toContain("discovery_intro_seen");
    expect(schema).toContain("agentFrameJson");
    expect(schema).toContain("agent_frame_json");

    const service = read("lib/discovery/service.ts");
    const introFn = service.slice(
      service.indexOf("export async function markDiscoveryIntroSeen"),
      service.indexOf("export async function saveDiscoveryAgentAsk"),
    );
    expect(introFn).toContain("onboardingProfiles");
    expect(introFn).toContain("discoveryIntroSeen: true");
    expect(introFn).not.toContain("discoverySessions");

    const insertFn = service.slice(
      service.indexOf("async function insertSessionPool"),
      service.indexOf("function candidateRowsFromScored"),
    );
    expect(insertFn).toContain("agentFrameJson: null");

    const refreshFn = service.slice(
      service.indexOf("async function closeAndOpenScoredSession"),
      service.indexOf("export async function submitDiscoveryPassFeedback"),
    );
    expect(refreshFn).toContain("isDiscoveryAgentUiEnabled");
    expect(refreshFn).toContain("insertSessionPool(workspaceId, [])");
    expect(refreshFn).not.toContain("agentFrameJson:");
  });

  it("flag off still scores on start; flag on delays retrieve until ask completes", () => {
    const service = read("lib/discovery/service.ts");
    const startFn = service.slice(
      service.indexOf("export async function startDiscoverySession"),
      service.indexOf("export async function markDiscoveryIntroSeen"),
    );
    expect(startFn).toContain("isDiscoveryAgentUiEnabled");
    expect(startFn).toContain("insertSessionPool(workspaceId, [])");
    expect(startFn).toContain("scoreRankForDiscovery(onboarding, new Set())");

    const saveFn = service.slice(
      service.indexOf("export async function saveDiscoveryAgentAsk"),
      service.indexOf("export type AgentAskStepInput"),
    );
    expect(saveFn).toContain("serializeAgentFrame");
    expect(saveFn).toContain("retrieveAgentGrid");
    expect(saveFn).not.toContain("gemini");
    expect(saveFn).not.toContain("reorder");
    expect(service).toContain("restrictCategories: plan.industryIds");
    expect(service).toContain("applyAgentFrameRank");
    const retrieveFn = service.slice(
      service.indexOf("async function retrieveAgentGrid"),
      service.indexOf("export async function startDiscoverySession"),
    );
    const unseenFn = service.slice(
      service.indexOf("async function scoreUnseenAgentBatch"),
      service.indexOf("async function retrieveAgentGrid"),
    );
    expect(retrieveFn).toContain("applyAgentFrameRank");
    expect(unseenFn).toContain("applyAgentFrameRank");
    expect(startFn).not.toContain("applyAgentFrameRank");
  });

  it("uses the existing Other classifier; don’t-deal suppresses Edit onboarding", () => {
    const frame = read("lib/discovery/agent/frame.ts");
    expect(frame).toContain('from "@/lib/discovery/agent/other-industry"');
    expect(frame).toContain("classifyOtherIndustry");
    expect(frame).toContain("isOtherDontDeal");
    expect(frame).toContain("resolveOtherRetrieveIndustry");

    const askUi = read("components/discovery/DiscoveryAgentAsk.tsx");
    expect(askUi).toContain("INDUSTRY_OPTIONS");
    expect(askUi).toContain("onboardingIndustryLikes");
    expect(askUi).toContain("AGENT_OTHER_MAX_CHARS");
    expect(askUi).toContain("data-discovery-agent-intro");
    expect(askUi).toContain("data-discovery-agent-dont-deal");
    expect(askUi).toContain("data-discovery-agent-chips");
    expect(askUi).toContain("key={chip.key}");
    expect(askUi).not.toContain("key={label}");
    expect(askUi).toContain("skipAllowed");
    expect(askUi).toContain("<AskSkipRefuseCard");
    expect(askUi).toContain("<AskAudienceCard");
    const differCard = askUi.slice(
      askUi.indexOf("function AskDifferCard"),
      askUi.indexOf("function SkipButton"),
    );
    expect(differCard).not.toContain("skipAllowed");
    expect(differCard).not.toContain("SkipButton");
    expect(differCard).not.toContain("agentAskSkip");
    expect(differCard).not.toContain("skipped");

    const viewFn = read("lib/discovery/service.ts").slice(
      read("lib/discovery/service.ts").indexOf(
        "export async function getDiscoveryView",
      ),
    );
    expect(viewFn).toContain("suppressAgentEmpty");
    expect(viewFn).toContain("agentDontDeal");
    expect(viewFn).toContain("editOnboardingBanner: null");
    expect(viewFn).toContain("agentNothingFits");
    expect(viewFn).not.toContain("applyAgentFrameRank");

    const actions = read("actions/discovery.ts");
    expect(actions).toContain("acknowledgeDiscoveryIntroAction");
    expect(actions).toContain("submitAgentAskStepAction");
  });
});
