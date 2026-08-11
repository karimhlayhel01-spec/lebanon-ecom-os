/**
 * External AI desk — copyable Claude/ChatGPT role prompts (Wave 4 Phase 3).
 * Differentiated from in-OS Gemini kit: tighten one pasted creative, or plan
 * angles/tests — never generate another full multi-post kit. Paste-out text
 * stays founder-facing (no OS product meta).
 */

import type { MarketingStage } from "@/lib/constants";
import { nicheFor, usefulHookLine } from "@/lib/marketing/brief";

export type AiDeskPrompt = {
  id: "rewrite" | "strategy";
  titleKey: "deskRewriteTitle" | "deskStrategyTitle";
  body: string;
};

/** Optional fields from one kit card to pre-fill the rewrite paste block. */
export type AiDeskCreativeSnippet = {
  hookEn?: string;
  hookAr?: string;
  captionEn?: string;
  captionAr?: string;
  shots?: string[];
};

export type AiDeskInput = {
  productName: string;
  category: string;
  stage: Extract<
    MarketingStage,
    "pre_launch" | "launch" | "monthly_refresh"
  >;
  differentiation?: string;
  hooks?: string[];
  /** When set, pre-fills PASTE_YOUR_CREATIVE_HERE with this card’s copy. */
  creative?: AiDeskCreativeSnippet;
  locale?: "en" | "ar";
};

export const PASTE_CREATIVE_MARKER = "PASTE_YOUR_CREATIVE_HERE";

function stageLabel(stage: AiDeskInput["stage"]): string {
  if (stage === "pre_launch") return "pre-launch (warm / soft teasers)";
  if (stage === "launch") return "launch (stock ready, WhatsApp order OK)";
  return "weekly refresh (ongoing selling creatives)";
}

function stageRules(stage: AiDeskInput["stage"]): string {
  if (stage === "pre_launch") {
    return [
      "- Soft CTAs only: follow, save, poll, waitlist, when stock lands.",
      "- No gift-to-customer angles, no buyer-UGC/testimonial-as-proof, no hard order / WhatsApp-to-buy.",
      "- Never pitch COD / cash-on-delivery as a marketing wow.",
    ].join("\n");
  }
  return [
    "- WhatsApp is the order path; never pitch COD as a wow differentiator.",
    "- No finance / margin / ROAS advice — creatives and content angles only.",
    "- Hook-first (first 1–3 seconds); niche-consistent.",
  ].join("\n");
}

const SHARED_GUARDRAILS = [
  "- You help with creatives / content angles only.",
  "- Do not invent ad budgets, ROAS, margins, or money coaching.",
  '- Do not tell the founder which marketing stage they "should" be unlocked for.',
  "- Never pitch COD as a wow.",
].join("\n");

function formatPasteBlock(creative?: AiDeskCreativeSnippet): string {
  const hookEn = creative?.hookEn?.trim() ?? "";
  const hookAr = creative?.hookAr?.trim() ?? "";
  const captionEn = creative?.captionEn?.trim() ?? "";
  const captionAr = creative?.captionAr?.trim() ?? "";
  const shots = (creative?.shots ?? [])
    .map((s) => s.trim())
    .filter(Boolean);
  const hasAny = Boolean(hookEn || hookAr || captionEn || captionAr || shots.length);

  if (!hasAny) {
    return [
      `<<< ${PASTE_CREATIVE_MARKER}`,
      `Hook (EN):`,
      `Hook (AR):`,
      `Caption (EN):`,
      `Caption (AR):`,
      `Shots:`,
      `- `,
      `- `,
      `>>>`,
    ].join("\n");
  }

  return [
    `<<< ${PASTE_CREATIVE_MARKER}`,
    `Hook (EN): ${hookEn}`,
    `Hook (AR): ${hookAr}`,
    `Caption (EN): ${captionEn}`,
    `Caption (AR): ${captionAr}`,
    `Shots:`,
    ...(shots.length ? shots.map((s) => `- ${s}`) : ["- ", "- "]),
    `>>>`,
  ].join("\n");
}

/**
 * Build 2 copyable role prompts for Claude / ChatGPT (founder pastes externally).
 * Not a second kit generator — rewrite one post or plan weekly angles.
 */
export function buildExternalAiDeskPrompts(input: AiDeskInput): AiDeskPrompt[] {
  const name = input.productName.trim() || "your product";
  const category = input.category.trim() || "unknown";
  const niche = nicheFor(category);
  const hook = usefulHookLine(input.hooks, name);
  const diff = input.differentiation?.trim();
  const stage = stageLabel(input.stage);
  const rules = stageRules(input.stage);

  const facts = [
    `Product: ${name}`,
    `Category: ${category}`,
    `Niche world: ${niche.worldEn}`,
    `Marketing stage: ${stage}`,
    hook ? `Hook angle: ${hook}` : null,
    diff ? `Differentiation: ${diff}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const pasteBlock = formatPasteBlock(input.creative);

  const rewrite = [
    `You are a rewrite helper for a Lebanon ecommerce founder.`,
    `Tighten ONE creative the founder pastes below — same idea, sharper hook/caption/shots.`,
    `Do not invent a full multi-post kit.`,
    ``,
    `FACTS`,
    facts,
    ``,
    `THE CREATIVE TO TIGHTEN`,
    pasteBlock,
    `(Replace the block above if empty — paste your hook, caption, and shots.)`,
    ``,
    `TASK`,
    `Give 2–3 caption/hook alternates for that same idea (EN + AR). Optionally refine the shot list for the same concept.`,
    `Keep product name spelling exactly: "${name}".`,
    `Do not invent a full kit, unrelated new posts, or a week of creatives.`,
    ``,
    `RULES`,
    SHARED_GUARDRAILS,
    rules,
    `- Never pitch COD / الدفع عند الاستلام as a differentiator.`,
    `- Stay niche-consistent (${niche.worldEn}).`,
  ].join("\n");

  const strategy = [
    `You are a weekly content-planning helper for a Lebanon ecommerce founder.`,
    `Help with angles, small tests, and reply/DM tips only — not a second creative kit.`,
    ``,
    `FACTS`,
    facts,
    ``,
    `TASK`,
    `For ${name} at stage "${stage}", suggest:`,
    `- 5 short weekly angle / test ideas (one-line each: format hint + why it fits this niche).`,
    `- 3 comment-reply / DM clarity tips.`,
    `EN + short AR labels for each idea title is fine.`,
    ``,
    `DO NOT`,
    `- Write full captions or full hook scripts.`,
    `- Write shot lists.`,
    `- Deliver 5 complete posts like a creative kit.`,
    ``,
    `RULES`,
    SHARED_GUARDRAILS,
    rules,
    `- No ROAS targets, ad budget prescriptions, or “you will rank #1” claims.`,
    `- Don’t invent unlock timelines or paid-ads mandates.`,
  ].join("\n");

  return [
    { id: "rewrite", titleKey: "deskRewriteTitle", body: rewrite },
    { id: "strategy", titleKey: "deskStrategyTitle", body: strategy },
  ];
}
