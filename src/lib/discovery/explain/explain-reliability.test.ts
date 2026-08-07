/**
 * WAVE-2 §6.1 — explain reliability + single-source Okay reason (Debug E).
 * Guards that valid Gemini output is not rejected by our own validators, that
 * the card note and the narrated paragraph state ONE typed reason from ONE
 * source, and that each failure kind reaches the founder as its own copy.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { narrateSuggestionWithGemini } from "@/lib/discovery/explain/llm";
import {
  assertNoOkayScareWhenStrong,
  countProductNameMentions,
  finalizeSuggestionBody,
  isCompleteSuggestionBody,
  packSuggestionSentences,
  skillPayloadFromCandidateMeta,
  splitSuggestionSentences,
  SUGGESTION_BODY_MAX_CHARS,
  SUGGESTION_BODY_MIN_CHARS,
  type WhyPickSkillPayload,
} from "@/lib/discovery/explain/why-pick";
import { resolveOkayReasonForDisplay } from "@/lib/discovery/okay-reason";

const estimatePayload: WhyPickSkillPayload = {
  productName: "Widget",
  fitScore: 78,
  strength: "Okay",
  okayReason: "low_evidence_confidence",
  softMarginBand: "pass",
  canCiteMarketSignals: false,
  evidenceSource: "heuristic_seed",
  marketEvidence: null,
};

/** Six complete estimate-mode sentences inside the locked length window. */
const SIX_SENTENCE_ESTIMATE_BODY = [
  "Widget's opportunity is still a hypothesis because no citable live-search evidence is saved, so this explanation does not claim foreign traction, local demand, or seller counts.",
  "Fit 78/100 and planning margins that clear the 70%/35% targets explain why the product passed the founder's operational, budget, and economics checks for the shortlist.",
  "The practical way to seek an advantage is the curated heat-safe storage-stand angle, presented as a specific customer offer rather than a generic product listing.",
  "The Okay recommendation reflects low-confidence market evidence rather than moderate Fit, so the real uncertainty is paid demand and not the founder's own ability.",
  "Test one small sample with a modest ads budget, measure actual paid orders, and refuse to scale from the estimate alone.",
  "Accept only if you can complete that validation before a wider order; otherwise skip it and preserve the budget.",
].join(" ");

function responseWith(text: string): typeof fetch {
  return async () =>
    new Response(
      JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }),
      { status: 200 },
    );
}

describe("validators run on the finalized body, not the raw draft", () => {
  it("trims a 7th sentence citing a domain and still passes in estimate mode", async () => {
    const raw = `${SIX_SENTENCE_ESTIMATE_BODY} Similar products list on amazon.com at much higher prices, which is exactly why the offer has to look different.`;
    let calls = 0;
    const fetchFn: typeof fetch = async (url, init) => {
      calls += 1;
      return responseWith(raw)(url, init);
    };

    const r = await narrateSuggestionWithGemini(estimatePayload, "en", {
      apiKey: "test",
      fetchFn,
    });

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.result.body).not.toContain("amazon.com");
      expect(splitSuggestionSentences(r.result.body)).toHaveLength(6);
      expect(isCompleteSuggestionBody(r.result.body)).toBe(true);
    }
    // Valid output on the first try must not burn the retry.
    expect(calls).toBe(1);
  });

  it("keeps whole sentences in the window when the first boundary is early", () => {
    const short = "Widget is a compact kitchen accessory.";
    const long = [
      "Buyers compare this category on price in the U.S. market alone, which is why the curated angle matters far more here than another undifferentiated listing would.",
      "Fit 78/100 and planning margins that clear the 70%/35% targets explain why the product passed the founder's operational, budget, and economics checks for the shortlist.",
      "The remaining uncertainty is whether customers will pay the planned price for that angle, because an estimate cannot establish real conversion or acquisition cost.",
      "Test one small sample with a modest ads budget, measure the paid orders it produces, and refuse to scale from the estimate alone before the numbers are in.",
      "Accept only if you can complete that validation before committing to a wider order; otherwise skip this product and preserve the cash for a clearer opportunity.",
      "This seventh sentence pushes the draft past the character ceiling and has to be dropped whole rather than cut somewhere in the middle of a clause.",
      "An eighth sentence would also be dropped, because the founder paragraph is locked to at most six complete sentences no matter how much the model writes.",
    ];
    const raw = [short, ...long].join(" ");
    expect(raw.length).toBeGreaterThan(SUGGESTION_BODY_MAX_CHARS);

    const body = finalizeSuggestionBody(raw, "Widget");
    expect(body).toBeTruthy();
    expect(body!.length).toBeGreaterThanOrEqual(SUGGESTION_BODY_MIN_CHARS);
    expect(body!.length).toBeLessThanOrEqual(SUGGESTION_BODY_MAX_CHARS);
    // "U.S." must not be treated as a sentence end.
    expect(splitSuggestionSentences(body!).length).toBeGreaterThanOrEqual(4);
    expect(body).not.toMatch(/U\.S\.$/);
  });

  it("packs only whole sentences and reports impossible windows", () => {
    const oneLongSentence = `Widget ${"detail ".repeat(300)}stops here.`;
    expect(packSuggestionSentences(oneLongSentence)).toBeNull();
    expect(packSuggestionSentences(SIX_SENTENCE_ESTIMATE_BODY)).toBe(
      SIX_SENTENCE_ESTIMATE_BODY,
    );
  });

  it("counts product-name mentions on word boundaries", () => {
    const body =
      "Pro clears the shortlist, and a professional buyer comparing products would still expect proof before scaling the offer.";
    expect(countProductNameMentions(body, "Pro")).toBe(1);
    expect(countProductNameMentions(body, "Widget")).toBe(0);
  });
});

