/**
 * Required Gemini narrator for Discovery “Why we suggested this” (§6.1).
 * Never a scoring brain — skills remain pass/fail SoT.
 *
 * Env: GEMINI_API_KEY or DISCOVERY_EXPLAIN_GEMINI_API_KEY (never commit secrets).
 * Model: DISCOVERY_GEMINI_MODEL (default gemini-2.5-flash).
 */

import {
  assertNoUngroundedMarketClaims,
  assertOkayReasonAligned,
  canCiteMarketFromPayload,
  finalizeSuggestionBody,
  SUGGESTION_BODY_MIN_CHARS,
  SUGGESTION_BODY_MAX_CHARS,
  type WhyPickLocale,
  type WhyPickResult,
  type WhyPickSkillPayload,
} from "@/lib/discovery/explain/why-pick";

/** Current default — gemini-2.0-flash returned 404 (retired) for founder keys. */
export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";

export function resolveGeminiApiKey(
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  const key =
    env.DISCOVERY_EXPLAIN_GEMINI_API_KEY?.trim() ||
    env.GEMINI_API_KEY?.trim();
  return key || undefined;
}

export function resolveGeminiModel(
  env: Record<string, string | undefined> = process.env,
): string {
  const override = env.DISCOVERY_GEMINI_MODEL?.trim();
  return override || DEFAULT_GEMINI_MODEL;
}

/** @deprecated Prefer resolveGeminiApiKey — OpenAI path retired for Discovery explain. */
export function resolveExplainLlmApiKey(
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  return resolveGeminiApiKey(env);
}

export function isGeminiConfigured(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return Boolean(resolveGeminiApiKey(env));
}

/**
 * Suggestion explain shows when pool/score Discovery is on (WAVE-2).
 * Separate from optional legacy DISCOVERY_WHY_PICK toggle flag.
 */
export function isSuggestionExplainEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const v = env.DISCOVERY_POOL_V2;
  return v === "1" || v === "true";
}

/** @deprecated Use isSuggestionExplainEnabled for the market suggestion callout. */
export function isWhyPickFeatureEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return isSuggestionExplainEnabled(env);
}

export type GeminiNarrateOptions = {
  apiKey: string;
  fetchFn?: typeof fetch;
  /** Default: gemini-2.5-flash (or DISCOVERY_GEMINI_MODEL). */
  model?: string;
  /** Env for model override when opts.model omitted. */
  env?: Record<string, string | undefined>;
};

export type GeminiNarrateResult =
  | { ok: true; result: WhyPickResult }
  | { ok: false; error: "missing_key" | "api_error" | "ungrounded" | "empty" };

