/**
 * Gemini fill for Store page copy + discoverability pack (Wave 4 Phase 2).
 */

import {
  resolveGeminiApiKey,
  resolveGeminiModel,
} from "@/lib/discovery/explain/llm";
import {
  buildTemplateStorePageCopy,
  buildTemplateStoreShopPageCopy,
  validateStorePageCopyPayload,
  type StorePageCopyInput,
  type StorePageCopyPayload,
  type StorePageCopyValidateError,
  type StoreShopPageCopyInput,
} from "@/lib/store/page-copy";

export type StorePageCopyLlmError =
  | "missing_key"
  | "api_error"
  | "empty"
  | "parse_error"
  | StorePageCopyValidateError;

export type StorePageCopyLlmResult =
  | { ok: true; payload: StorePageCopyPayload }
  | { ok: false; error: StorePageCopyLlmError };

function stripJsonFence(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  return (fenced?.[1] ?? trimmed).trim();
}

function buildSystemPrompt(): string {
  return `You improve Shopify product page drafts for a Lebanon ecommerce founder (Store side status — not Marketing stages).

HARD RULES
- Return ONLY valid JSON with this shape:
{
  "contentDraftEn": "...",
  "contentDraftAr": "...",
  "policiesDraft": "...",
  "discoverability": {
    "titleEn": "...",
    "titleAr": "...",
    "shortDescriptionEn": "...",
    "shortDescriptionAr": "...",
    "searchPhrasesEn": ["...", "..."],
    "searchPhrasesAr": ["...", "..."],
    "faqs": [{"qEn":"...","aEn":"...","qAr":"...","aAr":"..."}],
    "attractivenessTipsEn": ["...", "..."],
    "attractivenessTipsAr": ["...", "..."]
  }
}
- Tailor to productName / category / differentiation / hooks from the facts. Name the product in contentDraftEn and titleEn.
- contentDraftEn/Ar: founder-ready product page bullets (what it is, why it helps, what's included, delivery window, WhatsApp support). Plain text with • bullets.
- policiesDraft: short shipping / COD ops / returns / damage lines — drafts only, not legal advice. Operational COD mention is OK; never pitch COD as a marketing wow or unique advantage.
- discoverability: paste-ready Shopify SEO helpers — title, short description, 3–6 search phrases EN+AR, 2–4 FAQs, 3–5 attractiveness tips.
- BAN ranking guarantees, “SEO #1”, chatbot citation promises, Google Merchant API claims.
- Keep productName spelling as given (do not translate the name).
- Arabic bodies in clear simplified Arabic; English in clear English.`;
}

function buildShopSystemPrompt(): string {
  return `You improve Shopify homepage / shop-level drafts for a Lebanon ecommerce founder (Store side status — not Marketing stages).

HARD RULES
- Return ONLY valid JSON with this shape:
{
  "contentDraftEn": "...",
  "contentDraftAr": "...",
  "policiesDraft": "...",
  "discoverability": {
    "titleEn": "...",
    "titleAr": "...",
    "shortDescriptionEn": "...",
    "shortDescriptionAr": "...",
    "searchPhrasesEn": ["...", "..."],
    "searchPhrasesAr": ["...", "..."],
    "faqs": [{"qEn":"...","aEn":"...","qAr":"...","aAr":"..."}],
    "attractivenessTipsEn": ["...", "..."],
    "attractivenessTipsAr": ["...", "..."]
  }
}
- This is BRAND / SHOP copy: homepage, shop SEO, shared policy tone. liveSkuNames are catalog context only — do NOT write a single-SKU niche product page, and do NOT invent a fake product named "Whole shop".
- Name the shop (shopName) in contentDraftEn and titleEn.
- contentDraftEn/Ar: founder-ready homepage bullets (what the shop is, catalog snapshot, why visit, delivery window, WhatsApp, shared policies). Plain text with • bullets.
- policiesDraft: short shop-wide shipping / COD ops / returns / damage lines — drafts only, not legal advice. Operational COD mention is OK; never pitch COD as a marketing wow or unique advantage.
- discoverability: paste-ready Shopify helpers for homepage / Online Store preferences / policies — title, short description, 3–6 search phrases EN+AR, 2–4 FAQs, 3–5 attractiveness tips.
- BAN ranking guarantees, “SEO #1”, chatbot citation promises, Google Merchant API claims.
- Keep shopName spelling as given (do not translate the name).
- Arabic bodies in clear simplified Arabic; English in clear English.`;
}

