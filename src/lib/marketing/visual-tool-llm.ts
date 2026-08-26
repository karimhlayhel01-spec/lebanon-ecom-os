/**
 * Optional Gemini polish for visual-tool why/prompt (Wave 4 Phase 5).
 * Tool routing stays skills-owned. Fail-closed → caller keeps skills defaults.
 */

import {
  resolveGeminiApiKey,
  resolveGeminiModel,
} from "@/lib/discovery/explain/llm";
import {
  checkMarketingGeminiAllowance,
  recordMarketingGeminiCalls,
} from "@/lib/marketing/marketing-gemini-usage";
import {
  nanoVisualHabitat,
  suggestCreativeVisualTool,
  validateVisualSuggestion,
  type CreativeVisualSuggestion,
  type SuggestCreativeVisualToolInput,
} from "@/lib/marketing/visual-tool";

export type VisualToolLlmResult =
  | { ok: true; suggestion: CreativeVisualSuggestion; source: "gemini" }
  | {
      ok: false;
      error:
        | "missing_key"
        | "api_error"
        | "empty"
        | "parse_error"
        | "invalid"
        | "monthly_cap";
    };

function stripJsonFence(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  return (fenced?.[1] ?? trimmed).trim();
}

/**
 * Polish why + prompt only. Never changes `tool` (skills routing).
 * When `workspaceId` is set, respects Marketing Gemini monthly cap and records
 * a successful call. Store pack is not metered here.
 */
