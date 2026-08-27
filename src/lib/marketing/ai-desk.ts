/**
 * External AI desk — copy whole kit + optional Claude Skill recipe
 * (Wave 4 Phase 3 follow-up). Founder pastes in Claude/ChatGPT themselves.
 * Not SoT. Does not auto-fill kit cards. No Claude/ChatGPT API.
 */

import type { MarketingStage } from "@/lib/constants";
import type { Creative } from "@/lib/marketing/creatives";

export const CLAUDE_CUSTOMIZE_SKILLS_URL =
  "https://claude.ai/customize/skills";

/** Optional Open Claude from Seedance teaching (not an API). */
export const CLAUDE_APP_URL = "https://claude.ai";

export type KitDeskStage = Extract<
  MarketingStage,
  "pre_launch" | "launch" | "weekly_refresh"
>;

export type KitDeskCard = Pick<
  Creative,
  | "format"
  | "hookEn"
  | "hookAr"
  | "captionEn"
  | "captionAr"
  | "shots"
  | "howToShootEn"
  | "howToShootAr"
  | "weekIndex"
  | "weekLabelEn"
  | "weekLabelAr"
  | "scheduleIgnored"
>;

export type SerializeKitForDeskInput = {
  productName: string;
  stage: KitDeskStage;
  cards: readonly KitDeskCard[];
};

function stageLabel(stage: KitDeskStage): string {
  if (stage === "pre_launch") return "pre-launch (warm / soft teasers)";
  if (stage === "launch") return "launch (stock ready, WhatsApp order OK)";
  return "weekly refresh (ongoing selling creatives)";
}

function formatShots(shots: readonly string[]): string[] {
  const lines = shots.map((s) => s.trim()).filter(Boolean);
  if (lines.length === 0) return ["- "];
  return lines.map((s) => `- ${s}`);
}

function formatCard(card: KitDeskCard, postN: number): string {
  const weekLabelEn = card.weekLabelEn.trim();
  const weekLabelAr = card.weekLabelAr.trim();
  const weekBits = [
    `weekIndex ${card.weekIndex}`,
    weekLabelEn || null,
    weekLabelAr || null,
  ].filter(Boolean);
  return [
    `### Post ${postN}`,
    `Week: ${weekBits.join(" · ")}`,
    `Format: ${card.format.trim() || "—"}`,
    `Hook (EN): ${card.hookEn.trim()}`,
    `Hook (AR): ${card.hookAr.trim()}`,
    `Caption (EN): ${card.captionEn.trim()}`,
    `Caption (AR): ${card.captionAr.trim()}`,
    `Shots:`,
    ...formatShots(card.shots),
    `How to shoot (EN): ${card.howToShootEn.trim()}`,
    `How to shoot (AR): ${card.howToShootAr.trim()}`,
  ].join("\n");
}

/**
 * Serialize the kit on screen for paste into Claude / ChatGPT.
 * Non-ignored cards only. No templateIds, source, caps, or file URLs.
 * Empty / all-ignored → null (UI shows a one-line empty state).
 */
export function serializeKitForExternalDesk(
  input: SerializeKitForDeskInput,
): string | null {
  const cards = input.cards.filter((c) => !c.scheduleIgnored);
  if (cards.length === 0) return null;
  const ordered = [...cards].sort((a, b) => a.weekIndex - b.weekIndex);

  const product = input.productName.trim() || "your product";
  const header = [
    `Product: ${product}`,
    `Stage: ${stageLabel(input.stage)}`,
    ``,
  ].join("\n");

  const body = ordered
    .map((card, i) => formatCard(card, i + 1))
    .join("\n\n");
  return `${header}${body}`;
}

/**
 * Shop-wide Claude Skill / ChatGPT saved-instructions recipe.
 * Guardrails only — never bake a product name.
 */
export function buildClaudeSkillRecipe(): string {
  return [
    `You help a Lebanon ecommerce founder with creatives and content angles.`,
    ``,
    `WhatsApp is the order path. Never pitch COD / cash-on-delivery / الدفع عند الاستلام as a wow differentiator.`,
    ``,
    `The founder pastes their kit in the chat. Tighten one post they name (e.g. post 2), or suggest a few angles. Do not invent a full multi-post kit. Do not replace their OS kit.`,
    ``,
    `Do not invent ad budgets, ROAS, margins, or money coaching.`,
    `Do not tell them which marketing stage they should be unlocked for.`,
    `Stay on creatives / angles only.`,
  ].join("\n");
}

export function isKitDeskStage(
  stage: string | null | undefined,
): stage is KitDeskStage {
  return (
    stage === "pre_launch" ||
    stage === "launch" ||
    stage === "weekly_refresh"
  );
}
