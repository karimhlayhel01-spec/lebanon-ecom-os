/**
 * Gemini narrator for WAVE-2 §6.2 worth-considering compare.
 * Skills already picked the winner — this only explains the advice.
 */

import {
  assertCompareAdviceAligned,
  assertCompareGrounded,
  finalizeCompareBody,
  COMPARE_BODY_MAX_CHARS,
  COMPARE_BODY_MIN_CHARS,
  type CompareExplainPayload,
  type CompareExplainResult,
} from "@/lib/discovery/explain/compare";
import {
  canCiteMarketFromPayload,
  type WhyPickLocale,
} from "@/lib/discovery/explain/why-pick";
import {
  resolveGeminiModel,
  type GeminiNarrateOptions,
} from "@/lib/discovery/explain/llm";

export type CompareNarrateResult =
  | { ok: true; result: CompareExplainResult }
  | { ok: false; error: "missing_key" | "api_error" | "ungrounded" | "empty" };

function pct(n: number | null | undefined): number | null {
  if (n == null || !Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

function buildCompareSystemPrompt(locale: WhyPickLocale): string {
  const lang = locale === "ar" ? "Arabic" : "English";
  return `You write ONE clear compare brief for a Lebanon ecommerce founder who marked 2–3 Discovery products as “worth considering.”

HARD RULES
- Skills already chose advisedName / advisedCandidateId. You MUST explain why that product is the advised test among the selected set. NEVER override or pick a different winner.
- Exactly 4–8 complete sentences ending with periods. Target a dense brief; accepted window ${COMPARE_BODY_MIN_CHARS}–${COMPARE_BODY_MAX_CHARS} characters. Never stop mid-sentence.
- Name advisedName at least once and at most twice (exact JSON string). You may name the other products once each.
- Use ONLY non-null JSON facts. Never invent demand, competition, domains, sellers, counts, or margins.
- Advice only — NOT an Accept decision. Never say “you must accept” or that Accept is locked to the advised product. Founder may still Accept any card.
- For each product, briefly cover: opportunity thesis (live evidence only when canCiteMarketSignals; otherwise estimate-only honesty), Fit/budget, margins, differentiation, main uncertainty, and the recommended sample-first test for the advised product.
- BAN fluff and jargon: “worth considering” as filler verdict, “demand path”, “whitespace”, “local_proven”, “heuristic”, “composite”, “Wave 2”, “skill payload”.
- When a product’s canCiteMarketSignals is false, say its market read is an estimate and do not cite sellers/domains/counts for it.
- Label the overall honesty path: if anyLiveEvidence is true, say which claims use saved live evidence; otherwise keep the whole brief estimate-only.
- End with: skills advise starting a sample test on advisedName among these marks, while Accept remains the founder’s free choice on any card.
- Language: ${lang}.

Return the paragraph text only.`;
}

function factsForPrompt(payload: CompareExplainPayload) {
  return {
    advisedCandidateId: payload.advisedCandidateId,
    advisedCatalogKey: payload.advisedCatalogKey,
    advisedName: payload.advisedName,
    anyLiveEvidence: payload.anyLiveEvidence,
    honestyPath: payload.anyLiveEvidence ? "live_evidence" : "estimate_only",
    products: payload.products.map((p) => {
      const cite = canCiteMarketFromPayload(p);
      return {
        candidateId: p.candidateId,
        catalogKey: p.catalogKey,
        productName: p.productName,
        category: p.category ?? null,
        fitScore: p.fitScore,
        strength: p.strength,
        okayReason: p.okayReason ?? null,
        softMarginBand: p.softMarginBand ?? null,
        marginBeforePct: pct(p.marginBefore),
        marginAfterPct: pct(p.marginAfter),
        canCiteMarketSignals: cite,
        evidenceSource: p.evidenceSource ?? null,
        marketRead: cite ? "live_evidence" : "estimate_only",
        demandPath: cite ? (p.demandPath ?? null) : null,
        competitionLevel: cite ? (p.competitionLevel ?? null) : null,
        curatedDifferentiation: p.curatedDifferentiation ?? null,
        marketEvidence: cite ? (p.marketEvidence ?? null) : null,
        isAdvised: p.candidateId === payload.advisedCandidateId,
      };
    }),
  };
}

export async function narrateCompareWithGemini(
  payload: CompareExplainPayload,
  locale: WhyPickLocale,
  opts: GeminiNarrateOptions,
): Promise<CompareNarrateResult> {
  if (!opts.apiKey?.trim()) {
    return { ok: false, error: "missing_key" };
  }

  const model = opts.model ?? resolveGeminiModel(opts.env ?? process.env);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(opts.apiKey)}`;

  try {
    const fetchFn = opts.fetchFn ?? fetch;
    const res = await fetchFn(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: buildCompareSystemPrompt(locale) }],
        },
        contents: [
          {
            role: "user",
            parts: [{ text: JSON.stringify(factsForPrompt(payload)) }],
          },
        ],
        generationConfig: {
          temperature: 0.35,
          maxOutputTokens: 1024,
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    });

    if (!res.ok) {
      return { ok: false, error: "api_error" };
    }

    const json = (await res.json()) as {
      candidates?: {
        content?: {
          parts?: { text?: string; thought?: boolean }[];
        };
      }[];
    };
    const raw = (json.candidates?.[0]?.content?.parts ?? [])
      .filter((p) => !p.thought)
      .map((p) => p.text ?? "")
      .join("")
      .trim();

    if (!raw) {
      return { ok: false, error: "empty" };
    }
    if (!assertCompareGrounded(raw, payload.products)) {
      return { ok: false, error: "ungrounded" };
    }

    const body = finalizeCompareBody(raw, payload.advisedName);
    if (!body) {
      return { ok: false, error: "empty" };
    }
    if (!assertCompareAdviceAligned(body, payload)) {
      return { ok: false, error: "ungrounded" };
    }

    return {
      ok: true,
      result: {
        titleKey: "compareResultTitle",
        body,
        honestyKey: payload.anyLiveEvidence
          ? "whySuggestedHonestyLive"
          : "whySuggestedHonestyEstimate",
        source: "llm",
        advisedCandidateId: payload.advisedCandidateId,
        advisedCatalogKey: payload.advisedCatalogKey,
        advisedName: payload.advisedName,
        marketSignalsOmitted: !payload.anyLiveEvidence,
      },
    };
  } catch {
    return { ok: false, error: "api_error" };
  }
}
