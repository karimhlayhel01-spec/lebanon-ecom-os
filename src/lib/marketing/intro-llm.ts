/**
 * Marketing LLM provider seam — Gemini fills Intro lesson bodies (Wave 4 Phase 1).
 * Unlock / money truth stays in skills/gates. Fail closed without API key.
 */

import {
  DEFAULT_GEMINI_MODEL,
  resolveGeminiApiKey,
  resolveGeminiModel,
} from "@/lib/discovery/explain/llm";
import {
  ALL_INTRO_SECTION_IDS,
  INTRO_SECTION_TITLES,
  type IntroLessonInput,
  type IntroLessonPayload,
} from "@/lib/marketing/intro-lesson";
import {
  buildIntroFactsPack,
  validateAndAssembleIntroLesson,
  type IntroBodyFill,
  type IntroValidateError,
} from "@/lib/marketing/intro-validate";
import {
  improveStorePageCopyWithGemini,
  type StorePageCopyLlmResult,
} from "@/lib/store/page-copy-llm";
import type { StorePageCopyInput } from "@/lib/store/page-copy";

export type MarketingLlmError =
  | "missing_key"
  | "api_error"
  | "empty"
  | "parse_error"
  | IntroValidateError;

export type MarketingIntroFillResult =
  | { ok: true; lesson: IntroLessonPayload }
  | { ok: false; error: MarketingLlmError };

export type MarketingLlmProvider = {
  fillIntroLessonBodies(
    input: IntroLessonInput,
    opts?: { fetchFn?: typeof fetch; env?: Record<string, string | undefined> },
  ): Promise<MarketingIntroFillResult>;
  /** Wave 4 Phase 2 — Store page drafts + discoverability pack. */
  improveStorePageCopy(
    input: StorePageCopyInput,
    opts?: { fetchFn?: typeof fetch; env?: Record<string, string | undefined> },
  ): Promise<StorePageCopyLlmResult>;
};

function stripJsonFence(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  return (fenced?.[1] ?? trimmed).trim();
}

function parseBodiesJson(raw: string): IntroBodyFill[] | null {
  try {
    const parsed = JSON.parse(stripJsonFence(raw)) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const sections = (parsed as { sections?: unknown }).sections;
    if (!Array.isArray(sections)) return null;
    const out: IntroBodyFill[] = [];
    for (const row of sections) {
      if (!row || typeof row !== "object") return null;
      const id = (row as { id?: unknown }).id;
      const bodyEn = (row as { bodyEn?: unknown }).bodyEn;
      const bodyAr = (row as { bodyAr?: unknown }).bodyAr;
      if (typeof id !== "string") return null;
      if (typeof bodyEn !== "string" || typeof bodyAr !== "string") return null;
      out.push({ id, bodyEn, bodyAr });
    }
    return out;
  } catch {
    return null;
  }
}

function buildSystemPrompt(): string {
  const idList = ALL_INTRO_SECTION_IDS.map((id) => {
    const t = INTRO_SECTION_TITLES[id];
    return `- ${id} (topic: ${t.titleEn})`;
  }).join("\n");

  return `You write SKU-tailored Marketing Intro lesson bodies for a Lebanon ecommerce founder.

HARD RULES
- Return ONLY valid JSON: {"sections":[{"id":"...","bodyEn":"...","bodyAr":"..."}, ...]}
- Include EVERY id below exactly once — no extras, no missing ids.
- Do NOT include titles. Bodies only (bodyEn + bodyAr).
- Name productName from the facts in every core section bodyEn (hook through journey_map). Literacy sections should mention productName at least once in bodyEn.
- Tailor examples to this product’s niche from the facts pack. Do not invent ROAS, margins, unlocks, or stage gates.
- Never pitch COD / cash-on-delivery / الدفع عند الاستلام as a marketing wow or differentiator.
- Payment belongs in ops — not as a content hook.
- WhatsApp is the order path when you mention ordering.
- bodyEn: clear English, plain paragraphs separated by \\n\\n; bullets may use "• ".
- bodyAr: clear Arabic (Lebanon-friendly), same structure; keep productName spelling as given (do not translate the product name).
- Each bodyEn and bodyAr must be substantive (at least ~2 short paragraphs or one paragraph + bullets). No empty shells.
- Literacy sections (ai_*): calm tool hints for THIS product — ChatGPT/Claude captions, Nano Banana stills, Seedance motion, strategy chat, Cursor optional — not a wall of hype. Say tools are external; this OS does not unlock stages via chat AI.

Section ids:
${idList}`;
}

