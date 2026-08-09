/**
 * Gemini narration for Assess listing — skills tier locked; facts-only prose.
 */

import {
  resolveGeminiApiKey,
  resolveGeminiModel,
} from "@/lib/discovery/explain/llm";
import {
  diligenceRecommendationCopyAr,
  diligenceRecommendationCopyEn,
} from "@/lib/supplier/diligence/recommend";
import {
  assertDiligenceNarrationGrounded,
  ensureRecommendationLead,
} from "@/lib/supplier/diligence/validate";
import type {
  DiligenceFacts,
  DiligenceRecommendation,
} from "@/lib/supplier/diligence/types";

export type DiligenceNarrateResult =
  | { ok: true; summary: string }
  | {
      ok: false;
      error: "api_error" | "empty" | "ungrounded" | "incomplete";
    };

function buildSystemPrompt(locale: "en" | "ar"): string {
  if (locale === "ar") {
    return [
      "أنت تساعد مؤسساً لبنانياً يقيّم قائمة مورّد قبل طلب عيّنة فقط.",
      "اكتب فقرتين قصيرتين بالعربية الفصحى المبسّطة.",
      "ابدأ بملاءمة قائمة المنصة (Alibaba أو AliExpress من platform) مع اسم الـ SKU — لا تبحث عن اسم الشركة كمحور.",
      "اذكر السنوات/التحقق/التقييم/الشهادات/الحد الأدنى فقط إن وُجدت في الحقائق؛ وإلا احذفها أو قل إنها غير واضحة من الصفحة — لا تخترع.",
      "يجب أن تتضمن الملخص جملة صريحة: اضغط «افتح على Alibaba» أو «افتح على AliExpress» (حسب platform) على البطاقة لرؤية ملف المورّد الكامل (اسم الشركة، السنوات، التحقق، الشهادات، المراجعات).",
      "لا تستخدم «Alibaba listing · …» كاسم مورّد.",
      "الفقرة الثانية: هل يبرّر ذلك طلب عيّنة وفق التوصية المقفلة. ادفع MOQ والسعر إلى بريد العيّنة إلا إذا وُجدا في الحقائق.",
      "لا تقل أبداً: آمن للطلب بالجملة أو مورّد معتمد.",
      "التوصية المقفلة من المهارات إلزامية — لا ترفعها إلى أخضر ولا تخفّف الأحمر.",
    ].join(" ");
  }
  return [
    "You help a Lebanese founder assess a marketplace listing before a sample ask only.",
    "Write about two short paragraphs in clear English matching this voice:",
    "Lead with platform listing + SKU relevance (use skuName). Do NOT hunt for or require a supplier company name.",
    "Cite years / verified-style signals / rating / certs / MOQ ONLY when present in extracted facts; otherwise omit or say not clear from the fetched page — never invent.",
    "MUST include an explicit sentence: click Open on Alibaba or Open on AliExpress (from openListingCta / platform) on this card to see the full supplier profile (company name, years, verification, certifications, reviews).",
    "Never treat “Alibaba listing · …” or similar placeholders as a supplier identity.",
    "Second beat: whether a sample ask is justified, aligned with the locked recommendation tier. Push MOQ / unit price to the sample email unless facts contain them.",
    "Never say “safe for bulk order” or “approved supplier.” Sample-first only — e.g. worth requesting a sample / proceed with caution / skip for now.",
    "The skills recommendation tier is LOCKED — state it near the opening; do not upgrade skip→green or soft-pedal skip.",
    "Ground every claim in the JSON facts only.",
  ].join(" ");
}

function factsPayload(
  facts: DiligenceFacts,
  skuName: string,
  recommendation: DiligenceRecommendation,
  locale: "en" | "ar",
) {
  const openListingCta =
    facts.platform === "aliexpress"
      ? "Open on AliExpress"
      : facts.platform === "alibaba"
        ? "Open on Alibaba"
        : "Open listing";
  return {
    skuName,
    recommendation,
    recommendationCopy:
      locale === "ar"
        ? diligenceRecommendationCopyAr(recommendation)
        : diligenceRecommendationCopyEn(recommendation),
    yearsOnPlatform: facts.yearsOnPlatform,
    verifiedSignals: facts.verifiedSignals,
    certifications: facts.certifications,
    rating: facts.rating,
    reviewSnippets: facts.reviewSnippets.slice(0, 2),
    skuRelevance: facts.skuRelevance,
    moqHint: facts.moqHint,
    unitPriceHint: facts.unitPriceHint,
    platform: facts.platform,
    openListingCta,
    excerpts: facts.rawExcerpts.slice(0, 4),
  };
}

export async function narrateDiligenceWithGemini(input: {
  facts: DiligenceFacts;
  skuName: string;
  recommendation: DiligenceRecommendation;
  locale: "en" | "ar";
  apiKey: string;
  env?: Record<string, string | undefined>;
  fetchFn?: typeof fetch;
}): Promise<DiligenceNarrateResult> {
  const locale = input.locale;
  const model = resolveGeminiModel(input.env ?? process.env);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(input.apiKey)}`;
  const fetchFn = input.fetchFn ?? fetch;
  const payload = factsPayload(
    input.facts,
    input.skuName,
    input.recommendation,
    locale,
  );

  const attempt = async (
    retryNote: string | null,
  ): Promise<DiligenceNarrateResult> => {
    try {
      const res = await fetchFn(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: buildSystemPrompt(locale) }] },
          contents: [
            {
              role: "user",
              parts: [
                { text: JSON.stringify(payload) },
                ...(retryNote ? [{ text: retryNote }] : []),
              ],
            },
          ],
          generationConfig: {
            temperature: 0.35,
            maxOutputTokens: 1024,
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
      });
      if (!res.ok) return { ok: false, error: "api_error" };
      const json = (await res.json()) as {
        candidates?: {
          content?: { parts?: { text?: string; thought?: boolean }[] };
        }[];
      };
      const raw = (json.candidates?.[0]?.content?.parts ?? [])
        .filter((p) => !p.thought)
        .map((p) => p.text ?? "")
        .join("")
        .trim();
      if (!raw) return { ok: false, error: "empty" };

      const led = ensureRecommendationLead(raw, input.recommendation, locale);
      if (
        !assertDiligenceNarrationGrounded(
          led,
          input.facts,
          input.recommendation,
        )
      ) {
        return { ok: false, error: "ungrounded" };
      }
      return { ok: true, summary: led };
    } catch {
      return { ok: false, error: "api_error" };
    }
  };

  const first = await attempt(null);
  if (first.ok) return first;
  if (first.error === "ungrounded" || first.error === "empty") {
    return attempt(
      locale === "ar"
        ? "أعد الكتابة: اذكر صراحة «افتح على Alibaba» أو «افتح على AliExpress» حسب المنصة. لا تخترع أرقاماً أو شارات غير موجودة في JSON. لا تستخدم «Alibaba listing ·» كاسم مورّد. التزم بتوصية المهارات المقفلة."
        : "Rewrite: explicitly say Click Open on Alibaba or Open on AliExpress (match platform). Do not invent years/ratings/badges missing from the JSON. Never use “Alibaba listing ·” as a supplier name. Keep the locked skills recommendation tier.",
    );
  }
  return first;
}

export { resolveGeminiApiKey };
