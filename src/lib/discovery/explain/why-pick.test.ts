import { afterEach, describe, expect, it } from "vitest";
import {
  assertFounderFriendlyCopy,
  assertNoUngroundedMarketClaims,
  buildDeterministicWhyPick,
  canCiteMarketFromPayload,
  clampSuggestionBody,
  containsFounderJargon,
  containsVagueFluff,
  finalizeSuggestionBody,
  isCompleteSuggestionBody,
  skillPayloadFromCandidateMeta,
  SUGGESTION_BODY_MIN_CHARS,
  SUGGESTION_BODY_MAX_CHARS,
} from "@/lib/discovery/explain/why-pick";
import {
  checkWhyPickRateLimit,
  clearWhyPickCacheForTests,
  getCachedWhyPick,
  recordWhyPickRateHit,
  setCachedWhyPick,
  WHY_PICK_CACHE_VERSION,
  WHY_PICK_RATE_LIMIT,
  whyPickCacheKey,
} from "@/lib/discovery/explain/cache";
import {
  DEFAULT_GEMINI_MODEL,
  isGeminiConfigured,
  isSuggestionExplainEnabled,
  narrateSuggestionWithGemini,
  resolveGeminiApiKey,
  resolveGeminiModel,
} from "@/lib/discovery/explain/llm";
import { evaluateAcceptDemandGate } from "@/lib/discovery/dual-gate";
import { readFileSync } from "fs";
import path from "path";

afterEach(() => {
  clearWhyPickCacheForTests();
  delete process.env.DISCOVERY_POOL_V2;
  delete process.env.DISCOVERY_LIVE_SEARCH;
  delete process.env.GEMINI_API_KEY;
  delete process.env.DISCOVERY_EXPLAIN_GEMINI_API_KEY;
  delete process.env.DISCOVERY_GEMINI_MODEL;
  delete process.env.DISCOVERY_WHY_PICK;
  delete process.env.DISCOVERY_EXPLAIN_API_KEY;
  delete process.env.OPENAI_API_KEY;
});

function lockedEstimateBody(input: {
  name: string;
  fitScore: number;
  reason: string;
  mitigation: string;
}): string {
  return (
    `${input.name}'s opportunity is still a hypothesis because no citable live-search evidence is saved, so this explanation does not claim foreign traction, local demand, seller counts, or a proven market opening. ` +
    `Fit ${input.fitScore}/100 and planning margins that clear the 70%/35% targets explain why the product passed the founder's operational, budget, and economics checks for the accept-ready shortlist. ` +
    "The practical way to seek an advantage is to test the curated heat-safe storage-stand angle as a specific customer offer, while treating that catalog guidance as a test idea rather than proof of market demand. " +
    `${input.reason} ` +
    `${input.mitigation}`
  );
}

