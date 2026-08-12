/**
 * Optional Gemini polish for visual-tool why/prompt (Wave 4 Phase 5).
 * Tool routing stays skills-owned. Fail-closed → caller keeps skills defaults.
 */

import {
  resolveGeminiApiKey,
  resolveGeminiModel,
} from "@/lib/discovery/explain/llm";
import {
  suggestCreativeVisualTool,
  validateVisualSuggestion,
  type CreativeVisualSuggestion,
  type SuggestCreativeVisualToolInput,
} from "@/lib/marketing/visual-tool";

export type VisualToolLlmResult =
  | { ok: true; suggestion: CreativeVisualSuggestion; source: "gemini" }
  | { ok: false; error: "missing_key" | "api_error" | "empty" | "parse_error" | "invalid" };

function stripJsonFence(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  return (fenced?.[1] ?? trimmed).trim();
}

/**
 * Polish why + prompt only. Never changes `tool` (skills routing).
 */
export async function polishCreativeVisualSuggestionWithGemini(
  input: SuggestCreativeVisualToolInput,
  opts?: {
    fetchFn?: typeof fetch;
    env?: Record<string, string | undefined>;
    apiKey?: string;
  },
): Promise<VisualToolLlmResult> {
  const env = opts?.env ?? process.env;
  const apiKey = opts?.apiKey ?? resolveGeminiApiKey(env);
  if (!apiKey) return { ok: false, error: "missing_key" };

  const baseline = suggestCreativeVisualTool(input);
  const model = resolveGeminiModel(env);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const fetchFn = opts?.fetchFn ?? fetch;
  const name = input.productName.trim() || "your product";

  try {
    const res = await fetchFn(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: {
          parts: [
            {
              text: `You polish founder-facing copy for an external visual tool prompt.
Return ONLY JSON: {"whyEn":"...","whyAr":"...","promptEn":"...","promptAr":"..."}.
Keep tool choice fixed as "${baseline.tool}" — do not change it.
Name product "${name}" in promptEn. No Lebanon Ecom OS, Topic A, unlocks, capacity, ROAS, or COD-as-wow.
Plain founder language. Keep prompts practical and short.`,
            },
          ],
        },
        contents: [
          {
            role: "user",
            parts: [
              {
                text: JSON.stringify({
                  tool: baseline.tool,
                  productName: name,
                  stage: input.stage,
                  format: input.creative.format,
                  baseline,
                }),
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.35,
          maxOutputTokens: 2048,
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
    if (!parsed || typeof parsed !== "object") {
      return { ok: false, error: "parse_error" };
    }
    const o = parsed as Record<string, unknown>;
    if (
      typeof o.whyEn !== "string" ||
      typeof o.whyAr !== "string" ||
      typeof o.promptEn !== "string" ||
      typeof o.promptAr !== "string"
    ) {
      return { ok: false, error: "parse_error" };
    }

    const suggestion: CreativeVisualSuggestion = {
      tool: baseline.tool,
      whyEn: o.whyEn.trim(),
      whyAr: o.whyAr.trim(),
      promptEn: o.promptEn.trim(),
      promptAr: o.promptAr.trim(),
    };
    if (!validateVisualSuggestion(suggestion, name)) {
      return { ok: false, error: "invalid" };
    }
    return { ok: true, suggestion, source: "gemini" };
  } catch {
    return { ok: false, error: "api_error" };
  }
}
