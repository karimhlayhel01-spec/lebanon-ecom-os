/**
 * Gemini fill for creative kit copy (Wave 4 Phase 3).
 * Skeleton from buildCreatives; model returns text fields only.
 */

import {
  resolveGeminiApiKey,
  resolveGeminiModel,
} from "@/lib/discovery/explain/llm";
import {
  acceptCreativeFillsPerCard,
  buildCreativesFactsPack,
  parseCreativeTextFills,
  type CreativesValidateError,
} from "@/lib/marketing/creatives-ai";
import {
  launchWeekPhase,
  type BuildCreativesInput,
  type Creative,
} from "@/lib/marketing/creatives";

/** Creatives only — do not change Discovery / Intro token caps. */
export const CREATIVES_GEMINI_MAX_OUTPUT_TOKENS = 16384;

export type CreativesKitLlmError =
  | "missing_key"
  | "api_error"
  | "empty"
  | "parse_error"
  | CreativesValidateError;

export type CreativesKitLlmResult =
  | {
      ok: true;
      creatives: Creative[];
      rejectedIds: string[];
      lastError: CreativesValidateError | null;
    }
  | { ok: false; error: CreativesKitLlmError };

/** Leftover / one-card instruction. Do not weaken SHOT_MIN. */
export function leftoverFillInstruction(): string {
  return "Rewrite hookEn/Ar, angleEn/Ar, captionEn/Ar for the SKU. If you cannot write stronger shots, set shots and howToShootEn/Ar to patternShots / patternHowTo EXACTLY (copy arrays/strings). Include every required key. One id. Valid JSON only.";
}

/** Leftover / one-card retry note. Do not weaken SHOT_MIN. */
export function buildLeftoverRetryNote(args: {
  cards: Creative[];
  lastError?: string | null;
}): string {
  const id = args.cards[0]?.id ?? args.cards.map((c) => c.id).join(", ");
  return `${leftoverFillInstruction()} Id: ${id}.`;
}

/** Leftover-card retry — shots-heavy; do not weaken SHOT_MIN. */
export const CREATIVES_SHOTS_RETRY_NOTE = buildLeftoverRetryNote({
  cards: [],
  lastError: "shots_too_thin",
});

function stripJsonFence(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  return (fenced?.[1] ?? trimmed).trim();
}

function weeklyPlanInstruction(input: BuildCreativesInput): string {
  if (input.stage !== "weekly_refresh") return "";
  const w = Math.max(1, Math.round(input.weeklyWeek ?? 1));
  const phase = launchWeekPhase(w);
  const lines = [
    `This is week ${w} (${phase}).`,
    phase === "open"
      ? "Write this week’s plan: open / stock-here / how-to-order."
      : "Write this week’s plan: convert / proof / new weekly angles — not the week-1 open / stock-here list.",
  ];
  if (input.previousWeekHooks?.length) {
    lines.push(
      `Do not repeat these previous hooks/angles: ${input.previousWeekHooks.join(" | ")}.`,
    );
  }
  return lines.join(" ");
}

function buildSystemPrompt(input: BuildCreativesInput): string {
  const stage = input.stage;
  const pre =
    stage === "pre_launch"
      ? [
          "PRE-LAUNCH RULES (strict): soft teasers only — follow / save / poll / waitlist / when stock lands.",
          "BAN: gift-to-customer angles, buyer-UGC or testimonial-as-proof formats/copy, hard order CTAs, WhatsApp-to-order.",
          "Formats stay as given in the skeleton (never invent ugc/testimonial).",
        ].join(" ")
      : [
          "LAUNCH / WEEKLY REFRESH: WhatsApp order CTAs are OK.",
          "Never pitch COD / cash-on-delivery as a marketing wow.",
          "Do not invent ROAS, margins, or Topic A finance advice.",
        ].join(" ");
  const weekly = weeklyPlanInstruction(input);

  return `You write SKU-tailored creative kit COPY for a Lebanon ecommerce founder (Marketing stage: ${stage}).

HARD RULES
- Return ONLY valid JSON: {"creatives":[{...}, ...]}
- Include EVERY creative id from the skeleton exactly once — same count, same ids.
- Do NOT change: id, format, weekIndex, weekLabelEn/Ar, suggestedDay, suggestedTimeBand, scheduleIgnored.
- Fill only: hookEn/Ar, angleEn/Ar, captionEn/Ar, shots (3–5 elaborated strings), howToShootEn/Ar, seriesLabelEn/Ar, whyEn/Ar.
- Name productName in EN hooks/angles/captions for this SKU. Keep productName spelling as given (do not translate the name).
- Tailor to niche/world from facts. Hook-first (first 1–3 seconds).
- SHOTS (required): each line is actionable filming guidance — what we see, camera/framing/duration hint, action, optional on-screen text/audio. Example style: "0–3s | Phone vertical close-up: … — hold steady, window light." Not thin one-liners.
- howToShootEn/Ar: short calm summary — phone setup, light, length, shoot shots in order. Plain founder language. No OS / Topic A / unlocks / ROAS / COD-as-wow.
- ${pre}
${weekly ? `- ${weekly}\n` : ""}- BAN COD / cash-on-delivery / الدفع عند الاستلام as a wow differentiator.
- BAN ROAS, ad spend advice, unlock language, stage gates.
- Arabic in clear simplified Arabic; English clear and concrete.`;
}

