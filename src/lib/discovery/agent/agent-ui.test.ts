/**
 * WAVE-2 §14 PR1 — flag-gated agent result list (hide-dump is tested separately).
 */

import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  containsSellAsIsWording,
  SELL_AS_IS_BLOCKLIST,
  safeDifferentiateLine,
} from "@/lib/discovery/agent/differ-blocklist";
import {
  DISCOVERY_COMPARE_MAX,
  DISCOVERY_COMPARE_MIN,
} from "@/lib/constants";
import {
  pickCompareWinner,
  toggleWorthConsideringMark,
} from "@/lib/discovery/compare/pick";
import { containsStockPhrase } from "@/lib/discovery/explain/why-pick";

const root = path.join(process.cwd(), "src");

function read(rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

function messages(locale: "en" | "ar"): Record<string, string> {
  return JSON.parse(
    readFileSync(
      path.join(process.cwd(), `messages/${locale}.json`),
      "utf8",
    ),
  ).Discovery as Record<string, string>;
}

const AGENT_I18N_KEYS = [
  "agentProceedWithThis",
  "agentBasketTitle",
  "agentBasketEmpty",
  "agentBasketCount",
  "agentAddToBasket",
  "agentRemoveFromBasket",
  "agentBasketClear",
  "agentPhotoPlaceholder",
  "agentDifferFallback",
  "agentWhyAria",
] as const;

describe("§14 PR1 agent UI strings", () => {
  it("has EN+AR keys and AR is Arabic, not English", () => {
    const en = messages("en");
    const ar = messages("ar");
    for (const key of AGENT_I18N_KEYS) {
      expect(en[key]?.length ?? 0, `en.${key}`).toBeGreaterThan(4);
      expect(ar[key]?.length ?? 0, `ar.${key}`).toBeGreaterThan(4);
      expect(ar[key]).not.toBe(en[key]);
      expect(ar[key]).toMatch(/[\u0600-\u06FF]/);
    }
  });

  it("new differ/Why i18n has no sell-as-is blocklist hits", () => {
    const en = messages("en");
    const ar = messages("ar");
    for (const key of AGENT_I18N_KEYS) {
      expect(containsSellAsIsWording(en[key]!), `${key} EN`).toBe(false);
      expect(containsSellAsIsWording(ar[key]!), `${key} AR`).toBe(false);
      for (const phrase of SELL_AS_IS_BLOCKLIST) {
        expect(en[key]!.toLowerCase()).not.toContain(phrase.toLowerCase());
        expect(ar[key]!.toLowerCase()).not.toContain(phrase.toLowerCase());
      }
    }
    expect(containsSellAsIsWording(en.whySuggestedHonesty)).toBe(false);
    expect(containsSellAsIsWording(ar.whySuggestedHonesty)).toBe(false);
  });
});

describe("differ blocklist", () => {
  it("rejects sell-as-is / undercut / guaranteed sales and uses fallback", () => {
    expect(containsSellAsIsWording("Just sell as-is on Ishtari.")).toBe(true);
    expect(containsSellAsIsWording("Undercut Ishtari on price.")).toBe(true);
    expect(containsSellAsIsWording("Guaranteed sales this week.")).toBe(true);
    expect(containsStockPhrase("Founders should sell as-is.")).toBe(true);
    expect(
      safeDifferentiateLine("sell as is in local shops", "fallback"),
    ).toBe("fallback");
    expect(safeDifferentiateLine("Bundle with an Arabic guide.", "fallback")).toBe(
      "Bundle with an Arabic guide.",
    );
  });
});

describe("basket uses the same compare marks + pickCompareWinner", () => {
  it("caps at 3; 1 is not compare; 2–3 is compare", () => {
    expect(DISCOVERY_COMPARE_MAX).toBe(3);
    expect(DISCOVERY_COMPARE_MIN).toBe(2);
    let ids: string[] = [];
    ids = toggleWorthConsideringMark(ids, "a").ids;
    expect(ids).toHaveLength(1);
    expect(ids.length === 1).toBe(true);
    ids = toggleWorthConsideringMark(ids, "b").ids;
    ids = toggleWorthConsideringMark(ids, "c").ids;
    expect(toggleWorthConsideringMark(ids, "d").blockedAtMax).toBe(true);
    const pick = pickCompareWinner([
      {
        candidateId: "a",
        catalogKey: "a",
        name: "A",
        compositeScore: 0.4,
        fitScore: 70,
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
});

describe("DiscoveryBoard flag-gated replace", () => {
  it("keeps the 5-card board path when flag is off", () => {
    const board = read("components/discovery/DiscoveryBoard.tsx");
    expect(board).toContain("function ProductCard");
    expect(board).toContain("worthConsidering");
    expect(board).toContain("WorthConsideringCompareBox");
    expect(board).toContain("showMore");
    expect(board).toContain("showLegacyCompareTray");
  });

  it("agent tiles show compact receipts; flag-off checkboxes do not require differ skip", () => {
    const board = read("components/discovery/DiscoveryBoard.tsx");
    const tile = board.slice(
      board.indexOf("function AgentProductTile"),
      board.indexOf("function WorthConsideringCompareBox"),
    );
    expect(tile).toContain("data-discovery-agent-receipts");
    expect(tile).toContain('t("fit")');
    expect(tile).toContain("c.fitScore");
    expect(tile).toContain("c.marginBefore");
    expect(tile).toContain("c.marginAfter");
    expect(tile).toContain("ScoreFreshnessNote");
    expect(tile).toContain("whySuggestedHonestyLive");
    expect(tile).toContain("whySuggestedHonestyEstimate");
    expect(tile).toContain("safeDifferentiateLine");
    expect(tile).not.toContain("generate-all");
    expect(tile).not.toContain("fetch(");

    const card = board.slice(
      board.indexOf("function ProductCard"),
      board.indexOf("function ScoreFreshnessNote"),
    );
    expect(card).toContain("worthConsidering");
    expect(card).not.toContain("AskDifferCard");
    expect(card).not.toContain("agentAskSkip");
    expect(card).not.toContain("AGENT_DIFFER_CHIPS");
  });

  it("agent UI replaces the card list and checkboxes; hide Show more", () => {
    const board = read("components/discovery/DiscoveryBoard.tsx");
    expect(board).toContain("view.agentUiEnabled");
    expect(board).toContain("data-discovery-agent-grid");
    expect(board).toContain("AgentProductTile");
    expect(board).toContain("agentProceedWithThis");
    expect(board).toContain("acceptProductAction");
    expect(board).toContain("compareWorthConsideringAction");
    expect(board).toContain("toggleWorthConsideringMark");
    expect(board).toContain("!view.agentUiEnabled");
    expect(board).toContain("showLegacyCompareTray");
    expect(board).toContain("WhySuggestedModal");
    expect(board).toContain("DiscoveryAgentIntro");
    expect(board).toContain("DiscoveryAgentAsk");
    expect(board).toContain("DiscoveryAgentDontDeal");
    expect(board).toContain("DiscoveryAgentFrameChips");
    expect(board).toContain("view.agentPhase");
    expect(board).toContain("view.agentDontDeal");
    expect(board).toContain("DiscoveryAgentExploreMoreButton");
  });

  it("retrieve applies hide-dump only through the existing helper", () => {
    const service = read("lib/discovery/service.ts");
    expect(service).toContain("applyHideDumpToRanked");
    expect(service).toContain("isDiscoveryAgentUiEnabled");
    expect(service).toContain("agentUiEnabled");
    expect(service).toContain("imageUrl");
  });

  it("agent grid uses one pool <img> or the existing placeholder; flag-off cards stay photo-less", () => {
    const board = read("components/discovery/DiscoveryBoard.tsx");
    const tile = board.slice(
      board.indexOf("function AgentProductTile"),
      board.indexOf("function WorthConsideringCompareBox"),
    );
    expect(tile).toContain("c.imageUrl ?");
    expect(tile).toContain("<img");
    expect(tile).toContain("agentPhotoPlaceholder");
    expect(tile).toContain("data-discovery-agent-photo-placeholder");
    const card = board.slice(
      board.indexOf("function ProductCard"),
      board.indexOf("function ScoreFreshnessNote"),
    );
    expect(card).not.toContain("<img");
  });
});
