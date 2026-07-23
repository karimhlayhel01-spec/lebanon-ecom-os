import { DISCOVERY_EXHAUSTED_ROUNDS_BEFORE_WHY } from "@/lib/constants";

/** Empty-list ladder (Fix #13). Null when candidates are still visible. */
export type DiscoveryLadder =
  | "show_more"
  | "continue"
  | "why_pass"
  | "catalog_exhausted";

export const DISCOVERY_PASS_REASONS = [
  "too_expensive",
  "wrong_categories",
  "too_much_work",
  "too_risky",
  "weak_demand",
  "other",
] as const;

export type DiscoveryPassReason = (typeof DISCOVERY_PASS_REASONS)[number];

/**
 * Pure ladder classifier for empty Discovery lists (Fix #13 A→B→C→D).
 */
export function classifyDiscoveryLadder(input: {
  visibleCount: number;
  canShowMore: boolean;
  remainingEligible: number;
  exhaustedRounds: number;
}): DiscoveryLadder | null {
  if (input.visibleCount > 0) return null;
  if (input.canShowMore) return "show_more";
  if (input.remainingEligible <= 0) return "catalog_exhausted";
  if (input.exhaustedRounds >= DISCOVERY_EXHAUSTED_ROUNDS_BEFORE_WHY) {
    return "why_pass";
  }
  return "continue";
}

/** Deterministic onboarding suggestion keys for the why-pass form (suggest only). */
export function suggestionsForPassReasons(
  reasons: readonly DiscoveryPassReason[],
): string[] {
  const out: string[] = [];
  const add = (key: string) => {
    if (!out.includes(key)) out.push(key);
  };
  for (const r of reasons) {
    switch (r) {
      case "too_expensive":
        add("maxLandedCost");
        add("budgetUsd");
        break;
      case "wrong_categories":
        add("categoryLikes");
        break;
      case "too_much_work":
        add("hoursPerWeek");
        add("experience");
        break;
      case "too_risky":
        add("riskTolerance");
        break;
      case "weak_demand":
        add("demandConfirm");
        add("categoryLikes");
        break;
      case "other":
        add("otherNote");
        break;
    }
  }
  return out;
}