describe("Why we suggested this — grounding", () => {
  it("Fit/margin-only when market cite disallowed — no fake US/Lebanon gap", () => {
    const result = buildDeterministicWhyPick({
      productName: "LED Wand",
      fitScore: 78,
      strength: "Strong",
      softMarginBand: "pass",
      canCiteMarketSignals: false,
      demandPath: "whitespace",
      competitionLevel: "low",
      evidenceSource: "neutral",
    });
    expect(result.marketSignalsOmitted).toBe(true);
    expect(result.body.toLowerCase()).not.toMatch(
      /abroad traction|lebanon gap|whitespace|us traction/,
    );
    expect(result.body).toContain("78");
    expect(assertNoUngroundedMarketClaims(result.body, false)).toBe(true);
  });

  it("heuristic evidence never enables market specifics", () => {
    expect(
      canCiteMarketFromPayload({
        canCiteMarketSignals: true,
        evidenceSource: "heuristic_seed",
        demandPath: "whitespace",
        competitionLevel: "medium",
      }),
    ).toBe(false);

    const result = buildDeterministicWhyPick({
      productName: "Widget Pro",
      category: "home",
      fitScore: 70,
      strength: "Okay",
      softMarginBand: "soft_ok",
      marginBefore: 0.68,
      marginAfter: 0.32,
      canCiteMarketSignals: true,
      demandPath: "whitespace",
      competitionLevel: "medium",
      budgetFightMultiplier: 0.82,
      evidenceSource: "heuristic_seed",
    });
    expect(result.marketSignalsOmitted).toBe(true);
    expect(result.body).toContain("Widget Pro");
    expect(result.body.toLowerCase()).not.toMatch(/abroad|lebanon|sellers/);
    expect(result.body).toContain("70");
    expect(result.body.toLowerCase()).not.toMatch(
      /people in lebanon already seem to look|it does well abroad while lebanon still looks less crowded/,
    );
    expect(containsFounderJargon(result.body)).toBe(false);
    expect(assertFounderFriendlyCopy(result.body)).toBe(true);
    expect(result.body.length).toBeLessThanOrEqual(SUGGESTION_BODY_MAX_CHARS);
    expect(containsVagueFluff(result.body)).toBe(false);
  });

  it("score-cache-only local_proven stays estimate-only", () => {
    const result = buildDeterministicWhyPick({
      productName: "Local Hit Wand",
      category: "beauty",
      fitScore: 82,
      strength: "Strong",
      softMarginBand: "pass",
      marginBefore: 0.74,
      marginAfter: 0.39,
      canCiteMarketSignals: true,
      demandPath: "local_proven",
      competitionLevel: "low",
      evidenceSource: "score_cache",
    });
    expect(result.body).toContain("Local Hit Wand");
    expect(result.marketSignalsOmitted).toBe(true);
    expect(result.body.toLowerCase()).not.toMatch(/lebanon|shoppers|interest/);
    expect(result.body.toLowerCase()).not.toMatch(
      /demand path|local_proven|whitespace|heuristic|skill payload|people in lebanon already seem to look/,
    );
  });

  it("score_cache without live facts cannot cite market specifics", () => {
    expect(
      canCiteMarketFromPayload({
        canCiteMarketSignals: false,
        evidenceSource: "score_cache",
        demandPath: "local_proven",
        competitionLevel: "low",
      }),
    ).toBe(false);
  });

  it("skillPayloadFromCandidateMeta keeps heuristic market facts non-citable", () => {
    const payload = skillPayloadFromCandidateMeta({
      productName: "X",
      fitScore: 60,
      strength: "Okay",
      fitBreakdownJson: JSON.stringify({
        catalogKey: "x",
        wave2: {
          okayReason: "low_evidence_confidence",
          explain: {
            softMarginBand: "pass",
            demandPath: "whitespace",
            competitionLevel: "high",
            budgetFightMultiplier: 0.7,
            evidenceSource: "score_cache",
          },
        },
      }),
      scoreEvidenceSource: "heuristic_seed",
      curatedDifferentiation: "Bundle it with a storage stand.",
    });
    expect(payload.evidenceSource).toBe("heuristic_seed");
    expect(payload.okayReason).toBe("low_evidence_confidence");
    expect(payload.canCiteMarketSignals).toBe(false);
    expect(payload.marketEvidence).toBeNull();
    expect(payload.curatedDifferentiation).toBe(
      "Bundle it with a storage stand.",
    );
    expect(payload.demandPath).toBe("whitespace");
    expect(payload.competitionLevel).toBe("high");
    expect(payload.budgetFightMultiplier).toBe(0.7);
  });

  it("enriches from scoreCache when fitBreakdown is thin", () => {
    const payload = skillPayloadFromCandidateMeta({
      productName: "Y",
      fitScore: 80,
      strength: "Strong",
      fitBreakdownJson: JSON.stringify({
        catalogKey: "y",
        wave2: {
          explain: {
            softMarginBand: "pass",
            evidenceSource: "neutral",
          },
        },
      }),
      scoreEvidenceSource: "heuristic_seed",
      scoreCache: {
        demandPath: "local_proven",
        competitionScore: 0.2,
        budgetFightPenalty: 0.15,
      },
    });
    expect(payload.demandPath).toBe("local_proven");
    expect(payload.competitionLevel).toBe("low");
    expect(payload.canCiteMarketSignals).toBe(false);
    expect(payload.evidenceSource).toBe("heuristic_seed");
    expect(payload.okayReason).toBeNull();
  });

  it("live_search enables market cite only with bounded facts", () => {
    const payload = skillPayloadFromCandidateMeta({
      productName: "Y",
      fitScore: 80,
      strength: "Strong",
      fitBreakdownJson: JSON.stringify({
        wave2: {
          explain: {
            softMarginBand: "pass",
            demandPath: "local_proven",
            competitionLevel: "low",
            evidenceSource: "score_cache",
          },
        },
      }),
      scoreEvidenceSource: "live_search",
      scoreEvidence: {
        abroad: {
          count: 2,
          results: [
            {
              domain: "amazon.com",
              title: "Amazon bestseller",
              seller: null,
            },
          ],
        },
        lebanon: {
          count: 1,
          results: [
            {
              domain: "ishtari.com",
              title: "Local listing",
              seller: "Ishtari",
            },
          ],
        },
        localCompetition: null,
        tier1Found: ["Ishtari"],
      },
    });
    expect(payload.canCiteMarketSignals).toBe(true);
    expect(payload.evidenceSource).toBe("live_search");
    expect(payload.marketEvidence?.abroad?.count).toBe(2);
    expect(payload.marketEvidence?.tier1Found).toEqual(["Ishtari"]);
  });

  it("live_search with missing evidence keeps all new fields null", () => {
    const payload = skillPayloadFromCandidateMeta({
      productName: "Z",
      fitScore: 70,
      strength: "Okay",
      fitBreakdownJson: "{}",
      scoreEvidenceSource: "live_search",
      scoreEvidence: null,
      curatedDifferentiation: null,
    });
    expect(payload.canCiteMarketSignals).toBe(false);
    expect(payload.marketEvidence).toBeNull();
    expect(payload.curatedDifferentiation).toBeNull();
  });

  it("allows only live-backed counts, domains, and Tier-1 names", () => {
    const payload = skillPayloadFromCandidateMeta({
      productName: "Z",
      fitScore: 70,
      strength: "Okay",
      fitBreakdownJson: "{}",
      scoreEvidenceSource: "live_search",
      scoreEvidence: {
        abroad: {
          count: 3,
          results: [
            { domain: "amazon.com", title: "Three listings", seller: null },
          ],
        },
        lebanon: null,
        localCompetition: null,
        tier1Found: ["Ishtari"],
      },
    });
    expect(
      assertNoUngroundedMarketClaims(
        "Z appeared in 3 results on amazon.com, and Ishtari is a local competitor.",
        payload,
      ),
    ).toBe(true);
    expect(
      assertNoUngroundedMarketClaims(
        "Z appeared in 7 results on walmart.com, and EGLOW is a competitor.",
        payload,
      ),
    ).toBe(false);
  });

  it("rejects heuristic market specifics even when score fields exist", () => {
    const payload = skillPayloadFromCandidateMeta({
      productName: "H",
      fitScore: 70,
      strength: "Okay",
      fitBreakdownJson: "{}",
      scoreEvidenceSource: "heuristic_seed",
      scoreCache: {
        demandPath: "whitespace",
        competitionScore: 0.8,
      },
    });
    expect(
      assertNoUngroundedMarketClaims(
        "H has abroad traction on amazon.com and faces Ishtari.",
        payload,
      ),
    ).toBe(false);
  });

  it("length cap truncates long bodies on sentence boundary", () => {
    const long =
      "Sentence one is dense enough here. Sentence two also carries a concrete reason for the founder. " +
      "Sentence three adds Fit and margins clearly. ".repeat(20);
    const capped = clampSuggestionBody(long, 200);
    expect(capped.length).toBeLessThanOrEqual(200);
    expect(capped.endsWith(".") || capped.endsWith("…")).toBe(true);
  });

  it("rejects incomplete stubs and mid-sentence cuts", () => {
    expect(
      isCompleteSuggestionBody("People in Lebanon already seem to look"),
    ).toBe(false);
    expect(
      finalizeSuggestionBody("People in Lebanon already seem to look"),
    ).toBeNull();
    expect(
      isCompleteSuggestionBody(
        "People in Lebanon already seem to look for this kind of product that",
      ),
    ).toBe(false);
    expect(
      finalizeSuggestionBody(
        lockedEstimateBody({
          name: "Silicone spatula set",
          fitScore: 78,
          reason:
            "The remaining uncertainty is whether customers will pay for that angle at the planned price, because the estimate cannot establish real conversion or acquisition cost.",
          mitigation:
            "Use one small sample and a modest ads budget to measure paid orders, refuse to scale from the estimate alone, and accept only if you can complete that validation; otherwise skip it.",
        }),
        "Silicone spatula set",
      ),
    ).toBeTruthy();
  });

  it("requires the product name at least once, tolerating one repeat", () => {
    const once = lockedEstimateBody({
      name: "Widget",
      fitScore: 78,
      reason:
        "The remaining uncertainty is whether customers will pay for that angle at the planned price, because the estimate cannot establish real conversion or acquisition cost.",
      mitigation:
        "Use one small sample and a modest ads budget to measure paid orders, refuse to scale from the estimate alone, and accept only if you can complete that validation; otherwise skip it.",
    });
    expect(
      finalizeSuggestionBody(once, "Widget"),
    ).toBeTruthy();
    expect(
      finalizeSuggestionBody(
        once.replace("Fit 78/100", "Widget shows Fit 78/100"),
        "Widget",
      ),
    ).toBeTruthy();
    expect(
      finalizeSuggestionBody(
        once.replace("Widget's opportunity", "This item's opportunity"),
        "Widget",
      ),
    ).toBeNull();
  });

  it("treats a numeric Fit reading as reporting, not fluff", () => {
    expect(
      containsVagueFluff(
        "Adjustable laptop stand has a strong fit score of 100/100, with planning margins around 58% before ads.",
      ),
    ).toBe(false);
    expect(
      containsVagueFluff("Reusable produce bags have a strong fit at 100/100."),
    ).toBe(false);
    expect(
      containsVagueFluff("This product could be a good fit for your store."),
    ).toBe(true);
    expect(containsVagueFluff("This product looks promising for your store.")).toBe(
      true,
    );
  });

  it("accepts a complete 4-sentence paragraph", () => {
    const four =
      "Widget's opportunity remains an estimate because no citable live-search evidence is saved, so this thesis does not claim foreign traction, local demand, seller counts, or a proven opening and instead identifies a hypothesis that still needs paid validation. " +
      "Fit 78/100 and planning margins around 72% before ads and 38% after ads explain why the product cleared the founder's operational, budget, workload, and economics checks without turning this explanation into a new score or recommendation decision. " +
      "Test the curated storage-stand angle in one small sample with a modest ads budget, presenting it as a specific customer benefit and measuring actual conversion, acquisition cost, quality feedback, and price acceptance rather than assuming the catalog angle already wins. " +
      "Hold a wider order until the sample sells through at that price and the paid results support the planned economics, then accept only if you can complete that controlled validation without stretching the budget; otherwise skip the product and preserve the cash.";
    const body = finalizeSuggestionBody(four, "Widget");
    expect(body).toBeTruthy();
    expect(isCompleteSuggestionBody(body!)).toBe(true);
    expect(body!.length).toBeGreaterThanOrEqual(SUGGESTION_BODY_MIN_CHARS);
    expect(body).toContain("Hold a wider order");
  });

  it("accepts a longer 4–6 sentence body while rejecting a truncated ending", () => {
    const shortButComplete =
      "Widget has an estimate-only market read for now. Fit 100/100 clears the operational profile. Planning margins clear the hard accept targets. Test one sample before placing a larger order.";
    expect(isCompleteSuggestionBody(shortButComplete)).toBe(false);

    const longer =
      "Widget's market read is an estimate because no citable live evidence is saved yet, so the demand side still needs real validation before any larger commitment. " +
      "Fit 100/100 and planning margins around 72 percent before ads and 38 percent after explain why this product cleared the operational and margin checks for the shortlist. " +
      "The Okay recommendation reflects low-confidence market evidence rather than moderate Fit, which means the uncertainty belongs to demand validation and not to the founder profile. " +
      "Test the curated heat-safe storage-stand angle with one small sample and a modest ads budget, then compare actual paid orders with the planned acquisition cost before adding inventory. " +
      "Do not scale from the estimate alone, and accept to sample only if you can complete that validation; otherwise skip the product and preserve the budget.";
    expect(longer.length).toBeGreaterThan(500);
    expect(isCompleteSuggestionBody(longer)).toBe(true);
    expect(isCompleteSuggestionBody(`${longer} This ending is cut off`)).toBe(
      false,
    );
  });
});

