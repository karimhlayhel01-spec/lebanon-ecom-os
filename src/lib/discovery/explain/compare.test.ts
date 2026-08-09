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
  COMPARE_BODY_MAX_CHARS,
  COMPARE_BODY_MIN_CHARS,
  finalizeCompareBody,
  isCompleteCompareBody,
  type CompareProductPayload,
} from "@/lib/discovery/explain/compare";
import { narrateCompareWithGemini, AR_COMPARE_GOOD_EXAMPLE } from "@/lib/discovery/explain/compare-llm";
import { pickCompareWinner } from "@/lib/discovery/compare/pick";
import { splitSuggestionSentences } from "@/lib/discovery/explain/why-pick";

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

  it("packs an over-long Gemini draft into whole sentences inside the window", () => {
    const pad =
      "with careful sample economics, modest ads spend, and a clear stop rule if paid orders do not appear within the first test window ";
    const sentences = [
      `Among these marks, skills advise starting with Widget because Fit 95/100 and planning margins around 72 percent before ads and 38 percent after clear the shortlist economics more cleanly than Gadget at Fit 80/100 ${pad}while keeping Accept free.`,
      `The advised product's market read is an estimate because no citable live evidence is saved, so the opportunity remains a hypothesis rather than a proven abroad-versus-local gap ${pad}for this founder.`,
      `Gadget is also estimate-only, with a weaker Fit reading and the same need to prove paid demand before a wider order ${pad}rather than scaling early.`,
      `Both products clear hard planning margins, so economics alone do not separate them and the founder still needs a paid-demand test ${pad}before a wider buy.`,
      `Test Widget first with one small sample and the curated heat-safe stand angle, keeping ads modest until real orders validate the estimate ${pad}and logistics.`,
      `Accept remains your free choice on any card; skills only advise which marked product to sample first among this set ${pad}without locking Accept.`,
      `A seventh sentence adds more detail about logistics that the founder does not need in this compare window and should be dropped whole ${pad}when packed.`,
      `An eighth sentence would also be dropped once the packed brief already sits inside the locked length and sentence footprint ${pad}for founders.`,
      `A ninth sentence exists only to prove packing never returns incomplete solely because clamp cut mid-paragraph ${pad}on a long draft.`,
    ];
    const raw = sentences.join(" ");
    expect(raw.length).toBeGreaterThan(COMPARE_BODY_MAX_CHARS);

    const body = finalizeCompareBody(raw, "Widget");
    expect(body).toBeTruthy();
    expect(body!.length).toBeGreaterThanOrEqual(COMPARE_BODY_MIN_CHARS);
    expect(body!.length).toBeLessThanOrEqual(COMPARE_BODY_MAX_CHARS);
    const kept = splitSuggestionSentences(body!);
    expect(kept.length).toBeGreaterThanOrEqual(4);
    expect(kept.length).toBeLessThanOrEqual(8);
    expect(body).not.toContain("ninth sentence");
    expect(isCompleteCompareBody(body!)).toBe(true);
  });

  it("does not treat U.S. or e.g. abbreviations as fake sentence ends", () => {
    const withAbbrevs =
      "Among these marks, skills advise starting with Widget because buyers compare this category on price in the U.S. market alone more cleanly than Gadget at Fit 80/100. " +
      "Widget's market read is an estimate, e.g. a hypothesis rather than a proven abroad-versus-local gap from saved live evidence. " +
      "Gadget is also estimate-only, with a weaker Fit reading and the same need to prove paid demand before a wider order. " +
      "Test Widget first with one small sample and the curated heat-safe stand angle, keeping ads modest until real orders validate the estimate. " +
      "Accept remains your free choice on any card; skills only advise which marked product to sample first among this set.";
    const body = finalizeCompareBody(withAbbrevs, "Widget");
    expect(body).toBeTruthy();
    expect(isCompleteCompareBody(body!)).toBe(true);
    // Naive `(?<=[.!?])\\s+` would invent short fragments after "U.S." / "e.g."
    expect(splitSuggestionSentences(body!).length).toBe(5);
    expect(body).toContain("U.S. market");
    expect(body).toContain("e.g. a hypothesis");
  });

  it("keeps §6.2 mark-feature language while still rejecting filler verdicts", () => {
    const withFeatureName =
      "Among these worth considering marks, skills advise starting with Widget because Fit 95/100 and planning margins around 72 percent before ads and 38 percent after clear the shortlist economics more cleanly than Gadget at Fit 80/100. " +
      "Strong Fit on Widget is an operational read, and the market side stays an estimate because no citable live evidence is saved. " +
      "Gadget is also estimate-only, with a weaker Fit reading and the same need to prove paid demand before a wider order. " +
      "Test Widget first with one small sample and the curated heat-safe stand angle, keeping ads modest until real orders validate the estimate. " +
      "Accept remains your free choice on any card; skills only advise which marked product to sample first among this set.";
    expect(finalizeCompareBody(withFeatureName, "Widget")).toBeTruthy();

    const fillerVerdict =
      "Among these marks, Widget is worth considering because Fit 95/100 and planning margins around 72 percent before ads and 38 percent after clear the shortlist economics more cleanly than Gadget at Fit 80/100. " +
      "Widget's market read is an estimate because no citable live evidence is saved, so the opportunity remains a hypothesis rather than a proven abroad-versus-local gap. " +
      "Gadget is also estimate-only, with a weaker Fit reading and the same need to prove paid demand before a wider order. " +
      "Test Widget first with one small sample and the curated heat-safe stand angle, keeping ads modest until real orders validate the estimate. " +
      "Accept remains your free choice on any card; skills only advise which marked product to sample first among this set.";
    expect(finalizeCompareBody(fillerVerdict, "Widget")).toBeNull();
  });

  it("keeps alignment when the only advice nomination is the last sentence", () => {
    const pad =
      "with careful sample economics, modest ads spend, and a clear stop rule if paid orders do not appear ";
    // Eight non-advice sentences fill the footprint; only the 9th nominates Widget.
    const sentences = [
      `Among these marks, Fit 95/100 and planning margins around 72 percent before ads and 38 percent after clear the shortlist economics more cleanly for the higher Fit card than Gadget at Fit 80/100 ${pad}today.`,
      `The higher Fit card's market read is an estimate because no citable live evidence is saved, so the opportunity remains a hypothesis rather than a proven abroad-versus-local gap ${pad}here.`,
      `Gadget is also estimate-only, with a weaker Fit reading and the same need to prove paid demand before a wider order ${pad}now.`,
      `Both products clear hard planning margins, so economics alone do not separate them and the founder still needs a paid-demand test ${pad}first.`,
      `The curated heat-safe stand angle is the practical way to seek an advantage without inventing market specifics ${pad}yet.`,
      `The main uncertainty is whether customers will pay the planned price for that angle once ads start ${pad}soon.`,
      `Keep the first ads budget controlled while measuring paid demand against that estimate ${pad}carefully.`,
      `Accept remains your free choice on any card among these marks while the sample test is still pending ${pad}today.`,
      "Skills advise starting a sample test on Widget among these marks; Accept remains your free choice on any card.",
    ];
    const raw = sentences.join(" ");
    const body = finalizeCompareBody(raw, "Widget", ["Gadget"]);
    expect(body).toBeTruthy();
    expect(
      assertCompareAdviceAligned(
        body!,
        buildCompareExplainPayload({
          advisedCandidateId: "w",
          products: [
            estimateProduct({
              candidateId: "w",
              catalogKey: "widget",
              productName: "Widget",
              fitScore: 95,
            }),
            estimateProduct({
              candidateId: "g",
              catalogKey: "gadget",
              productName: "Gadget",
              fitScore: 80,
            }),
          ],
        }),
      ),
    ).toBe(true);
    expect(body).toMatch(/skills advise starting a sample test on Widget/i);
  });

  it("appends a skills footer when narration never nominates the advised product", () => {
    const noAdvice =
      "Among these marks, Fit 95/100 and planning margins around 72 percent before ads and 38 percent after clear the shortlist economics more cleanly for Widget than Gadget at Fit 80/100. " +
      "Widget's market read is an estimate because no citable live evidence is saved, so the opportunity remains a hypothesis rather than a proven abroad-versus-local gap. " +
      "Gadget is also estimate-only, with a weaker Fit reading and the same need to prove paid demand before a wider order. " +
      "Both products clear hard planning margins, so economics alone do not separate them. " +
      "Accept remains your free choice on any card among these marks while the sample test is still pending.";
    const body = finalizeCompareBody(noAdvice, "Widget", ["Gadget"]);
    expect(body).toBeTruthy();
    expect(body).toMatch(/Skills advise starting a sample test on Widget/i);
    expect(
      assertCompareAdviceAligned(
        body!,
        buildCompareExplainPayload({
          advisedCandidateId: "w",
          products: [
            estimateProduct({
              candidateId: "w",
              catalogKey: "widget",
              productName: "Widget",
            }),
            estimateProduct({
              candidateId: "g",
              catalogKey: "gadget",
              productName: "Gadget",
              fitScore: 80,
            }),
          ],
        }),
      ),
    ).toBe(true);
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
    const invented =
      "Among these marks, skills advise starting with Widget because amazon.com shows US traction and a Lebanon gap versus Gadget at Fit 80/100. " +
      "Fit 95/100 and hard margins clear the shortlist economics more cleanly for Widget than for the weaker Fit reading on Gadget. " +
      "Gadget remains estimate-only with the same need to prove paid demand before a wider order. " +
      "Test Widget first with one small sample and the curated heat-safe stand angle, keeping ads modest until real orders validate the estimate. " +
      "Accept remains your free choice on any card; skills only advise which marked product to sample first among this set.";
    const fetchFn: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: invented }] } }],
        }),
        { status: 200 },
      );
    const r = await narrateCompareWithGemini(payload, "en", {
      apiKey: "test",
      fetchFn,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("ungrounded");
  });

  it("grounds after finalize so a trimmed trailing claim does not fail", async () => {
    const payload = buildCompareExplainPayload({
      advisedCandidateId: "w",
      products: [widget, gadget],
    });
    // Eight whole sentences fill the footprint (≤3 Widget mentions); the 9th
    // cites amazon.com and must be dropped before grounding — without
    // hard-block phrases on the raw draft.
    const eightGood = [
      "Among these marks, skills advise starting with Widget because Fit 95/100 and planning margins around 72 percent before ads and 38 percent after clear the shortlist economics more cleanly than Gadget at Fit 80/100.",
      "The advised product's market read is an estimate because no citable live evidence is saved, so the opportunity remains a hypothesis rather than a proven abroad-versus-local gap.",
      "Gadget is also estimate-only, with a weaker Fit reading and the same need to prove paid demand before a wider order.",
      "Both products clear hard planning margins, so economics alone do not separate them and the founder still needs a paid-demand test.",
      "The curated heat-safe stand angle is the practical way to seek an advantage without inventing market specifics.",
      "The main uncertainty is whether customers will pay the planned price for that angle once ads start.",
      "Test Widget first with one small sample and keep ads modest until real orders validate the estimate.",
      "Accept remains your free choice on any card; skills only advise which marked product to sample first among this set.",
    ].join(" ");
    const raw = `${eightGood} Similar products list on amazon.com at much higher prices, which is exactly why the offer has to look different.`;
    expect(splitSuggestionSentences(raw).length).toBe(9);

    let calls = 0;
    const fetchFn: typeof fetch = async () => {
      calls += 1;
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: raw }] } }],
        }),
        { status: 200 },
      );
    };
    const r = await narrateCompareWithGemini(payload, "en", {
      apiKey: "test",
      fetchFn,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.result.body).not.toContain("amazon.com");
      expect(splitSuggestionSentences(r.result.body).length).toBe(8);
    }
    expect(calls).toBe(1);
  });

  it("still rejects hard-blocked wording on the raw draft", async () => {
    const payload = buildCompareExplainPayload({
      advisedCandidateId: "w",
      products: [widget, gadget],
    });
    const jargon =
      "Among these marks, skills advise starting with Widget because the composite whitespace demand path and heuristic skill payload clear the shortlist more cleanly than Gadget. " +
      "Widget's market read is an estimate because no citable live evidence is saved, so the opportunity remains a hypothesis rather than a proven abroad-versus-local gap. " +
      "Gadget is also estimate-only, with a weaker Fit reading and the same need to prove paid demand before a wider order. " +
      "Test Widget first with one small sample and the curated heat-safe stand angle, keeping ads modest until real orders validate the estimate. " +
      "Accept remains your free choice on any card; skills only advise which marked product to sample first among this set.";
    const fetchFn: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: jargon }] } }],
        }),
        { status: 200 },
      );
    const r = await narrateCompareWithGemini(payload, "en", {
      apiKey: "test",
      fetchFn,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("ungrounded");
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

  it("cache version is v6 ar-example-length", () => {
    expect(COMPARE_CACHE_VERSION).toBe("v6-ar-example-length");
  });

  it("AR compare GOOD prompt example meets locked min chars", () => {
    expect(AR_COMPARE_GOOD_EXAMPLE.length).toBeGreaterThanOrEqual(
      COMPARE_BODY_MIN_CHARS,
    );
    expect(AR_COMPARE_GOOD_EXAMPLE.length).toBeLessThanOrEqual(
      COMPARE_BODY_MAX_CHARS,
    );
    expect(AR_COMPARE_GOOD_EXAMPLE).toMatch(/الملاءمة|مقبول|قوي/);
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