export async function polishCreativeVisualSuggestionWithGemini(
  input: SuggestCreativeVisualToolInput,
  opts?: {
    fetchFn?: typeof fetch;
    env?: Record<string, string | undefined>;
    apiKey?: string;
    workspaceId?: string;
  },
): Promise<VisualToolLlmResult> {
  const env = opts?.env ?? process.env;
  const apiKey = opts?.apiKey ?? resolveGeminiApiKey(env);
  if (!apiKey) return { ok: false, error: "missing_key" };

  if (opts?.workspaceId) {
    const allowance = await checkMarketingGeminiAllowance(
      opts.workspaceId,
      env,
    );
    if (!allowance.ok) return { ok: false, error: "monthly_cap" };
  }

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
Plain founder language. Keep prompts practical and short.
If tool is nano_banana: one photograph only (not a grid, collage, moodboard, or multi-panel). Hook is mood, not overlay text. Product-only: no hands, no faces, no people. True-to-life scale (not fill-frame, giant, or monumental). Setting from category habitat + pack photos + this card's beat. Rings that charge go in the charging case, never a dinner plate. Indoor product setting — no village or postcard landscape. Do not invent mug, tea, plate, book, or phone as scale props. Pack photos are look and scale. No letters, words, slogans, watermarks, logos, app UI, or captions on the image. Do not restore a full slide list, "shoot N frames" how-to, text overlays, 0–3s film beats, or hand/face action. Output is a short visual brief only — no WAVE, LOCKED, or OS meta.
If tool is seedance: one short motion clip (not a grid or collage). Same habitat, charging-case, no-village, no-kitchenware, no-hands, no-slogan-on-frames rules as nano_banana. Hook is mood/action, not overlay text. Pack photos are look and scale. Output is a short video brief only — no WAVE, LOCKED, or OS meta.`,
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
                  category: input.category ?? "",
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
    if (opts?.workspaceId) {
      await recordMarketingGeminiCalls({
        workspaceId: opts.workspaceId,
        calls: 1,
      });
    }
    return { ok: true, suggestion, source: "gemini" };
  } catch {
    return { ok: false, error: "api_error" };
  }
}

const NANO_BRIEF_SYSTEM = `You rewrite a Lebanon ecommerce kit shot list into a Higgsfield Nano Banana still prompt.
Think like an Ask agent writing a Build prompt for an IMAGE model.
SoT for the beat: this card's hook, full shots, how-to, pack photos (look and scale), and categoryHabitat.
Do NOT copy film-plan sentences. Do NOT put WAVE, LOCKED, dates, caps, fail-closed, or OS names in the output.
Return ONLY JSON: {"promptEn":"...","promptAr":"..."}.
promptEn/promptAr are short visual briefs: product name, true-to-life scale, light, where it sits, visual don'ts as scene facts.
Rules (use while writing; do not paste this meta into the prompts):
- One photograph only. No grid, collage, moodboard, or multi-panel.
- Hook is mood, not overlay text. No letters, words, slogans, watermarks, logos, app UI, or captions on the image. Product engraving on the item is fine.
- No hands, no faces, no people. No "text overlay", no 0–3s timings, no "shoot N frames", no slide 2–5 dumps, no hand/finger/placing action.
- True-to-life scale: real object size. Rings are jewelry-small as sold — not giant, not filling the frame, not a sculpture. Do not write "product large in frame" or "fill frame".
- Habitat: use categoryHabitat. Pack photos win if they conflict. Do not put a ring charging case on a lamp, pan, or other non-ring SKU.
- If this SKU is a ring / RingConn / smart ring: the ring sits in its charging case or dock (from pack photos). Never a dinner plate, saucer, or kitchen dish.
- Indoor / product setting from habitat. No village, countryside, travel postcard, mountain town, souk, or wide scenic landscape.
- Do not invent mug, tea, plate, book, or phone as scale props.
- Name the product exactly as given. No Lebanon Ecom OS, Topic A, unlocks, capacity, ROAS, or COD-as-wow.`;

const SEEDANCE_BRIEF_SYSTEM = `You rewrite a Lebanon ecommerce kit shot list into a Higgsfield Seedance motion prompt.
Think like an Ask agent writing a Build prompt for a VIDEO model.
SoT for the beat: this card's hook, full shots, how-to, pack photos (look and scale), and categoryHabitat.
Do NOT copy film-plan sentences verbatim. Do NOT put WAVE, LOCKED, dates, caps, fail-closed, or OS names in the output.
Return ONLY JSON: {"promptEn":"...","promptAr":"..."}.
promptEn/promptAr are short video briefs: product name, true-to-life scale, light, where it sits, simple camera/motion, visual don'ts as scene facts.
Rules (use while writing; do not paste this meta into the prompts):
- One short motion clip (reel/story). No grid, collage, moodboard, or multi-panel.
- Hook is mood/action, not overlay text. No letters, words, slogans, watermarks, logos, app UI, or captions on the frames. Product engraving on the item is fine.
- No hands, no faces, no people. No "text overlay", no "shoot N frames" how-to dump, no slide 2–5 dumps, no hand/finger/placing action.
- True-to-life scale: real object size. Not giant, not filling the frame, not a sculpture.
- Habitat: use categoryHabitat. Pack photos win if they conflict. Do not put a ring charging case on a lamp, pan, or other non-ring SKU.
- If this SKU is a ring / RingConn / smart ring: the ring sits in its charging case or dock (from pack photos). Never a dinner plate, saucer, or kitchen dish.
- Indoor / product setting from habitat. No village, countryside, travel postcard, mountain town, souk, or wide scenic landscape.
- Do not invent mug, tea, plate, book, or phone as scale props.
- Name the product exactly as given. No Lebanon Ecom OS, Topic A, unlocks, capacity, ROAS, or COD-as-wow.`;

export async function engineerNanoHiggsfieldBriefWithGemini(
  input: SuggestCreativeVisualToolInput,
  opts?: {
    fetchFn?: typeof fetch;
    env?: Record<string, string | undefined>;
    apiKey?: string;
    workspaceId?: string;
  },
): Promise<
  | { ok: true; promptEn: string; promptAr: string; source: "gemini" }
  | {
      ok: false;
      error:
        | "missing_key"
        | "api_error"
        | "empty"
        | "parse_error"
        | "invalid"
        | "monthly_cap"
        | "skipped";
    }
> {
  const baseline = suggestCreativeVisualTool(input);
  if (baseline.tool !== "nano_banana") {
    return { ok: false, error: "skipped" };
  }

  const env = opts?.env ?? process.env;
  const apiKey = opts?.apiKey ?? resolveGeminiApiKey(env);
  if (!apiKey) return { ok: false, error: "missing_key" };

  if (opts?.workspaceId) {
    const allowance = await checkMarketingGeminiAllowance(
      opts.workspaceId,
      env,
    );
    if (!allowance.ok) return { ok: false, error: "monthly_cap" };
  }

  const name = input.productName.trim() || "your product";
  const habitat = nanoVisualHabitat({
    category: input.category ?? "",
    productName: name,
    hook:
      input.creative.hookEn?.trim() ||
      input.creative.angleEn?.trim() ||
      name,
    shots: input.creative.shots ?? [],
  });
  const model = resolveGeminiModel(env);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const fetchFn = opts?.fetchFn ?? fetch;

  try {
    const res = await fetchFn(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: NANO_BRIEF_SYSTEM }] },
        contents: [
          {
            role: "user",
            parts: [
              {
                text: JSON.stringify({
                  productName: name,
                  category: input.category ?? "",
                  categoryHabitatEn: habitat.en,
                  categoryHabitatAr: habitat.ar,
                  stage: input.stage,
                  format: input.creative.format,
                  hookEn: input.creative.hookEn,
                  hookAr: input.creative.hookAr,
                  shots: input.creative.shots,
                  howToShootEn: input.creative.howToShootEn,
                  howToShootAr: input.creative.howToShootAr,
                  skillsFallbackPromptEn: baseline.promptEn,
                }),
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.25,
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
    if (typeof o.promptEn !== "string" || typeof o.promptAr !== "string") {
      return { ok: false, error: "parse_error" };
    }
    const promptEn = o.promptEn.trim();
    const promptAr = o.promptAr.trim();
    const suggestion: CreativeVisualSuggestion = {
      tool: "nano_banana",
      whyEn: baseline.whyEn,
      whyAr: baseline.whyAr,
      promptEn,
      promptAr,
    };
    if (!validateVisualSuggestion(suggestion, name)) {
      return { ok: false, error: "invalid" };
    }
    if (opts?.workspaceId) {
      await recordMarketingGeminiCalls({
        workspaceId: opts.workspaceId,
        calls: 1,
      });
    }
    return { ok: true, promptEn, promptAr, source: "gemini" };
  } catch {
    return { ok: false, error: "api_error" };
  }
}

export async function resolveNanoHiggsfieldPrompt(
  input: SuggestCreativeVisualToolInput,
  opts?: {
    fetchFn?: typeof fetch;
    env?: Record<string, string | undefined>;
    apiKey?: string;
    workspaceId?: string;
  },
): Promise<{
  promptEn: string;
  promptAr: string;
  source: "gemini" | "skills";
  honesty: null | "monthly_cap" | "api_error";
}> {
  const skills = suggestCreativeVisualTool(input);
  if (skills.tool !== "nano_banana") {
    return {
      promptEn: skills.promptEn,
      promptAr: skills.promptAr,
      source: "skills",
      honesty: null,
    };
  }
  const engineered = await engineerNanoHiggsfieldBriefWithGemini(input, opts);
  if (engineered.ok) {
    return {
      promptEn: engineered.promptEn,
      promptAr: engineered.promptAr,
      source: "gemini",
      honesty: null,
    };
  }
  const honesty =
    engineered.error === "monthly_cap"
      ? "monthly_cap"
      : engineered.error === "skipped"
        ? null
        : "api_error";
  return {
    promptEn: skills.promptEn,
    promptAr: skills.promptAr,
    source: "skills",
    honesty,
  };
}

export async function engineerSeedanceHiggsfieldBriefWithGemini(
  input: SuggestCreativeVisualToolInput,
  opts?: {
    fetchFn?: typeof fetch;
    env?: Record<string, string | undefined>;
    apiKey?: string;
    workspaceId?: string;
  },
): Promise<
  | { ok: true; promptEn: string; promptAr: string; source: "gemini" }
  | {
      ok: false;
      error:
        | "missing_key"
        | "api_error"
        | "empty"
        | "parse_error"
        | "invalid"
        | "monthly_cap"
        | "skipped";
    }
> {
  const baseline = suggestCreativeVisualTool(input);
  if (baseline.tool !== "seedance") {
    return { ok: false, error: "skipped" };
  }

  const env = opts?.env ?? process.env;
  const apiKey = opts?.apiKey ?? resolveGeminiApiKey(env);
  if (!apiKey) return { ok: false, error: "missing_key" };

  if (opts?.workspaceId) {
    const allowance = await checkMarketingGeminiAllowance(
      opts.workspaceId,
      env,
    );
    if (!allowance.ok) return { ok: false, error: "monthly_cap" };
  }

  const name = input.productName.trim() || "your product";
  const habitat = nanoVisualHabitat({
    category: input.category ?? "",
    productName: name,
    hook:
      input.creative.hookEn?.trim() ||
      input.creative.angleEn?.trim() ||
      name,
    shots: input.creative.shots ?? [],
  });
  const model = resolveGeminiModel(env);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const fetchFn = opts?.fetchFn ?? fetch;

  try {
    const res = await fetchFn(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SEEDANCE_BRIEF_SYSTEM }] },
        contents: [
          {
            role: "user",
            parts: [
              {
                text: JSON.stringify({
                  productName: name,
                  category: input.category ?? "",
                  categoryHabitatEn: habitat.en,
                  categoryHabitatAr: habitat.ar,
                  stage: input.stage,
                  format: input.creative.format,
                  hookEn: input.creative.hookEn,
                  hookAr: input.creative.hookAr,
                  shots: input.creative.shots,
                  howToShootEn: input.creative.howToShootEn,
                  howToShootAr: input.creative.howToShootAr,
                  skillsFallbackPromptEn: baseline.promptEn,
                }),
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.25,
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
    if (typeof o.promptEn !== "string" || typeof o.promptAr !== "string") {
      return { ok: false, error: "parse_error" };
    }
    const promptEn = o.promptEn.trim();
    const promptAr = o.promptAr.trim();
    const suggestion: CreativeVisualSuggestion = {
      tool: "seedance",
      whyEn: baseline.whyEn,
      whyAr: baseline.whyAr,
      promptEn,
      promptAr,
    };
    if (!validateVisualSuggestion(suggestion, name)) {
      return { ok: false, error: "invalid" };
    }
    if (opts?.workspaceId) {
      await recordMarketingGeminiCalls({
        workspaceId: opts.workspaceId,
        calls: 1,
      });
    }
    return { ok: true, promptEn, promptAr, source: "gemini" };
  } catch {
    return { ok: false, error: "api_error" };
  }
}

export async function resolveSeedanceHiggsfieldPrompt(
  input: SuggestCreativeVisualToolInput,
  opts?: {
    fetchFn?: typeof fetch;
    env?: Record<string, string | undefined>;
    apiKey?: string;
    workspaceId?: string;
  },
): Promise<{
  promptEn: string;
  promptAr: string;
  source: "gemini" | "skills";
  honesty: null | "monthly_cap" | "api_error";
}> {
  const skills = suggestCreativeVisualTool(input);
  if (skills.tool !== "seedance") {
    return {
      promptEn: skills.promptEn,
      promptAr: skills.promptAr,
      source: "skills",
      honesty: null,
    };
  }
  const engineered = await engineerSeedanceHiggsfieldBriefWithGemini(
    input,
    opts,
  );
  if (engineered.ok) {
    return {
      promptEn: engineered.promptEn,
      promptAr: engineered.promptAr,
      source: "gemini",
      honesty: null,
    };
  }
  const honesty =
    engineered.error === "monthly_cap"
      ? "monthly_cap"
      : engineered.error === "skipped"
        ? null
        : "api_error";
  return {
    promptEn: skills.promptEn,
    promptAr: skills.promptAr,
    source: "skills",
    honesty,
  };
}


