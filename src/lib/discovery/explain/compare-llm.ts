/**
 * Gemini narrator for WAVE-2 §6.2 worth-considering compare.
 * Skills already picked the winner — this only explains the advice.
 */

import {
  assertCompareAdviceAligned,
  assertCompareGrounded,
  containsHardBlockedCompareWording,
  finalizeCompareBody,
  COMPARE_ADVISED_NAME_MAX_MENTIONS,
  COMPARE_BODY_MAX_CHARS,
  COMPARE_BODY_MIN_CHARS,
  type CompareExplainPayload,
  type CompareExplainResult,
} from "@/lib/discovery/explain/compare";
import {
  canCiteMarketFromPayload,
  founderFitLabel,
  founderStrengthLabel,
  rewriteEnglishSkillLabelsForArabic,
  type WhyPickLocale,
} from "@/lib/discovery/explain/why-pick";
import {
  resolveGeminiModel,
  type GeminiNarrateOptions,
} from "@/lib/discovery/explain/llm";

/**
 * Failure kinds the founder can act on:
 * - missing_key / api_error: not configured, or the service failed (quota too).
 * - empty: Gemini returned nothing.
 * - incomplete: the brief did not survive the length / footprint rules.
 * - ungrounded: market wording we could not verify against saved evidence.
 * - misaligned: the prose nominated a product the skills did not advise.
 */
export type CompareNarrateError =
  | "missing_key"
  | "api_error"
  | "ungrounded"
  | "misaligned"
  | "incomplete"
  | "empty";

export type CompareNarrateResult =
  | { ok: true; result: CompareExplainResult }
  | { ok: false; error: CompareNarrateError };

/**
 * Same policy as §6.1: exactly one tightened retry on a validation failure,
 * and never on a missing key or a quota / rate-limit response.
 */
const RETRYABLE_ERRORS = new Set<CompareNarrateError>([
  "ungrounded",
  "misaligned",
  "incomplete",
  "empty",
]);

