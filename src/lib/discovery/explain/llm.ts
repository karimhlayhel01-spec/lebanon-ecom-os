/**
 * Optional LLM narrator for §6.1 — never a scoring brain.
 * Uses DISCOVERY_EXPLAIN_API_KEY or OPENAI_API_KEY. No key → caller uses template.
 */

import {
  assertNoUngroundedMarketClaims,
  type WhyPickLocale,
  type WhyPickResult,
  type WhyPickSkillPayload,
  buildDeterministicWhyPick,
  canCiteMarketFromPayload,
} from "@/lib/discovery/explain/why-pick";

export function resolveExplainLlmApiKey(
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  const key =
    env.DISCOVERY_EXPLAIN_API_KEY?.trim() || env.OPENAI_API_KEY?.trim();
  return key || undefined;
}

export function isWhyPickFeatureEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const v = env.DISCOVERY_WHY_PICK;
  return v === "1" || v === "true";
}

type LlmOptions = {
  apiKey: string;
  fetchFn?: typeof fetch;
  model?: string;
};

/**
 * Ask the LLM to paraphrase the payload only. On failure / ungrounded output,
 * returns deterministic template (never invents market facts into the gate path).
 */
export async function narrateWhyPickWithLlm(
  payload: WhyPickSkillPayload,
  locale: WhyPickLocale,
  opts: LlmOptions,
): Promise<WhyPickResult> {
  const fallback = buildDeterministicWhyPick(payload, locale);
  const citeMarket = canCiteMarketFromPayload(payload);

  const facts = {
    productName: payload.productName,
    fitScore: payload.fitScore,
    strength: payload.strength,
    softMarginBand: payload.softMarginBand,
    canCiteMarketSignals: citeMarket,
    demandPath: citeMarket ? payload.demandPath : null,
    competitionLevel: citeMarket ? payload.competitionLevel : null,
    fallbackUsed: payload.fallbackUsed,
  };

  const system = `You write a short product-card explanation (2-3 sentences) for a Lebanon ecommerce founder.
Use ONLY the JSON facts provided. Do not invent demand, competition, abroad traction, Lebanon gap, or marketplace names.
If canCiteMarketSignals is false, mention only Fit and margins — never US/EU traction or Lebanon gap.
Language: ${locale === "ar" ? "Arabic" : "English"}.
Return plain paragraph text only — no title, no markdown.`;

  try {
    const fetchFn = opts.fetchFn ?? fetch;
    const res = await fetchFn("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: opts.model ?? "gpt-4o-mini",
        temperature: 0.3,
        max_tokens: 180,
        messages: [
          { role: "system", content: system },
          { role: "user", content: JSON.stringify(facts) },
        ],
      }),
    });
    if (!res.ok) return fallback;
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const body = json.choices?.[0]?.message?.content?.trim();
    if (!body) return fallback;
    if (!assertNoUngroundedMarketClaims(body, citeMarket)) {
      return fallback;
    }
    return {
      titleKey: "whyPickTitle",
      body: body.slice(0, 600),
      honestyKey: "whyPickHonesty",
      source: "llm",
      marketSignalsOmitted: !citeMarket,
    };
  } catch {
    return fallback;
  }
}