function factsPack(input: StorePageCopyInput) {
  const name = input.name.trim() || "your product";
  return {
    productName: name,
    category: input.category.trim() || "unknown",
    differentiation: input.differentiation?.trim() || null,
    hooks: (input.hooks ?? [])
      .map((h) => h.trim())
      .filter((h) => h && !h.startsWith("@"))
      .slice(0, 5),
    sellPrice:
      input.sellPrice != null && Number.isFinite(input.sellPrice)
        ? input.sellPrice
        : null,
  };
}

function shopFactsPack(input: StoreShopPageCopyInput) {
  const shopName = input.shopName.trim() || "your shop";
  return {
    shopName,
    liveSkuNames: input.liveSkuNames
      .map((n) => n.trim())
      .filter(Boolean)
      .slice(0, 12),
  };
}

type GeminiStoreCopyOpts = {
  fetchFn?: typeof fetch;
  env?: Record<string, string | undefined>;
  apiKey?: string;
};

async function runStorePageCopyGemini(
  facts: Record<string, unknown>,
  systemPrompt: string,
  validateName: string,
  retryLines: string[],
  opts?: GeminiStoreCopyOpts,
): Promise<StorePageCopyLlmResult> {
  const env = opts?.env ?? process.env;
  const apiKey = opts?.apiKey ?? resolveGeminiApiKey(env);
  if (!apiKey) return { ok: false, error: "missing_key" };

  const model = resolveGeminiModel(env);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const fetchFn = opts?.fetchFn ?? fetch;

  const attempt = async (
    retryNote: string | null,
  ): Promise<StorePageCopyLlmResult> => {
    try {
      const res = await fetchFn(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [
            {
              role: "user",
              parts: [
                { text: JSON.stringify(facts) },
                ...(retryNote ? [{ text: retryNote }] : []),
              ],
            },
          ],
          generationConfig: {
            temperature: 0.4,
            maxOutputTokens: 4096,
            thinkingConfig: { thinkingBudget: 0 },
            responseMimeType: "application/json",
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

      let parsed: unknown;
      try {
        parsed = JSON.parse(stripJsonFence(raw));
      } catch {
        return { ok: false, error: "parse_error" };
      }

      const validated = validateStorePageCopyPayload(
        parsed,
        validateName,
        "gemini",
      );
      if (!validated.ok) return { ok: false, error: validated.error };
      return { ok: true, payload: validated.payload };
    } catch {
      return { ok: false, error: "api_error" };
    }
  };

  const first = await attempt(null);
  if (
    first.ok ||
    first.error === "missing_key" ||
    first.error === "api_error"
  ) {
    return first;
  }
  return attempt(retryLines.join("\n"));
}

export async function improveStorePageCopyWithGemini(
  input: StorePageCopyInput,
  opts?: GeminiStoreCopyOpts,
): Promise<StorePageCopyLlmResult> {
  const facts = factsPack(input);
  return runStorePageCopyGemini(
    facts,
    buildSystemPrompt(),
    facts.productName,
    [
      "RETRY — previous JSON was rejected.",
      `Name "${facts.productName}" in contentDraftEn and titleEn.`,
      "No ranking / SEO #1 / chatbot citation promises.",
      "No COD-as-wow pitch. Return valid JSON only.",
    ],
    opts,
  );
}

export async function improveStoreShopPageCopyWithGemini(
  input: StoreShopPageCopyInput,
  opts?: GeminiStoreCopyOpts,
): Promise<StorePageCopyLlmResult> {
  const facts = shopFactsPack(input);
  return runStorePageCopyGemini(
    facts,
    buildShopSystemPrompt(),
    facts.shopName,
    [
      "RETRY — previous JSON was rejected.",
      `Name "${facts.shopName}" in contentDraftEn and titleEn.`,
      "Homepage / shop SEO / shared policies — not a single product page.",
      "Do not invent a product named Whole shop.",
      "No ranking / SEO #1 / chatbot citation promises.",
      "No COD-as-wow pitch. Return valid JSON only.",
    ],
    opts,
  );
}

/** Fail-closed helper: Gemini or deterministic template. */
export async function resolveStorePageCopy(
  input: StorePageCopyInput,
  opts?: {
    fetchFn?: typeof fetch;
    env?: Record<string, string | undefined>;
  },
): Promise<StorePageCopyPayload> {
  const r = await improveStorePageCopyWithGemini(input, opts);
  if (r.ok) return r.payload;
  return buildTemplateStorePageCopy(input);
}

export async function resolveStoreShopPageCopy(
  input: StoreShopPageCopyInput,
  opts?: {
    fetchFn?: typeof fetch;
    env?: Record<string, string | undefined>;
  },
): Promise<StorePageCopyPayload> {
  const r = await improveStoreShopPageCopyWithGemini(input, opts);
  if (r.ok) return r.payload;
  return buildTemplateStoreShopPageCopy(input);
}