describe("Gemini narrator (mocked)", () => {
  const safeLong = lockedEstimateBody({
    name: "Safe",
    fitScore: 70,
    reason:
      "The Okay recommendation reflects a real operational Fit constraint in budget, time, or workload, so the uncertainty is the founder's ability to run the test without overextending those limits.",
    mitigation:
      "Keep the first sample small enough to protect the named budget and schedule, and accept only if you can absorb that constraint through the full test; otherwise skip it and preserve capacity.",
  });
  const widgetEstimateLong = lockedEstimateBody({
    name: "Widget",
    fitScore: 78,
    reason:
      "The remaining uncertainty is whether customers will pay for that angle at the planned price, because the estimate cannot establish real conversion or acquisition cost.",
    mitigation:
      "Use one small sample and a modest ads budget to measure paid orders, refuse to scale from the estimate alone, and accept only if you can complete that validation; otherwise skip it.",
  });
  const widgetLiveLong =
    "Widget appeared in 4 saved abroad results including amazon.com compared with 1 saved Lebanon result, while Ishtari appeared as a local competitor, creating a concrete test thesis but also confirming that the founder must fight for attention. Fit 78/100 and planning margins around 72 percent before ads and 38 percent after ads explain why the product cleared the founder's operational, budget, workload, and economics checks for the shortlist. The practical way to compete is the curated heat-safe storage-stand angle, presented as a specific customer benefit that can differentiate the offer instead of relying on a generic product listing. The key uncertainty is whether that distinct offer can convert efficiently against the observed competition, so keep the first ads budget controlled and measure paid orders and acquisition cost before adding inventory. Accept to order one small sample only if you can run that differentiated test and hold a wider order until the results support it; otherwise skip it.";

  const fitOnlyPayload = {
    productName: "Safe",
    fitScore: 70,
    strength: "Okay" as const,
    softMarginBand: "pass" as const,
    canCiteMarketSignals: false,
    evidenceSource: "neutral" as const,
  };

  const heuristicPayload = {
    productName: "Widget",
    category: "home",
    fitScore: 78,
    strength: "Strong" as const,
    softMarginBand: "pass" as const,
    marginBefore: 0.72,
    marginAfter: 0.38,
    canCiteMarketSignals: true,
    demandPath: "whitespace" as const,
    competitionLevel: "medium" as const,
    budgetFightMultiplier: 0.82,
    evidenceSource: "heuristic_seed" as const,
    curatedDifferentiation: "Bundle it with a heat-safe storage stand.",
    marketEvidence: null,
  };

  const livePayload = {
    ...heuristicPayload,
    evidenceSource: "live_search" as const,
    marketEvidence: {
      abroad: {
        count: 4,
        results: [
          {
            domain: "amazon.com",
            title: "Amazon bestseller",
            seller: null,
          },
        ],
      },
      lebanon: {
        count: 1,
        results: [
          {
            domain: "ishtari.com",
            title: "Ishtari local listing",
            seller: "Ishtari",
          },
        ],
      },
      localCompetition: null,
      tier1Found: ["Ishtari"],
    },
  };
  const responseWith = (text: string): typeof fetch => async () =>
    new Response(
      JSON.stringify({
        candidates: [{ content: { parts: [{ text }] } }],
      }),
      { status: 200 },
    );

  it("fail-closed missing key", async () => {
    const r = await narrateSuggestionWithGemini(fitOnlyPayload, "en", {
      apiKey: "",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("missing_key");
  });

  it("rejects ungrounded market claims when cite disallowed", async () => {
    const fetchFn: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: "Great US traction and Lebanon gap with Ishtari competition.",
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      );
    const r = await narrateSuggestionWithGemini(fitOnlyPayload, "en", {
      apiKey: "test",
      fetchFn,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("ungrounded");
  });

  it("accepts grounded Fit-only narration", async () => {
    const fetchFn: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: safeLong,
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      );
    const r = await narrateSuggestionWithGemini(fitOnlyPayload, "en", {
      apiKey: "test",
      fetchFn,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.result.source).toBe("llm");
      expect(r.result.titleKey).toBe("whySuggestedTitle");
      expect(r.result.body).toContain("70");
      expect(r.result.body).toContain("Safe");
      expect(r.result.body.length).toBeLessThanOrEqual(SUGGESTION_BODY_MAX_CHARS);
    }
  });

  it("accepts an estimate-mode paragraph end to end", async () => {
    const fetchFn: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: safeLong,
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      );
    const r = await narrateSuggestionWithGemini(fitOnlyPayload, "en", {
      apiKey: "test",
      fetchFn,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.result.honestyKey).toBe("whySuggestedHonestyEstimate");
      expect(r.result.marketSignalsOmitted).toBe(true);
      expect(r.result.body).toContain("Safe");
    }
  });

  it("Fit 100 + low confidence keeps the real reason and sample mitigation", async () => {
    const body = lockedEstimateBody({
      name: "Widget",
      fitScore: 100,
      reason:
        "The Okay recommendation reflects low-confidence market evidence rather than moderate Fit, so the uncertainty is real demand validation and not the founder's operational ability.",
      mitigation:
        "Test one small sample with modest ads, measure actual paid orders, do not scale on the estimate alone, and accept only if you can complete that validation; otherwise skip it.",
    });
    const r = await narrateSuggestionWithGemini(
      {
        ...heuristicPayload,
        fitScore: 100,
        strength: "Okay",
        okayReason: "low_evidence_confidence",
      },
      "en",
      { apiKey: "test", fetchFn: responseWith(body) },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.result.body).toMatch(/estimate|low-confidence/i);
      expect(r.result.body).toMatch(/small sample|do not scale/i);
      expect(r.result.body).not.toMatch(/Fit is moderate/i);
    }
  });

  it("accepts Arabic low-confidence thesis with the same mitigation", async () => {
    const body =
      "فرصة «أداة مطبخ» ما زالت فرضية قابلة للاختبار لأن أدلة بحث حي قابلة للاستشهاد غير محفوظة، لذلك لا يدّعي هذا الشرح وجود طلب خارجي أو محلي مثبت ولا أعداد بائعين أو فجوة سوق مؤكدة قبل جمع نتائج فعلية. " +
      "درجة الملاءمة التشغيلية هي 100/100، وهوامش التخطيط التي تتجاوز هدفي ٧٠٪ قبل الإعلانات و٣٥٪ بعدها تشرح لماذا اجتاز المنتج فحوص القدرة والميزانية والاقتصاد للقائمة الجاهزة للقبول. " +
      "طريقة السعي إلى ميزة هي اختبار زاوية العرض المنسّقة التي تجمع الاستخدام الآمن مع التخزين الواضح كفائدة محددة للعميل، مع اعتبارها فكرة اختبار لا دليلاً على أن السوق يطلبها حالياً. " +
      "التوصية مقبولة بسبب قراءة سوق تقديرية ومنخفضة الثقة، وليس لأن الملاءمة متوسطة، ولذلك يتمثل عدم اليقين الحقيقي في إثبات الطلب المدفوع وتكلفة اكتساب العميل لا في قدرة المؤسس التشغيلية. " +
      "اختبر عيّنة صغيرة بإعلانات محدودة، وقِس الطلبات المدفوعة ولا تتوسّع اعتماداً على التقدير وحده، ثم اقبل العيّنة فقط إن كنت ستكمل هذا التحقق قبل طلب أكبر؛ وإلا فتخطَّ المنتج واحمِ الميزانية.";
    expect(body.length).toBeGreaterThanOrEqual(SUGGESTION_BODY_MIN_CHARS);
    const r = await narrateSuggestionWithGemini(
      {
        ...heuristicPayload,
        productName: "أداة مطبخ",
        fitScore: 100,
        strength: "Okay",
        okayReason: "low_evidence_confidence",
      },
      "ar",
      { apiKey: "test", fetchFn: responseWith(body) },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.result.body).toContain("100/100");
      expect(r.result.body).toMatch(/تقدير|منخفضة الثقة/u);
      expect(r.result.body).toMatch(/عيّنة|لا تتوسّع/u);
    }
  });

  it("high competition requires differentiation or ads mitigation", async () => {
    const body = lockedEstimateBody({
      name: "Widget",
      fitScore: 100,
      reason:
        "The Okay recommendation reflects estimated high competition rather than moderate Fit, so the uncertainty is whether a specific offer can win attention and convert efficiently.",
      mitigation:
        "Use the curated angle to differentiate the offer, keep the first ads budget controlled, and accept one small sample only if you can run that competitive test; otherwise skip it.",
    });
    const r = await narrateSuggestionWithGemini(
      {
        ...heuristicPayload,
        fitScore: 100,
        strength: "Okay",
        okayReason: "high_competition",
      },
      "en",
      { apiKey: "test", fetchFn: responseWith(body) },
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.result.body).toMatch(/differentiate|ads budget/i);
  });

  it("genuine Fit risk requires a matching operational mitigation", async () => {
    const r = await narrateSuggestionWithGemini(
      { ...fitOnlyPayload, okayReason: "fit_risk" },
      "en",
      { apiKey: "test", fetchFn: responseWith(safeLong) },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.result.body).toMatch(/operational Fit constraint/i);
      expect(r.result.body).toMatch(/budget|schedule|skip/i);
    }
  });

  it("Strong recommendation has no Okay scare sentence", async () => {
    const r = await narrateSuggestionWithGemini(heuristicPayload, "en", {
      apiKey: "test",
      fetchFn: responseWith(widgetEstimateLong),
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.result.body).not.toMatch(/Okay recommendation|marked Okay/i);
  });

  it("accepts a numeric strong-fit reading that used to read as fluff", async () => {
    const fetchFn: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: safeLong,
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      );
    const r = await narrateSuggestionWithGemini(fitOnlyPayload, "en", {
      apiKey: "test",
      fetchFn,
    });
    expect(r.ok).toBe(true);
  });

  it("surfaces api_error separately when Gemini responds non-200", async () => {
    const fetchFn: typeof fetch = async () =>
      new Response("quota exceeded", { status: 429 });
    const r = await narrateSuggestionWithGemini(fitOnlyPayload, "en", {
      apiKey: "test",
      fetchFn,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("api_error");
  });

  it("rejects stock Lebanon template lines", async () => {
    const fetchFn: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: "People in Lebanon already seem to look for this kind of product. You'll face some local sellers, so plan a modest ads budget. Fit score 78/100 matches your budget and time.",
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      );
    const r = await narrateSuggestionWithGemini(livePayload, "en", {
      apiKey: "test",
      fetchFn,
    });
    expect(r.ok).toBe(false);
  });

  it("rejects engineer jargon from Gemini even when market cite allowed", async () => {
    const fetchFn: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: "Demand path is whitespace with heuristic skill payloads. Second sentence about Fit score 78 for your budget and capacity.",
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      );
    const r = await narrateSuggestionWithGemini(livePayload, "en", {
      apiKey: "test",
      fetchFn,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(["empty", "ungrounded"]).toContain(r.error);
  });

  it("rejects truncated mid-sentence Gemini stubs", async () => {
    const fetchFn: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: "People in Lebanon already seem to look" }],
              },
            },
          ],
        }),
        { status: 200 },
      );
    const r = await narrateSuggestionWithGemini(heuristicPayload, "en", {
      apiKey: "test",
      fetchFn,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("incomplete");
  });

  it("passes estimate-only facts to Gemini when LIVE_SEARCH off", async () => {
    process.env.DISCOVERY_LIVE_SEARCH = "0";
    let requestBody = "";
    const fetchFn: typeof fetch = async (_url, init) => {
      requestBody = String(init?.body ?? "");
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: widgetEstimateLong,
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      );
    };
    const r = await narrateSuggestionWithGemini(heuristicPayload, "en", {
      apiKey: "test",
      fetchFn,
    });
    expect(r.ok).toBe(true);
    const parsed = JSON.parse(requestBody) as {
      contents: { parts: { text: string }[] }[];
    };
    const facts = JSON.parse(parsed.contents[0].parts[0].text) as {
      productName: string;
      demandPath: string | null;
      competitionLevel: string | null;
      marginBeforePct: number;
      category: string;
      marketRead: string;
      honestyPath: string;
      okayReason: string | null;
      marketEvidence: unknown;
    };
    expect(facts.productName).toBe("Widget");
    expect(facts.category).toBe("home");
    expect(facts.demandPath).toBeNull();
    expect(facts.competitionLevel).toBeNull();
    expect(facts.marketRead).toBe("estimate_only");
    expect(facts.honestyPath).toBe("estimate_only");
    expect(facts.okayReason).toBeNull();
    expect(facts.marketEvidence).toBeNull();
    expect(facts.marginBeforePct).toBe(72);
    if (r.ok) {
      expect(r.result.body).toContain("Widget");
      expect(r.result.body.length).toBeLessThanOrEqual(SUGGESTION_BODY_MAX_CHARS);
      expect(assertFounderFriendlyCopy(r.result.body)).toBe(true);
    }
  });

  it("passes bounded live facts and accepts backed counts/names", async () => {
    let requestBody = "";
    const fetchFn: typeof fetch = async (_url, init) => {
      requestBody = String(init?.body ?? "");
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: widgetLiveLong,
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      );
    };
    const r = await narrateSuggestionWithGemini(livePayload, "en", {
      apiKey: "test",
      fetchFn,
    });
    expect(r.ok).toBe(true);
    const parsed = JSON.parse(requestBody) as {
      contents: { parts: { text: string }[] }[];
    };
    const facts = JSON.parse(parsed.contents[0].parts[0].text) as {
      marketRead: string;
      marketEvidence: {
        abroad: { count: number };
        tier1Found: string[];
      };
      curatedDifferentiation: string;
    };
    expect(facts.marketRead).toBe("live_evidence");
    expect(facts.marketEvidence.abroad.count).toBe(4);
    expect(facts.marketEvidence.tier1Found).toEqual(["Ishtari"]);
    expect(facts.curatedDifferentiation).toContain("heat-safe");
    if (r.ok) {
      expect(r.result.honestyKey).toBe("whySuggestedHonestyLive");
      expect(r.result.marketSignalsOmitted).toBe(false);
    }
  });

  it("clamps oversized Gemini output", async () => {
    const essay = `${widgetEstimateLong} This seventh sentence must be dropped by the six-sentence cap. Another trailing sentence should also be dropped.`;
    const fetchFn: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: essay }] } }],
        }),
        { status: 200 },
      );
    const r = await narrateSuggestionWithGemini(heuristicPayload, "en", {
      apiKey: "test",
      fetchFn,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.result.body.length).toBeLessThanOrEqual(SUGGESTION_BODY_MAX_CHARS);
      expect(isCompleteSuggestionBody(r.result.body)).toBe(true);
      expect(r.result.body).toContain("Widget");
    }
  });

  it("api failure fail-closed (no template product body)", async () => {
    const fetchFn: typeof fetch = async () =>
      new Response("nope", { status: 500 });
    const r = await narrateSuggestionWithGemini(fitOnlyPayload, "en", {
      apiKey: "test",
      fetchFn,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("api_error");
  });

  it("default model is gemini-2.5-flash (not retired 2.0)", () => {
    expect(DEFAULT_GEMINI_MODEL).toBe("gemini-2.5-flash");
    expect(resolveGeminiModel({})).toBe("gemini-2.5-flash");
    expect(
      resolveGeminiModel({ DISCOVERY_GEMINI_MODEL: "gemini-2.5-pro" }),
    ).toBe("gemini-2.5-pro");
  });

  it("generateContent URL uses default model (mock 200)", async () => {
    let calledUrl = "";
    const fetchFn: typeof fetch = async (input) => {
      calledUrl = String(input);
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: safeLong,
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      );
    };
    const r = await narrateSuggestionWithGemini(fitOnlyPayload, "en", {
      apiKey: "test",
      fetchFn,
    });
    expect(r.ok).toBe(true);
    expect(calledUrl).toContain("/models/gemini-2.5-flash:generateContent");
    expect(calledUrl).not.toContain("gemini-2.0-flash");
  });
});