function pct(n: number | null | undefined): number | null {
  if (n == null || !Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

/** Locked AR compare GOOD example — must stay ≥ COMPARE_BODY_MIN_CHARS. */
export const AR_COMPARE_GOOD_EXAMPLE =
  "ننصح بالبدء بـأداة مطبخ لأن الملاءمة 95/100 وهوامش التخطيط حوالي 72 بالمئة قبل الإعلانات و38 بالمئة بعدها أوضح من شاحن محمول عند ملاءمة 80/100 بين هذه الوسوم. " +
  "قراءة السوق لأداة مطبخ تقديرية لأن لا دليل حي محفوظ يمكن الاستشهاد به، لذا تبقى الفرصة فرضية لا فجوة مثبتة بين الخارج ولبنان. " +
  "شاحن محمول أيضاً تقديري فقط مع ملاءمة أضعف ونفس الحاجة لإثبات الطلب المدفوع قبل طلب أوسع أو توسّع في المخزون. " +
  "كلا المنتجين يتجاوزان أهداف الهوامش الصارمة، لذلك الاقتصاد وحده لا يفصل بينهما ويبقى اختبار الطلب المدفوع هو الفاصل العملي. " +
  "اختبر أداة مطبخ أولاً بعيّنة صغيرة وزاوية الحامل المقاوم للحرارة، مع إعلانات متواضعة حتى تؤكد الطلبات الفعلية التقدير. " +
  "القبول يبقى خيارك الحر على أي بطاقة؛ المهارات تنصح فقط بأي منتج موسوم تختبره أولاً بين هذه المجموعة.";

function buildCompareSystemPrompt(locale: WhyPickLocale): string {
  const fitLabel = founderFitLabel(locale);
  if (locale === "ar") {
    return `تكتب موجزاً واحداً واضحاً بالعربية لمقارنة منتجات وسمها المؤسس «جديرة بالاعتبار» في اكتشاف لبنان.

قواعد صارمة
- المهارات اختارت already advisedName / advisedCandidateId. اشرح لماذا هذا المنتج هو الاختبار المنصوح بين المجموعة. لا تغيّر الفائز.
- بالضبط 4–8 جمل كاملة تنتهي بنقطة أو ؟. النافذة ${COMPARE_BODY_MIN_CHARS}–${COMPARE_BODY_MAX_CHARS} حرفاً. الموجز الأقصر من ${COMPARE_BODY_MIN_CHARS} يُرفض. لا تتوقف منتصف جملة.
- الجملة الأولى يجب أن ترشّح advisedName بعبارة نصح (مثل «ننصح بالبدء بـ…»). لا تؤجّل الترشيح الوحيد لنهاية الموجز.
- اذكر advisedName مرة إلى ${COMPARE_ADVISED_NAME_MAX_MENTIONS} مرات (النص الحرفي). الأسماء جاهزة بلغة الواجهة — لا تترجمها. يمكنك ذكر المنتجات الأخرى مرة لكل منها.
- كل عبارة نصح («ننصح»، «ابدأ بـ»، «اختبر أولاً»، «الخيار الأقوى») يجب أن تتعلق بـ advisedName فقط. ترشيح منافس مرفوض.
- استخدم فقط حقائق JSON غير الفارغة.
- نصيحة فقط — القبول يبقى خياراً حراً. لا تقل «يجب أن تقبل».
- غطِّ لكل منتج: أطروحة الفرصة، ${fitLabel}/الميزانية، الهوامش، التميّز، عدم اليقين، واختبار العيّنة للمنتج المنصوح.
- انسخ fitLabel وstrengthLabel من JSON للنثر المؤسس (مثل «الملاءمة 95/100»، «قوي»، «مقبول»). ممنوع Fit / Okay / Strong كعناوين إنجليزية في الفقرة العربية.
- ممنوع الحشو والمصطلحات الهندسية.
- اللغة: العربية.

GOOD (≥${COMPARE_BODY_MIN_CHARS} حرفاً):
"${AR_COMPARE_GOOD_EXAMPLE}"

أرجع نص الفقرة فقط.`;
  }

  return `You write ONE clear compare brief for a Lebanon ecommerce founder who marked 2–3 Discovery products as “worth considering.”

HARD RULES
- Skills already chose advisedName / advisedCandidateId. You MUST explain why that product is the advised test among the selected set. NEVER override or pick a different winner.
- Exactly 4–8 complete sentences ending with periods. Target a dense brief; accepted window ${COMPARE_BODY_MIN_CHARS}–${COMPARE_BODY_MAX_CHARS} characters. Never stop mid-sentence.
- FIRST sentence MUST nominate advisedName with an advice phrase (e.g. “Skills advise starting with advisedName …” or “Start with advisedName …”). Do not save the only nomination for the last sentence — longer briefs may be trimmed from the end.
- Name advisedName at least once and at most ${COMPARE_ADVISED_NAME_MAX_MENTIONS} times (exact JSON string). advisedName and each productName are already in the founder’s UI language — do not translate them or substitute another script/language for a name. You may name the other products once each.
- Every advice phrase ("skills advise", "start with", "test first", "the stronger choice") must attach to advisedName. NEVER attach one to another product — naming a rival as the one to start with is a rejected brief. Mention the other products only as comparisons (“advise advisedName over Rival”, “weaker Fit than Rival” are fine).
- Use ONLY non-null JSON facts. Never invent demand, competition, domains, sellers, counts, or margins.
- Advice only — NOT an Accept decision. Never say “you must accept” or that Accept is locked to the advised product. Founder may still Accept any card.
- For each product, briefly cover: opportunity thesis (live evidence only when canCiteMarketSignals; otherwise estimate-only honesty), ${fitLabel}/budget, margins, differentiation, main uncertainty, and the recommended sample-first test for the advised product.
- Copy fitLabel and strengthLabel from JSON for founder prose (e.g. “Fit 95/100”, “Okay”, “Strong”). strength remains the skills enum.
- BAN fluff and jargon: “is worth considering” as a filler verdict (naming the mark feature is fine), “demand path”, “whitespace”, “local_proven”, “heuristic”, “composite”, “Wave 2”, “skill payload”.
- When a product’s canCiteMarketSignals is false, say its market read is an estimate and do not cite sellers/domains/counts for it.
- Label the overall honesty path: if anyLiveEvidence is true, say which claims use saved live evidence; otherwise keep the whole brief estimate-only.
- You may close by restating that Accept remains the founder’s free choice on any card.
- Language: English.

Return the paragraph text only.`;
}

function factsForPrompt(payload: CompareExplainPayload, locale: WhyPickLocale) {
  return {
    advisedCandidateId: payload.advisedCandidateId,
    advisedCatalogKey: payload.advisedCatalogKey,
    advisedName: payload.advisedName,
    anyLiveEvidence: payload.anyLiveEvidence,
    honestyPath: payload.anyLiveEvidence ? "live_evidence" : "estimate_only",
    fitLabel: founderFitLabel(locale),
    products: payload.products.map((p) => {
      const cite = canCiteMarketFromPayload(p);
      return {
        candidateId: p.candidateId,
        catalogKey: p.catalogKey,
        productName: p.productName,
        category: p.category ?? null,
        fitScore: p.fitScore,
        fitLabel: founderFitLabel(locale),
        strength: p.strength,
        strengthLabel: founderStrengthLabel(locale, p.strength),
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
  const fetchFn = opts.fetchFn ?? fetch;

  const attempt = async (
    retryNote: string | null,
  ): Promise<CompareNarrateResult> => {
    try {
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
              parts: [
                { text: JSON.stringify(factsForPrompt(payload, locale)) },
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
      // Cheap pre-check only — length / domain / count rules wait until after
      // finalize so a stray trailing sentence cannot fail a valid brief.
      if (containsHardBlockedCompareWording(raw, payload)) {
        return { ok: false, error: "ungrounded" };
      }

      const otherNames = payload.products
        .filter((p) => p.candidateId !== payload.advisedCandidateId)
        .map((p) => p.productName);
      const draft =
        locale === "ar" ? rewriteEnglishSkillLabelsForArabic(raw) : raw;
      const body = finalizeCompareBody(
        draft,
        payload.advisedName,
        otherNames,
      );
      if (!body) {
        return { ok: false, error: "incomplete" };
      }
      // Grounding runs on the finalized body: a trimmed extra sentence is
      // already dropped, so it can no longer fail a valid paragraph.
      if (!assertCompareGrounded(body, payload.products)) {
        return { ok: false, error: "ungrounded" };
      }
      if (!assertCompareAdviceAligned(body, payload)) {
        return { ok: false, error: "misaligned" };
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
  };

  const first = await attempt(null);
  if (first.ok || !RETRYABLE_ERRORS.has(first.error)) return first;
  return attempt(buildCompareRetryNote(payload, first.error));
}

/**
 * Tightened second-attempt instruction. Names the rivals explicitly, because a
 * misaligned brief usually pinned the advice phrase to one of them.
 */
function buildCompareRetryNote(
  payload: CompareExplainPayload,
  error: CompareNarrateError,
): string {
  const others = payload.products
    .filter((p) => p.candidateId !== payload.advisedCandidateId)
    .map((p) => `"${p.productName}"`);
  const lines = [
    "RETRY — the previous brief was rejected. Fix it exactly:",
    `- Write 4–8 complete sentences, ${COMPARE_BODY_MIN_CHARS}–${COMPARE_BODY_MAX_CHARS} characters total, every sentence ending with a period.`,
    `- The advised test is "${payload.advisedName}". Name it once to ${COMPARE_ADVISED_NAME_MAX_MENTIONS} times and attach every advice phrase to that name only.`,
    `- FIRST sentence MUST open by advising "${payload.advisedName}" (e.g. “Skills advise starting with ${payload.advisedName} …”); do not put the only nomination at the end.`,
  ];
  if (others.length > 0) {
    lines.push(
      `- Never write that the founder should start with, test first, or that the stronger or better choice is ${others.join(" or ")}. Name them only as comparisons.`,
    );
  }
  if (!payload.anyLiveEvidence) {
    lines.push(
      "- Estimate-only: no market specifics at all. No result counts, no domains or website names, no seller or marketplace names.",
    );
  }
  if (error === "incomplete") {
    lines.push(
      "- The previous brief did not fit the length window. Keep every sentence complete and stop before the character ceiling.",
    );
  }
  if (error === "misaligned") {
    lines.push(
      `- The previous brief nominated the wrong product or never nominated "${payload.advisedName}". Open with skills advice on that exact name and never promote a rival.`,
    );
  }
  return lines.join("\n");
}
