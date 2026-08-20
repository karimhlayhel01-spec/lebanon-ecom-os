/**
 * WAVE-2 §14 PR2 — session ask frame (chips, not a transcript).
 * Intro-seen lives on the onboarding profile; this JSON is session-scoped.
 */

import {
  INDUSTRY_OPTIONS,
  type IndustryOptionId,
} from "@/lib/constants";
import {
  classifyOtherIndustry,
  isOtherDontDeal,
  resolveOtherRetrieveIndustry,
} from "@/lib/discovery/agent/other-industry";

export const AGENT_OTHER_MAX_CHARS = 80;

export const AGENT_ASK_STEPS = [
  "sell",
  "skipRefuse",
  "audience",
  "differ",
] as const;

export type AgentAskStepId = (typeof AGENT_ASK_STEPS)[number];

export const AGENT_SKIP_REFUSE_CHIPS = ["cheap_storage"] as const;
export const AGENT_AUDIENCE_CHIPS = [
  "myself",
  "gifts",
  "households",
  "creators",
] as const;
export const AGENT_DIFFER_CHIPS = ["demo", "bundle", "niche"] as const;

export type AgentSkipRefuseChip = (typeof AGENT_SKIP_REFUSE_CHIPS)[number];
export type AgentAudienceChip = (typeof AGENT_AUDIENCE_CHIPS)[number];
export type AgentDifferChip = (typeof AGENT_DIFFER_CHIPS)[number];

export const AGENT_WHY_CHIPS = ["not_convinced", "keep_looking"] as const;
export type AgentWhyChip = (typeof AGENT_WHY_CHIPS)[number];

export type AgentFrame = {
  askStep: number;
  industryIds: IndustryOptionId[];
  otherText: string;
  skipRefuse: AgentSkipRefuseChip | "skipped" | null;
  audience: AgentAudienceChip | "skipped" | null;
  differ: AgentDifferChip | "skipped" | null;
  /** PR3 — re-ask after not_convinced or 6th Explore more. Skip is forbidden. */
  narrowing: boolean;
  /** PR3 — why card is showing (after Explore more, before retrieve/narrow). */
  whyPending: boolean;
  whyExplore: AgentWhyChip | null;
  whyNote: string;
};

export const EMPTY_AGENT_FRAME: AgentFrame = {
  askStep: 0,
  industryIds: [],
  otherText: "",
  skipRefuse: null,
  audience: null,
  differ: null,
  narrowing: false,
  whyPending: false,
  whyExplore: null,
  whyNote: "",
};

const INDUSTRY_SET = new Set<string>(INDUSTRY_OPTIONS);

function isIndustryId(raw: string): raw is IndustryOptionId {
  return INDUSTRY_SET.has(raw);
}

function isSkipRefuse(
  raw: string,
): raw is AgentSkipRefuseChip | "skipped" {
  return (
    raw === "skipped" ||
    (AGENT_SKIP_REFUSE_CHIPS as readonly string[]).includes(raw)
  );
}

function isAudience(raw: string): raw is AgentAudienceChip | "skipped" {
  return (
    raw === "skipped" ||
    (AGENT_AUDIENCE_CHIPS as readonly string[]).includes(raw)
  );
}

function isDiffer(raw: string): raw is AgentDifferChip | "skipped" {
  return (
    raw === "skipped" ||
    (AGENT_DIFFER_CHIPS as readonly string[]).includes(raw)
  );
}

function isWhyChip(raw: string): raw is AgentWhyChip {
  return (AGENT_WHY_CHIPS as readonly string[]).includes(raw);
}

export function parseAgentFrame(raw: string | null | undefined): AgentFrame {
  if (!raw || !raw.trim()) return { ...EMPTY_AGENT_FRAME };
  try {
    const parsed = JSON.parse(raw) as Partial<AgentFrame>;
    const industryIds = Array.isArray(parsed.industryIds)
      ? parsed.industryIds.filter(
          (id): id is IndustryOptionId =>
            typeof id === "string" && isIndustryId(id),
        )
      : [];
    const askStep =
      typeof parsed.askStep === "number" && Number.isFinite(parsed.askStep)
        ? Math.max(0, Math.min(AGENT_ASK_STEPS.length, Math.floor(parsed.askStep)))
        : 0;
    const otherText =
      typeof parsed.otherText === "string"
        ? parsed.otherText.trim().slice(0, AGENT_OTHER_MAX_CHARS)
        : "";
    return {
      askStep,
      industryIds,
      otherText,
      skipRefuse:
        typeof parsed.skipRefuse === "string" && isSkipRefuse(parsed.skipRefuse)
          ? parsed.skipRefuse
          : null,
      audience:
        typeof parsed.audience === "string" && isAudience(parsed.audience)
          ? parsed.audience
          : null,
      differ:
        typeof parsed.differ === "string" && isDiffer(parsed.differ)
          ? parsed.differ
          : null,
      narrowing: parsed.narrowing === true,
      whyPending: parsed.whyPending === true,
      whyExplore:
        typeof parsed.whyExplore === "string" && isWhyChip(parsed.whyExplore)
          ? parsed.whyExplore
          : null,
      whyNote:
        typeof parsed.whyNote === "string"
          ? parsed.whyNote.trim().slice(0, AGENT_OTHER_MAX_CHARS)
          : "",
    };
  } catch {
    return { ...EMPTY_AGENT_FRAME };
  }
}