async function callGeminiIntro(args: {
  apiKey: string;
  input: IntroLessonInput;
  fetchFn: typeof fetch;
  env: Record<string, string | undefined>;
  retryNote?: string | null;
}): Promise<MarketingIntroFillResult> {
  const facts = buildIntroFactsPack(args.input);
  const model = resolveGeminiModel(args.env);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(args.apiKey)}`;

  try {
    const res = await args.fetchFn(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: buildSystemPrompt() }] },
        contents: [
          {
            role: "user",
            parts: [
              { text: JSON.stringify(facts) },
              ...(args.retryNote ? [{ text: args.retryNote }] : []),
            ],
          },
        ],
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 8192,
          thinkingConfig: { thinkingBudget: 0 },
          responseMimeType: "application/json",
        },
      }),
    });

    if (!res.ok) {
      return { ok: false, error: "api_error" };
    }

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

    const bodies = parseBodiesJson(raw);
    if (!bodies) return { ok: false, error: "parse_error" };

    const validated = validateAndAssembleIntroLesson({
      productName: facts.productName,
      category: facts.category,
      bodies,
      source: "gemini",
    });
    if (!validated.ok) return { ok: false, error: validated.error };
    return { ok: true, lesson: validated.lesson };
  } catch {
    return { ok: false, error: "api_error" };
  }
}

const RETRYABLE = new Set<MarketingLlmError>([
  "empty",
  "parse_error",
  "missing_sections",
  "too_short",
  "missing_product_name",
  "empty_body",
]);

export function createGeminiMarketingLlmProvider(): MarketingLlmProvider {
  return {
    async fillIntroLessonBodies(input, opts) {
      const env = opts?.env ?? process.env;
      const apiKey = resolveGeminiApiKey(env);
      if (!apiKey) return { ok: false, error: "missing_key" };

      const fetchFn = opts?.fetchFn ?? fetch;
      const first = await callGeminiIntro({
        apiKey,
        input,
        fetchFn,
        env,
      });
      if (first.ok || !RETRYABLE.has(first.error)) return first;

      return callGeminiIntro({
        apiKey,
        input,
        fetchFn,
        env,
        retryNote: [
          "RETRY — previous JSON was rejected.",
          `Include every id exactly once: ${ALL_INTRO_SECTION_IDS.join(", ")}.`,
          `Name "${input.name.trim() || "your product"}" in every core section bodyEn.`,
          "No COD / cash-on-delivery pitch. Bodies only — no titles.",
          "Return valid JSON only.",
        ].join("\n"),
      });
    },
    async improveStorePageCopy(input, opts) {
      return improveStorePageCopyWithGemini(input, opts);
    },
  };
}

/** Default bind point for Intro body fill (Gemini). Swap later without rewrite. */
let activeProvider: MarketingLlmProvider = createGeminiMarketingLlmProvider();

export function getMarketingLlmProvider(): MarketingLlmProvider {
  return activeProvider;
}

/** Test / future Claude swap — bind a different provider. */
export function setMarketingLlmProvider(provider: MarketingLlmProvider): void {
  activeProvider = provider;
}

export function resetMarketingLlmProvider(): void {
  activeProvider = createGeminiMarketingLlmProvider();
}

export { resolveGeminiApiKey, DEFAULT_GEMINI_MODEL };
