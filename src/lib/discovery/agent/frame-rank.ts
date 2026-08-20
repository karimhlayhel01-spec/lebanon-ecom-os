/**
 * WAVE-2 §14.11 — frame-aware rank on an already accept-ready retrieve set.
 * Cheap storage drops. Audience / differ / unmapped Other / whyNote boost only.
 * Never invents ids or categories. Skills order is the tie-break.
 */

import type { CatalogProduct } from "@/lib/discovery/catalog";
import { classifyOtherIndustry } from "@/lib/discovery/agent/other-industry";
import type {
  AgentAudienceChip,
  AgentDifferChip,
  AgentFrame,
} from "@/lib/discovery/agent/frame";
import type { IndustryOptionId } from "@/lib/constants";

export const CHEAP_STORAGE_NEEDLES = [
  "container",
  "organizer",
  "storage",
  "cable clip",
  "lunch set",
  "علب",
  "منظّم",
  "تخزين",
] as const;

const AUDIENCE_CATEGORIES: Record<
  AgentAudienceChip,
  readonly IndustryOptionId[]
> = {
  myself: [
    "beauty_personal_care",
    "fitness_lifestyle",
    "health_wellness_gadgets",
    "phone_tech_accessories",
  ],
  gifts: ["kids_baby_accessories", "fashion_accessories"],
  households: [
    "home_kitchen",
    "kids_baby_accessories",
    "pet_accessories",
    "car_accessories",
  ],
  creators: ["phone_tech_accessories", "office_desk_gadgets"],
};

const AUDIENCE_WORDS: Record<AgentAudienceChip, readonly string[]> = {
  myself: ["routine", "desk", "self"],
  gifts: ["gift", "gifting", "packaging", "monogram", "هدية"],
  households: ["home", "apartment", "family"],
  creators: ["creator", "reel", "influencer", "demo", "content", "مبدع"],
};

const DIFFER_WORDS: Record<AgentDifferChip, readonly string[]> = {
  demo: ["demo", "reel", "before/after", "clip", "video", "فيديو"],
  bundle: ["bundle", "kit", "set", "pack", "included", "طقم"],
  niche: ["arabic", "local", "ramadan", "niche", "co-brand", "عربي"],
};

export type FrameRankable = {
  p: CatalogProduct;
};

function lower(raw: string): string {
  return raw.toLowerCase();
}

function nameSummaryHaystack(p: CatalogProduct): string {
  return lower(
    [p.en.name, p.en.summary, p.ar.name, p.ar.summary].join("\n"),
  );
}

function fullHaystack(p: CatalogProduct): string {
  return lower(
    [
      p.en.name,
      p.en.summary,
      p.en.differentiation,
      p.ar.name,
      p.ar.summary,
      p.ar.differentiation,
    ].join("\n"),
  );
}

function hitsNeedles(haystack: string, needles: readonly string[]): boolean {
  return needles.some((n) => haystack.includes(lower(n)));
}

export function isCheapStorageDrop(p: CatalogProduct): boolean {
  if (p.storageFootprint === "medium" || p.storageFootprint === "large") {
    return true;
  }
  return hitsNeedles(nameSummaryHaystack(p), CHEAP_STORAGE_NEEDLES);
}

function keywordNeedles(raw: string): string[] {
  const t = raw.trim().toLowerCase();
  if (!t) return [];
  const tokens = t.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3);
  return [...new Set([t, ...tokens])];
}

function audienceBoosts(p: CatalogProduct, chip: AgentAudienceChip): boolean {
  if (AUDIENCE_CATEGORIES[chip].includes(p.category)) return true;
  return hitsNeedles(fullHaystack(p), AUDIENCE_WORDS[chip]);
}

function differBoosts(p: CatalogProduct, chip: AgentDifferChip): boolean {
  return hitsNeedles(fullHaystack(p), DIFFER_WORDS[chip]);
}

function keywordBoosts(p: CatalogProduct, frame: AgentFrame): boolean {
  const needles: string[] = [];
  const other = frame.otherText.trim();
  if (other && classifyOtherIndustry(other).kind === "unmapped") {
    needles.push(...keywordNeedles(other));
  }
  if (frame.whyNote.trim()) {
    needles.push(...keywordNeedles(frame.whyNote));
  }
  if (needles.length === 0) return false;
  return hitsNeedles(fullHaystack(p), needles);
}

function boostScore(p: CatalogProduct, frame: AgentFrame): number {
  let score = 0;
  if (
    frame.audience &&
    frame.audience !== "skipped" &&
    audienceBoosts(p, frame.audience)
  ) {
    score += 4;
  }
  if (
    frame.differ &&
    frame.differ !== "skipped" &&
    differBoosts(p, frame.differ)
  ) {
    score += 2;
  }
  if (keywordBoosts(p, frame)) {
    score += 1;
  }
  return score;
}

/**
 * Frame rank on a skills-retrieved accept-ready list. Boost never removes an
 * id that survived industry + gates + cheap-storage. Does not add ids.
 */
export function applyAgentFrameRank<T extends FrameRankable>(
  scored: readonly T[],
  frame: AgentFrame,
): T[] {
  const kept =
    frame.skipRefuse === "cheap_storage"
      ? scored.filter((row) => !isCheapStorageDrop(row.p))
      : [...scored];
  const origin = new Map(kept.map((row, i) => [row.p.key, i]));
  return kept.sort((a, b) => {
    const delta = boostScore(b.p, frame) - boostScore(a.p, frame);
    if (delta !== 0) return delta;
    return (origin.get(a.p.key) ?? 0) - (origin.get(b.p.key) ?? 0);
  });
}