export function serializeAgentFrame(frame: AgentFrame): string {
  return JSON.stringify(frame);
}

export function isAgentAskComplete(frame: AgentFrame): boolean {
  return frame.askStep >= AGENT_ASK_STEPS.length;
}

export type AgentBoardPhase = "intro" | "ask" | "why" | "grid";

export function resolveAgentBoardPhase(input: {
  agentUi: boolean;
  introSeen: boolean;
  frame: AgentFrame;
}): AgentBoardPhase {
  if (!input.agentUi) return "grid";
  if (!input.introSeen) return "intro";
  if (input.frame.whyPending) return "why";
  if (!isAgentAskComplete(input.frame)) return "ask";
  return "grid";
}

export type AgentRetrievePlan = {
  dontDeal: boolean;
  industryIds: IndustryOptionId[];
};

/**
 * Industries to retrieve for a completed (or Q1-complete) frame.
 * don’t-deal → no ids. Mapped Other (paintings) → home_kitchen (+ chips).
 * unmapped Other + chips → chips only (Other is rank hint, not a bin).
 */
export function resolveAgentRetrievePlan(frame: AgentFrame): AgentRetrievePlan {
  const otherText = frame.otherText;
  const chips = frame.industryIds;
  if (isOtherDontDeal(otherText, chips)) {
    return { dontDeal: true, industryIds: [] };
  }
  const ids = new Set<IndustryOptionId>(chips);
  const mapped = resolveOtherRetrieveIndustry(otherText, chips);
  if (mapped) ids.add(mapped);
  if (ids.size === 0) {
    return { dontDeal: true, industryIds: [] };
  }
  return { dontDeal: false, industryIds: [...ids] };
}

export function filterCatalogByIndustries<T extends { category: string }>(
  products: readonly T[],
  industryIds: readonly IndustryOptionId[],
): T[] {
  if (industryIds.length === 0) return [];
  const allow = new Set<string>(industryIds);
  return products.filter((p) => allow.has(p.category));
}

export function parseOnboardingIndustryLikes(
  categoryLikesJson: string,
): IndustryOptionId[] {
  try {
    const parsed = JSON.parse(categoryLikesJson);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (id): id is IndustryOptionId => typeof id === "string" && isIndustryId(id),
    );
  } catch {
    return [];
  }
}

export function applySellAnswer(
  frame: AgentFrame,
  industryIds: readonly IndustryOptionId[],
  otherText: string,
): AgentFrame | { error: "empty_sell" } {
  const ids = [...new Set(industryIds.filter(isIndustryId))];
  const other = otherText.trim().slice(0, AGENT_OTHER_MAX_CHARS);
  if (ids.length === 0 && other.length === 0) return { error: "empty_sell" };
  const next: AgentFrame = {
    ...frame,
    industryIds: ids,
    otherText: other,
    askStep: 1,
  };
  if (isOtherDontDeal(next.otherText, next.industryIds)) {
    return { ...next, askStep: AGENT_ASK_STEPS.length };
  }
  return next;
}

export function applySkipRefuseAnswer(
  frame: AgentFrame,
  value: AgentSkipRefuseChip | "skipped",
): AgentFrame | { error: "skip_not_allowed" } {
  if (frame.narrowing && value === "skipped") {
    return { error: "skip_not_allowed" };
  }
  return { ...frame, skipRefuse: value, askStep: 2 };
}

export function applyAudienceAnswer(
  frame: AgentFrame,
  value: AgentAudienceChip | "skipped",
): AgentFrame | { error: "skip_not_allowed" } {
  if (frame.narrowing && value === "skipped") {
    return { error: "skip_not_allowed" };
  }
  return { ...frame, audience: value, askStep: 3 };
}

export function applyDifferAnswer(
  frame: AgentFrame,
  value: AgentDifferChip | "skipped",
): AgentFrame | { error: "skip_not_allowed" } {
  // §14.11 — differ is required on first ask and narrowing. Never skip.
  if (value === "skipped") {
    return { error: "skip_not_allowed" };
  }
  return { ...frame, differ: value, askStep: AGENT_ASK_STEPS.length };
}

export function beginWhyExplore(frame: AgentFrame): AgentFrame {
  return { ...frame, whyPending: true };
}

export function applyWhyExploreAnswer(
  frame: AgentFrame,
  why: AgentWhyChip,
  note: string,
): AgentFrame {
  return {
    ...frame,
    whyExplore: why,
    whyNote: note.trim().slice(0, AGENT_OTHER_MAX_CHARS),
    whyPending: false,
  };
}

export function beginNarrowing(frame: AgentFrame): AgentFrame {
  return {
    ...frame,
    askStep: 0,
    narrowing: true,
    whyPending: false,
    skipRefuse: null,
    audience: null,
    differ: null,
  };
}

export function finishNarrowing(frame: AgentFrame): AgentFrame {
  return { ...frame, narrowing: false, askStep: AGENT_ASK_STEPS.length };
}

/** Narrowing retrieve is blocked until these are real chips — not skipped. */
export function isNarrowingFieldsWritten(frame: AgentFrame): boolean {
  return (
    isAgentAskComplete(frame) &&
    frame.skipRefuse !== null &&
    frame.skipRefuse !== "skipped" &&
    frame.audience !== null &&
    frame.audience !== "skipped" &&
    frame.differ !== null &&
    frame.differ !== "skipped"
  );
}

export { classifyOtherIndustry, isOtherDontDeal };