function pct(n: number | null | undefined): number | null {
  if (n == null || !Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

function buildSystemPrompt(locale: WhyPickLocale): string {
  const lang = locale === "ar" ? "Arabic" : "English";
  return `You write ONE clear “why we suggested this product” paragraph for a Lebanon ecommerce founder deciding Accept vs skip.

HARD RULES
- Exactly 4–6 complete sentences ending with periods. Target 900–1100 characters; accepted window ${SUGGESTION_BODY_MIN_CHARS}–${SUGGESTION_BODY_MAX_CHARS}. Never stop mid-sentence.
- MUST name productName at least once and at most twice (use the exact string from JSON).
- Use ONLY non-null JSON facts. Skip missing fields — never invent demand, competition, domains, seller/marketplace names, counts, or margins.
- Explanation only — NOT a pass/fail score or accept decision. No engineer jargon.
- Report the operational score as “Fit <fitScore>/100”. strength is the overall recommendation, not the Fit label; never call Fit moderate merely because strength is Okay.
- BAN fluff: “strong suggestion”, “good fit for your store”, “worth considering”, “looks promising”.
- BAN jargon: “demand path”, “whitespace”, “local_proven”, “skill payload”, “heuristic”, “composite”, “Wave 2”, “score cache”.
- BAN these stock lines (never copy them): “People in Lebanon already seem to look for this kind of product”, “It does well abroad while Lebanon still looks less crowded”.
- When canCiteMarketSignals is true, use the bounded marketEvidence only: mention concrete abroad traction (count and/or listed domain/title), Lebanon footprint, and who the founder would fight. Name Ishtari / EGLOW / Platza ONLY when present in tier1Found. Do not say “not saturated”, “gap”, or “less crowded” unless the JSON counts directly support the comparison.
- Include curatedDifferentiation as the differentiation angle when non-null. It is curated product guidance, not proof that sellers currently use it.
- When canCiteMarketSignals is false, say plainly that the market read is an estimate, then use only Fit, margins, curatedDifferentiation, fallback, and okayReason from JSON. Do not cite sellers, domains, counts, demandPath, or competitionLevel as facts.
- If strength is Okay, explain exactly okayReason and never substitute another reason: low_evidence_confidence means estimate-only evidence (not moderate Fit); high_competition means estimated or live-backed competition pressure (not moderate Fit); fit_risk means an actual operational Fit constraint.
- If strength is Strong, do not add an Okay warning or scare sentence.
- The mitigation MUST address the same okayReason: low_evidence_confidence → small sample, modest ads, and do not scale on the estimate alone; high_competition → curated differentiation and controlled ads; fit_risk → a small sample within the named operational constraint, or skip.
- End with a clear choice: accept to sample if the founder can apply that mitigation, otherwise skip. Never end on a generic verdict.
- Rephrase demand/competition freshly with product context each time — never echo JSON codes.
- Build one opportunity thesis in this order: the abroad-versus-Lebanon opportunity only when bounded live evidence supports it; Fit and budget capacity; economics; how the curated differentiation can win; the real uncertainty; then a reason-matched test or mitigation. In estimate-only mode, replace the market comparison with an explicit unvalidated opportunity hypothesis.
- Language: ${lang}.

Meaning hints (use only alongside relevant non-zero marketEvidence):
- abroad.count/results → concrete abroad result footprint
- lebanon.count/results → concrete Lebanon result footprint
- localCompetition.count/results + tier1Found → seller fight and ads intensity
- softMarginBand pass / soft_ok / far_below → clear / under hard targets / weak vs 70%–35% (only pass is listed)
- budgetFightTight true → ads runway may be tight for this fight

GOOD with live evidence (product-specific, dense, actionable):
"Silicone spatula set appeared in four saved abroad results including amazon.com, compared with one saved Lebanon result, while Ishtari also appeared locally, creating a testable opportunity but confirming a real seller fight. Fit 78/100 indicates the founder can handle the product within the stated budget, time, risk, and workload profile, and planning margins of about 72% before ads and 38% after ads clear the shortlist economics. The way to compete is the curated heat-safe bundle angle, presented as a focused offer rather than another generic utensil set, with the first ads budget kept controlled while measuring paid demand. The Okay recommendation reflects high competition rather than moderate Fit, so the uncertainty is whether that differentiated offer can earn attention efficiently against the sellers already present. Accept to order one small sample only if you can run that differentiated test and hold a wider order until conversion and ad cost support it; otherwise skip it."

GOOD estimate-only (no live evidence saved):
"Silicone spatula set has a testable opportunity hypothesis, but its market read remains an estimate because no citable live-search evidence is saved, so no claim about foreign traction or relative local availability is being made as fact. Fit 100/100 indicates the founder can handle the product within the stated budget, time, risk, and workload profile, while planning margins of about 72% before ads and 38% after ads clear the shortlist economics. The way to test the offer is the curated heat-safe bundle angle, presented clearly enough that customers can distinguish it from a generic utensil set without assuming the angle already wins in the market. The Okay recommendation reflects low-confidence market evidence rather than moderate Fit, so the key uncertainty is real paid demand and not the founder's operational ability. Accept to order one small sample with modest ads only if you will validate actual sales and refuse to scale from this estimate alone; otherwise skip it and preserve the budget."

BAD:
"People in Lebanon already seem to look for this kind of product. Demand path is local_proven. Worth considering."
"Clutch Pro USB-C Portable Charger has an estimated fit of 100/100. This product could be a good fit for your store."

Return the paragraph text only.`;
}

/**
 * Narrate skill payloads with Gemini. Fail closed — no template product UX.
 */
export async function narrateSuggestionWithGemini(
  payload: WhyPickSkillPayload,
  locale: WhyPickLocale,
  opts: GeminiNarrateOptions,
): Promise<GeminiNarrateResult> {
  if (!opts.apiKey?.trim()) {
    return { ok: false, error: "missing_key" };
  }

  const citeMarket = canCiteMarketFromPayload(payload);
  const facts = {
    productName: payload.productName,
    category: payload.category ?? null,
    fitScore: payload.fitScore,
    strength: payload.strength,
    okayReason: payload.okayReason ?? null,
    softMarginBand: payload.softMarginBand ?? null,
    marginBeforePct: pct(payload.marginBefore),
    marginAfterPct: pct(payload.marginAfter),
    canCiteMarketSignals: citeMarket,
    evidenceSource: payload.evidenceSource ?? null,
    marketRead: citeMarket ? "live_evidence" : "estimate_only",
    honestyPath: citeMarket ? "live_evidence" : "estimate_only",
    demandPath: citeMarket ? (payload.demandPath ?? null) : null,
    competitionLevel: citeMarket ? (payload.competitionLevel ?? null) : null,
    budgetFightTight:
      citeMarket &&
      payload.budgetFightMultiplier != null &&
      payload.budgetFightMultiplier < 0.85
        ? true
        : citeMarket && payload.budgetFightMultiplier != null
          ? false
          : null,
    fallbackUsed: Boolean(payload.fallbackUsed),
    curatedDifferentiation: payload.curatedDifferentiation ?? null,
    marketEvidence: citeMarket ? (payload.marketEvidence ?? null) : null,
  };

  const model = opts.model ?? resolveGeminiModel(opts.env ?? process.env);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(opts.apiKey)}`;

  try {
    const fetchFn = opts.fetchFn ?? fetch;
    const res = await fetchFn(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: buildSystemPrompt(locale) }] },
        contents: [
          {
            role: "user",
            parts: [{ text: JSON.stringify(facts) }],
          },
        ],
        generationConfig: {
          temperature: 0.35,
          maxOutputTokens: 768,
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
    if (!assertNoUngroundedMarketClaims(raw, payload)) {
      return { ok: false, error: "ungrounded" };
    }

    const body = finalizeSuggestionBody(raw, payload.productName);
    if (!body) {
      return { ok: false, error: "empty" };
    }
    if (!assertOkayReasonAligned(body, payload.okayReason ?? null)) {
      return { ok: false, error: "ungrounded" };
    }

    return {
      ok: true,
      result: {
        titleKey: "whySuggestedTitle",
        body,
        honestyKey: citeMarket
          ? "whySuggestedHonestyLive"
          : "whySuggestedHonestyEstimate",
        source: "llm",
        marketSignalsOmitted: !citeMarket,
      },
    };
  } catch {
    return { ok: false, error: "api_error" };
  }
}

/**
 * @deprecated OpenAI path removed — use narrateSuggestionWithGemini.
 * Returns fail-closed empty shape if somehow still called.
 */
export async function narrateWhyPickWithLlm(
  payload: WhyPickSkillPayload,
  locale: WhyPickLocale,
  opts: { apiKey: string; fetchFn?: typeof fetch; model?: string },
): Promise<WhyPickResult> {
  const r = await narrateSuggestionWithGemini(payload, locale, {
    apiKey: opts.apiKey,
    fetchFn: opts.fetchFn,
    model: opts.model,
  });
  if (r.ok) return r.result;
  return {
    titleKey: "whySuggestedTitle",
    body: "",
    honestyKey: "whySuggestedHonesty",
    source: "llm",
    marketSignalsOmitted: true,
  };
}