function skeletonPayload(skeleton: Creative[]) {
  return skeleton.map((c) => ({
    id: c.id,
    format: c.format,
    weekIndex: c.weekIndex,
    weekLabelEn: c.weekLabelEn,
    weekLabelAr: c.weekLabelAr,
    suggestedDay: c.suggestedDay,
    suggestedTimeBand: c.suggestedTimeBand,
    // Hints only — model must rewrite, not echo blindly.
    templateHintEn: c.hookEn.slice(0, 80),
  }));
}

/** Leftover / one-card skeleton — draft example + built-in shot patterns. */
export function leftoverSkeletonPayload(skeleton: Creative[]) {
  return skeleton.map((c) => ({
    id: c.id,
    format: c.format,
    weekIndex: c.weekIndex,
    weekLabelEn: c.weekLabelEn,
    weekLabelAr: c.weekLabelAr,
    suggestedDay: c.suggestedDay,
    suggestedTimeBand: c.suggestedTimeBand,
    patternShots: c.shots,
    patternHowToEn: c.howToShootEn,
    patternHowToAr: c.howToShootAr,
    exampleCreative: {
      id: c.id,
      hookEn: c.hookEn,
      hookAr: c.hookAr,
      angleEn: c.angleEn,
      angleAr: c.angleAr,
      captionEn: c.captionEn,
      captionAr: c.captionAr,
      shots: c.shots,
      howToShootEn: c.howToShootEn,
      howToShootAr: c.howToShootAr,
      seriesLabelEn: c.seriesLabelEn,
      seriesLabelAr: c.seriesLabelAr,
      whyEn: c.whyEn,
      whyAr: c.whyAr,
    },
  }));
}

function creativesUserPayload(
  facts: ReturnType<typeof buildCreativesFactsPack>,
  skeleton: Creative[],
) {
  return { facts, skeleton: skeletonPayload(skeleton) };
}

export async function fillCreativesKitWithGemini(
  input: BuildCreativesInput,
  skeleton: Creative[],
  opts?: {
    fetchFn?: typeof fetch;
    env?: Record<string, string | undefined>;
    apiKey?: string;
    retryNote?: string;
  },
): Promise<CreativesKitLlmResult> {
  const env = opts?.env ?? process.env;
  const apiKey = opts?.apiKey ?? resolveGeminiApiKey(env);
  if (!apiKey) return { ok: false, error: "missing_key" };
  if (!skeleton.length) return { ok: false, error: "invalid_shape" };

  const facts = buildCreativesFactsPack(input);
  const model = resolveGeminiModel(env);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const fetchFn = opts?.fetchFn ?? fetch;

  const attempt = async (
    retryNote: string | null,
  ): Promise<CreativesKitLlmResult> => {
    try {
      const res = await fetchFn(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: buildSystemPrompt(input) }],
          },
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: JSON.stringify(creativesUserPayload(facts, skeleton)),
                },
                ...(retryNote ? [{ text: retryNote }] : []),
              ],
            },
          ],
          generationConfig: {
            temperature: 0.45,
            maxOutputTokens: CREATIVES_GEMINI_MAX_OUTPUT_TOKENS,
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

      const fills = parseCreativeTextFills(parsed);
      if (!fills) return { ok: false, error: "parse_error" };

      const accepted = acceptCreativeFillsPerCard(
        skeleton,
        fills,
        input.stage,
        facts.productName,
      );
      return {
        ok: true,
        creatives: accepted.accepted,
        rejectedIds: accepted.rejectedIds,
        lastError: accepted.lastError,
      };
    } catch {
      return { ok: false, error: "api_error" };
    }
  };

  const first = await attempt(opts?.retryNote ?? null);
  if (
    first.ok ||
    first.error === "missing_key" ||
    first.error === "api_error"
  ) {
    return first;
  }
  return attempt(
    [
      "RETRY — previous JSON was rejected.",
      `Include every id exactly once: ${skeleton.map((c) => c.id).join(", ")}.`,
      `Name "${facts.productName}" in EN hooks/angles/captions.`,
      input.stage === "pre_launch"
        ? "Pre-launch: soft CTAs only — no gift, UGC proof, or WhatsApp order."
        : "No COD-as-wow. No ROAS/finance advice.",
      "Elaborate each shot (see / camera / action). Include howToShootEn and howToShootAr.",
      "Return valid JSON only.",
    ].join("\n"),
  );
}