describe("exactly one bounded retry", () => {
  it("retries once on a validation failure and accepts the second body", async () => {
    const bodies = [
      "Widget is too short to pass. It stops here.",
      SIX_SENTENCE_ESTIMATE_BODY,
    ];
    const sent: string[] = [];
    const fetchFn: typeof fetch = async (_url, init) => {
      sent.push(String(init?.body ?? ""));
      const text = bodies[Math.min(sent.length - 1, bodies.length - 1)];
      return new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }),
        { status: 200 },
      );
    };

    const r = await narrateSuggestionWithGemini(estimatePayload, "en", {
      apiKey: "test",
      fetchFn,
    });

    expect(r.ok).toBe(true);
    expect(sent).toHaveLength(2);
    // The retry restates length and, in estimate mode, the honesty rule.
    const retry = sent[1];
    expect(retry).toContain("RETRY");
    expect(retry).toContain(String(SUGGESTION_BODY_MIN_CHARS));
    expect(retry).toContain(String(SUGGESTION_BODY_MAX_CHARS));
    expect(retry).toContain("Estimate-only");
    expect(retry).toContain("low_evidence_confidence");
  });

  it("stops after the retry instead of looping", async () => {
    let calls = 0;
    const fetchFn: typeof fetch = async (url, init) => {
      calls += 1;
      return responseWith("Too short. Still too short.")(url, init);
    };
    const r = await narrateSuggestionWithGemini(estimatePayload, "en", {
      apiKey: "test",
      fetchFn,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("incomplete");
    expect(calls).toBe(2);
  });

  it("never retries a missing key or a quota/rate-limit response", async () => {
    let calls = 0;
    const missing = await narrateSuggestionWithGemini(estimatePayload, "en", {
      apiKey: "",
      fetchFn: async (url, init) => {
        calls += 1;
        return responseWith(SIX_SENTENCE_ESTIMATE_BODY)(url, init);
      },
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error).toBe("missing_key");
    expect(calls).toBe(0);

    let quotaCalls = 0;
    const limited = await narrateSuggestionWithGemini(estimatePayload, "en", {
      apiKey: "test",
      fetchFn: async () => {
        quotaCalls += 1;
        return new Response("quota exceeded", { status: 429 });
      },
    });
    expect(limited.ok).toBe(false);
    if (!limited.ok) expect(limited.error).toBe("api_error");
    expect(quotaCalls).toBe(1);
  });
});

describe("Strong never receives Okay scare wording", () => {
  it("guards explicit Okay verdict wording on Strong", () => {
    expect(
      assertNoOkayScareWhenStrong(
        "The Okay recommendation reflects low-confidence evidence rather than moderate Fit.",
        "Strong",
      ),
    ).toBe(false);
    expect(
      assertNoOkayScareWhenStrong(
        "This product is marked Okay because competition is high.",
        "Strong",
      ),
    ).toBe(false);
    // Ordinary caution is still allowed on a Strong recommendation.
    expect(
      assertNoOkayScareWhenStrong(
        "Hold a wider order until the sample sells through at that price; otherwise skip it.",
        "Strong",
      ),
    ).toBe(true);
    expect(
      assertNoOkayScareWhenStrong(
        "The Okay recommendation reflects low-confidence evidence.",
        "Okay",
      ),
    ).toBe(true);
  });

  it("rejects a Strong narration that carries Okay mitigation wording", async () => {
    let calls = 0;
    const fetchFn: typeof fetch = async (url, init) => {
      calls += 1;
      return responseWith(SIX_SENTENCE_ESTIMATE_BODY)(url, init);
    };
    const r = await narrateSuggestionWithGemini(
      { ...estimatePayload, strength: "Strong", okayReason: null },
      "en",
      { apiKey: "test", fetchFn },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("okay_mismatch");
    expect(calls).toBe(2);
  });
});

describe("one Okay reason from one source", () => {
  function candidateRow(input: {
    fitScore: number;
    riskRead: string | null;
    storedOkayReason?: string | null;
    competitionLevel?: string | null;
    confidence?: number | null;
    scoreConfidence?: number | null;
    scoreCompetitionScore?: number | null;
  }) {
    const fitBreakdownJson = JSON.stringify({
      catalogKey: "led",
      wave2: {
        okayReason: input.storedOkayReason ?? undefined,
        explain: {
          competitionLevel: input.competitionLevel ?? null,
          confidence: input.confidence ?? null,
        },
      },
    });
    const scoreCache =
      input.scoreConfidence != null || input.scoreCompetitionScore != null
        ? {
            confidence: input.scoreConfidence ?? null,
            competitionScore: input.scoreCompetitionScore ?? null,
          }
        : null;

    const view = resolveOkayReasonForDisplay({
      strength: "Okay",
      fitScore: input.fitScore,
      storedOkayReason: input.storedOkayReason ?? null,
      storedRiskRead: input.riskRead,
      snapshotCompetitionLevel: input.competitionLevel ?? null,
      snapshotConfidence: input.confidence ?? null,
      scoreConfidence: scoreCache?.confidence ?? null,
      scoreCompetitionScore: scoreCache?.competitionScore ?? null,
    });
    const payload = skillPayloadFromCandidateMeta({
      productName: "LED Wand",
      fitScore: input.fitScore,
      strength: "Okay",
      fitBreakdownJson,
      riskRead: input.riskRead,
      scoreCache,
    });
    return { view, payload };
  }

  it("agrees on high_competition", () => {
    const { view, payload } = candidateRow({
      fitScore: 90,
      riskRead: "@listing.highCompetition",
      storedOkayReason: "high_competition",
      scoreCompetitionScore: 0.8,
      scoreConfidence: 0.8,
    });
    expect(view.okayReason).toBe("high_competition");
    expect(payload.okayReason).toBe(view.okayReason);
    expect(view.riskRead).toBe("@listing.highCompetition");
  });

  it("agrees on fit_risk for a genuine Fit constraint", () => {
    const weak = candidateRow({ fitScore: 62, riskRead: "@fit.moderateOkay" });
    expect(weak.view.okayReason).toBe("fit_risk");
    expect(weak.payload.okayReason).toBe(weak.view.okayReason);
    expect(weak.view.riskRead).toBe("@fit.moderateOkay");

    // Risk above tolerance is a real constraint even at a high Fit score.
    const risky = candidateRow({
      fitScore: 85,
      riskRead: "@fit.riskOverTolerance",
    });
    expect(risky.view.okayReason).toBe("fit_risk");
    expect(risky.payload.okayReason).toBe(risky.view.okayReason);
    expect(risky.view.riskRead).toBe("@fit.riskOverTolerance");
  });

  it("agrees on low_evidence_confidence for legacy rows with no score cache", () => {
    const { view, payload } = candidateRow({
      fitScore: 100,
      riskRead: "@fit.moderateOkay",
    });
    // Fit 100 cannot be a Fit risk — both sides heal to the evidence cap.
    expect(view.okayReason).toBe("low_evidence_confidence");
    expect(payload.okayReason).toBe(view.okayReason);
    expect(view.riskRead).toBe("@listing.lowEvidenceConfidence");
    expect(view.riskRead).not.toBe("@fit.moderateOkay");
  });

  it("agrees when a legacy row stored fit_risk on a Fit 100 card", () => {
    // The view healed this to the evidence cap while the explain payload used
    // the stored label verbatim, so the card and Gemini stated two reasons.
    const { view, payload } = candidateRow({
      fitScore: 100,
      riskRead: "@fit.moderateOkay",
      storedOkayReason: "fit_risk",
    });
    expect(view.okayReason).toBe("low_evidence_confidence");
    expect(payload.okayReason).toBe(view.okayReason);
  });

  it("keeps Strong free of an Okay reason and note", () => {
    expect(
      resolveOkayReasonForDisplay({
        strength: "Strong",
        fitScore: 95,
        storedRiskRead: "@fit.moderateOkay",
      }),
    ).toEqual({ okayReason: null, riskRead: null });
    expect(
      skillPayloadFromCandidateMeta({
        productName: "LED Wand",
        fitScore: 95,
        strength: "Strong",
        fitBreakdownJson: "{}",
        riskRead: "@fit.moderateOkay",
      }).okayReason,
    ).toBeNull();
  });

  it("the view and the explain payload share the resolver", () => {
    const service = readFileSync(
      path.join(process.cwd(), "src/lib/discovery/service.ts"),
      "utf8",
    );
    const whyPick = readFileSync(
      path.join(process.cwd(), "src/lib/discovery/explain/why-pick.ts"),
      "utf8",
    );
    for (const src of [service, whyPick]) {
      expect(src).toContain("resolveOkayReasonForDisplay");
    }
    // No second copy of the healing ladder in the view.
    expect(service).not.toContain('riskRead = "@listing.lowEvidenceConfidence"');
    expect(service).not.toContain('okayReason = "high_competition"');
  });
});

describe("failure copy tells the founder which failure happened", () => {
  const messages = (locale: "en" | "ar") =>
    JSON.parse(
      readFileSync(path.join(process.cwd(), `messages/${locale}.json`), "utf8"),
    ).Discovery as Record<string, string>;

  it("has distinct EN and AR copy per failure kind", () => {
    for (const locale of ["en", "ar"] as const) {
      const m = messages(locale);
      const keys = [
        "whySuggestedUnverified",
        "whySuggestedIncomplete",
        "whySuggestedApiError",
        "whySuggestedMissingKey",
        "whyPickRateLimited",
        "whySuggestedOff",
      ];
      for (const key of keys) {
        expect(m[key], `${locale}.${key}`).toBeTruthy();
      }
      expect(new Set(keys.map((k) => m[k])).size).toBe(keys.length);
    }
    expect(messages("en").whySuggestedUnverified).not.toBe(
      messages("ar").whySuggestedUnverified,
    );
    expect(messages("ar").whySuggestedIncomplete).toMatch(/[\u0600-\u06FF]/);
  });

  it("maps each error code to its own copy on the card", () => {
    const board = readFileSync(
      path.join(process.cwd(), "src/components/discovery/DiscoveryBoard.tsx"),
      "utf8",
    );
    expect(board).toContain('res.error === "ungrounded"');
    expect(board).toContain('res.error === "okay_mismatch"');
    expect(board).toContain('res.error === "incomplete"');
    expect(board).toContain("whySuggestedUnverified");
    expect(board).toContain("whySuggestedIncomplete");
    // Configuration and transport failures keep their existing copy.
    expect(board).toContain("whySuggestedMissingKey");
    expect(board).toContain("whyPickRateLimited");
    expect(board).toContain("whySuggestedOff");
    expect(board).toContain("whySuggestedApiError");
  });
});