describe("explain does not change accept gates", () => {
  it("narration helpers do not mutate accept outcomes", () => {
    const before = evaluateAcceptDemandGate({
      system: {
        abroadDemandScore: 0.8,
        lebanonDemandScore: 0.2,
        lastScoreStatus: "ok",
      },
      systemGateEnabled: true,
    });
    buildDeterministicWhyPick({
      productName: "Z",
      fitScore: 90,
      strength: "Strong",
      softMarginBand: "pass",
      canCiteMarketSignals: false,
    });
    const after = evaluateAcceptDemandGate({
      system: {
        abroadDemandScore: 0.8,
        lebanonDemandScore: 0.2,
        lastScoreStatus: "ok",
      },
      systemGateEnabled: true,
    });
    expect(after).toEqual(before);
    expect(after.ok).toBe(true);
  });

  it("explain service is read-only vs acceptProduct / score writers", () => {
    const root = path.join(process.cwd(), "src/lib/discovery/explain");
    for (const file of ["service.ts", "why-pick.ts", "llm.ts", "cache.ts"]) {
      const src = readFileSync(path.join(root, file), "utf8");
      expect(src).not.toContain("acceptProduct");
      expect(src).not.toContain("applySuccessfulScoreRefresh");
      expect(src).not.toContain("update(schema.productCandidates)");
    }
  });
});

