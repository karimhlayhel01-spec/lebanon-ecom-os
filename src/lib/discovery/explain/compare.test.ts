import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import {
  COMPARE_CACHE_VERSION,
  clearWhyPickCacheForTests,
} from "@/lib/discovery/explain/cache";
import {
  assertCompareAdviceAligned,
  buildCompareExplainPayload,
  finalizeCompareBody,
  isCompleteCompareBody,
  type CompareProductPayload,
} from "@/lib/discovery/explain/compare";
import { narrateCompareWithGemini } from "@/lib/discovery/explain/compare-llm";
import { pickCompareWinner } from "@/lib/discovery/compare/pick";

afterEach(() => {
  clearWhyPickCacheForTests();
  delete process.env.DISCOVERY_POOL_V2;
  delete process.env.GEMINI_API_KEY;
});

function estimateProduct(
  partial: Partial<CompareProductPayload> &
    Pick<CompareProductPayload, "candidateId" | "productName" | "catalogKey">,
): CompareProductPayload {
  return {
    fitScore: 90,
    strength: "Strong",
    softMarginBand: "pass",
    marginBefore: 0.72,
    marginAfter: 0.38,
    canCiteMarketSignals: false,
    evidenceSource: "heuristic_seed",
    curatedDifferentiation: "Bundle with a heat-safe stand.",
    marketEvidence: null,
    ...partial,
  };
}

const estimateBrief =
  "Among these marks, skills advise starting with Widget because Fit 95/100 and planning margins around 72 percent before ads and 38 percent after clear the shortlist economics more cleanly than Gadget at Fit 80/100. " +
  "Widget's market read is an estimate because no citable live evidence is saved, so the opportunity remains a hypothesis rather than a proven abroad-versus-local gap. " +
  "Gadget is also estimate-only, with a weaker Fit reading and the same need to prove paid demand before a wider order. " +
  "Test Widget first with one small sample and the curated heat-safe stand angle, keeping ads modest until real orders validate the estimate. " +
  "Accept remains your free choice on any card; skills only advise which marked product to sample first among this set.";

describe("compare body validators", () => {
  it("accepts a complete longer brief and rejects mid-sentence stubs", () => {
    expect(estimateBrief.length).toBeGreaterThan(500);
    expect(isCompleteCompareBody(estimateBrief)).toBe(true);
    expect(finalizeCompareBody(estimateBrief, "Widget")).toBeTruthy();
    expect(
      isCompleteCompareBody("Widget looks better among these two products"),
    ).toBe(false);
    expect(
      isCompleteCompareBody(
        "Among these marks, skills advise starting with Widget because Fit is strong. This ending is cut off without a period",
      ),
    ).toBe(false);
    expect(
      finalizeCompareBody(
        "Among these marks skills advise Widget without finishing",
        "Widget",
      ),
    ).toBeNull();
  });
});