describe("cache + rate limit + Gemini flags", () => {
  it("caches per session/candidate/locale with version bust", () => {
    const key = whyPickCacheKey("s1", "c1", "en");
    expect(key).toContain(WHY_PICK_CACHE_VERSION);
    expect(WHY_PICK_CACHE_VERSION).toMatch(/^v8-/);
    const value = buildDeterministicWhyPick({
      productName: "A",
      fitScore: 50,
      strength: "Okay",
      canCiteMarketSignals: false,
    });
    setCachedWhyPick(key, value);
    expect(getCachedWhyPick(key)?.body).toBe(value.body);
  });

  it("marks incomplete cache entries as non-displayable", () => {
    clearWhyPickCacheForTests();
    const key = whyPickCacheKey("s1", "c1", "en");
    setCachedWhyPick(key, {
      titleKey: "whySuggestedTitle",
      body: "People in Lebanon already seem to look for this kind of product that",
      honestyKey: "whySuggestedHonesty",
      source: "llm",
      marketSignalsOmitted: true,
    });
    const hit = getCachedWhyPick(key);
    expect(hit).toBeTruthy();
    expect(isCompleteSuggestionBody(hit!.body)).toBe(false);
  });

  it("rate-limits spam after WHY_PICK_RATE_LIMIT hits", () => {
    for (let i = 0; i < WHY_PICK_RATE_LIMIT; i++) {
      expect(checkWhyPickRateLimit("ws").allowed).toBe(true);
      recordWhyPickRateHit("ws");
    }
    expect(checkWhyPickRateLimit("ws").allowed).toBe(false);
  });

  it("suggestion explain follows POOL_V2; Gemini key required", () => {
    expect(isSuggestionExplainEnabled()).toBe(false);
    expect(isGeminiConfigured()).toBe(false);
    process.env.DISCOVERY_POOL_V2 = "1";
    expect(isSuggestionExplainEnabled()).toBe(true);
    expect(resolveGeminiApiKey({})).toBeUndefined();
    expect(resolveGeminiApiKey({ GEMINI_API_KEY: "g" })).toBe("g");
    expect(
      resolveGeminiApiKey({ DISCOVERY_EXPLAIN_GEMINI_API_KEY: "d" }),
    ).toBe("d");
    expect(
      resolveGeminiApiKey({
        DISCOVERY_EXPLAIN_GEMINI_API_KEY: "d",
        GEMINI_API_KEY: "g",
      }),
    ).toBe("d");
  });
});