describe("Gemini compare narrator (mocked)", () => {
  const widget = estimateProduct({
    candidateId: "w",
    catalogKey: "widget",
    productName: "Widget",
    fitScore: 95,
  });
  const gadget = estimateProduct({
    candidateId: "g",
    catalogKey: "gadget",
    productName: "Gadget",
    fitScore: 80,
  });

  it("narrates the skills winner and does not override", async () => {
    const skills = pickCompareWinner([
      {
        candidateId: "w",
        catalogKey: "widget",
        name: "Widget",
        compositeScore: 0.9,
        fitScore: 95,
        rank: 0,
        strength: "Strong",
        marginsPass: true,
      },
      {
        candidateId: "g",
        catalogKey: "gadget",
        name: "Gadget",
        compositeScore: 0.5,
        fitScore: 80,
        rank: 1,
        strength: "Okay",
        marginsPass: true,
      },
    ]);
    expect(skills.advised.candidateId).toBe("w");

    const payload = buildCompareExplainPayload({
      advisedCandidateId: skills.advised.candidateId,
      products: [widget, gadget],
    });
    expect(payload.advisedName).toBe("Widget");

    const fetchFn: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: estimateBrief }] } }],
        }),
        { status: 200 },
      );

    const r = await narrateCompareWithGemini(payload, "en", {
      apiKey: "test",
      fetchFn,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.result.advisedCandidateId).toBe("w");
      expect(r.result.advisedCatalogKey).toBe("widget");
      expect(r.result.body).toContain("Widget");
      expect(r.result.body).not.toMatch(/you must accept/i);
      expect(r.result.honestyKey).toBe("whySuggestedHonestyEstimate");
      expect(r.result.marketSignalsOmitted).toBe(true);
    }
  });

  it("estimate-only path rejects invented live market facts", async () => {
    const payload = buildCompareExplainPayload({
      advisedCandidateId: "w",
      products: [widget, gadget],
    });
    const fetchFn: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text:
                      "Among these marks, skills advise Widget because amazon.com shows US traction and a Lebanon gap versus Gadget. " +
                      "Fit 95/100 and hard margins clear the shortlist. Gadget is weaker on Fit. " +
                      "Test Widget with a sample. Accept remains free choice on any card among these marks.",
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      );
    const r = await narrateCompareWithGemini(payload, "en", {
      apiKey: "test",
      fetchFn,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(["ungrounded", "empty"]).toContain(r.error);
  });

  it("live evidence may cite only allowed facts", async () => {
    const liveWidget: CompareProductPayload = {
      ...widget,
      canCiteMarketSignals: true,
      evidenceSource: "live_search",
      marketEvidence: {
        abroad: {
          count: 4,
          results: [
            { domain: "amazon.com", title: "Amazon listing", seller: null },
          ],
        },
        lebanon: {
          count: 1,
          results: [
            { domain: "ishtari.com", title: "Ishtari listing", seller: "Ishtari" },
          ],
        },
        localCompetition: null,
        tier1Found: ["Ishtari"],
      },
    };
    const payload = buildCompareExplainPayload({
      advisedCandidateId: "w",
      products: [liveWidget, gadget],
    });
    expect(payload.anyLiveEvidence).toBe(true);

    const liveBrief =
      "Among these marks, skills advise starting with Widget because saved live evidence shows 4 abroad results including amazon.com versus 1 Lebanon result while Ishtari appears locally, and Fit 95/100 with hard planning margins clear the shortlist more cleanly than Gadget. " +
      "Gadget remains estimate-only with a weaker Fit reading, so its market claims stay unproven. " +
      "Lead with Widget's curated heat-safe stand angle and keep the first ads budget controlled while measuring paid demand against that competition. " +
      "The main uncertainty is whether the differentiated offer converts efficiently, so order one small sample before scaling. " +
      "Accept remains your free choice on any card; skills only advise which marked product to sample first among this set.";

    const fetchFn: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: liveBrief }] } }],
        }),
        { status: 200 },
      );
    const r = await narrateCompareWithGemini(payload, "en", {
      apiKey: "test",
      fetchFn,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.result.honestyKey).toBe("whySuggestedHonestyLive");
      expect(r.result.body).toContain("amazon.com");
      expect(r.result.body).toContain("Ishtari");
    }
  });

  it("rejects Gemini text that promotes a different winner", () => {
    const payload = buildCompareExplainPayload({
      advisedCandidateId: "w",
      products: [widget, gadget],
    });
    expect(
      assertCompareAdviceAligned(
        "Among these marks, skills advise Gadget because it is easier. Widget is weaker. Test Gadget with a sample. Accept remains free choice.",
        payload,
      ),
    ).toBe(false);
  });

  it("cache version is v1 worth-considering", () => {
    expect(COMPARE_CACHE_VERSION).toMatch(/^v1-worth-considering/);
  });

  it("EN + AR compare copy keys exist", () => {
    const en = JSON.parse(
      readFileSync(path.join(process.cwd(), "messages/en.json"), "utf8"),
    ) as { Discovery: Record<string, string> };
    const ar = JSON.parse(
      readFileSync(path.join(process.cwd(), "messages/ar.json"), "utf8"),
    ) as { Discovery: Record<string, string> };
    for (const locale of [en, ar]) {
      expect(locale.Discovery.worthConsidering.length).toBeGreaterThan(3);
      expect(locale.Discovery.compareButton.length).toBeGreaterThan(2);
      expect(locale.Discovery.compareBoxEmpty.length).toBeGreaterThan(5);
      expect(locale.Discovery.worthConsideringMax.length).toBeGreaterThan(5);
      expect(locale.Discovery.compareAdviceNote.length).toBeGreaterThan(5);
    }
    expect(en.Discovery.compareResultTitle).toMatch(/Skills advice/i);
  });
});