describe("no paste fields in Discovery UI", () => {
  it("DiscoveryBoard has no paste confirm form fields", () => {
    const src = readFileSync(
      path.join(process.cwd(), "src/components/discovery/DiscoveryBoard.tsx"),
      "utf8",
    );
    expect(src).not.toContain("confirmDemand");
    expect(src).not.toContain("demandUrl");
    expect(src).not.toContain("screenshotNote");
    expect(src).not.toContain("dualGatePaste");
    expect(src).not.toContain("needs_demand");
    expect(src).toContain("whySuggested");
    expect(src).toContain("whySuggestedMissingKey");
    expect(src).toContain("WHY_PICK_CACHE_VERSION");
    expect(src).toContain("isCompleteSuggestionBody");
  });

  it("actions and service no longer expose confirmDemand", () => {
    const actions = readFileSync(
      path.join(process.cwd(), "src/actions/discovery.ts"),
      "utf8",
    );
    const service = readFileSync(
      path.join(process.cwd(), "src/lib/discovery/service.ts"),
      "utf8",
    );
    expect(actions).not.toContain("confirmDemand");
    expect(service).not.toContain("confirmDemand");
    expect(service).not.toContain("curatedDemandProvider");
  });

  it("DiscoveryBoard opens modal (not cramped inline) for Why we suggested", () => {
    const src = readFileSync(
      path.join(process.cwd(), "src/components/discovery/DiscoveryBoard.tsx"),
      "utf8",
    );
    expect(src).toContain("WhySuggestedModal");
    expect(src).toContain('role="dialog"');
    expect(src).toContain("createPortal");
    expect(src).toContain("Escape");
    expect(src).toContain("whySuggestedHonesty");
    expect(src).not.toContain("line-clamp");
  });

  it("accept action path has no needs_demand", () => {
    const src = readFileSync(
      path.join(process.cwd(), "src/lib/discovery/service.ts"),
      "utf8",
    );
    expect(src).toContain("evaluateAcceptDemandGate");
    expect(src).not.toMatch(/error:\s*"needs_demand"/);
    expect(src).not.toContain("pasteConfirmed");
  });
});
