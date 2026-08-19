/**
 * WAVE-2 §14 hide-dump — high local/Tier-1 clutter is not retrieved.
 * Pure: unit-test the gate; UI retrieve must call this only when pool+scores exist.
 */

import { TIER1_MARKETPLACES } from "@/lib/constants";
import { COMPETITION_HIGH_MIN } from "@/lib/discovery/scoring/constants";

export type HideDumpInput = {
  /** 0..1 competition intensity from scores. */
  competition: number | null | undefined;
  /** Pool JSON names and/or live evidence seller/domain hits. */
  tier1Names: readonly string[];
};

function hasTier1Hit(names: readonly string[]): boolean {
  const blob = names.map((n) => n.toLowerCase()).join(" ");
  if (!blob.trim()) return false;
  return TIER1_MARKETPLACES.some((m) => blob.includes(m.toLowerCase()));
}

/** True → do not put this catalogKey on the agent grid. */
export function isDiscoveryDumpHidden(input: HideDumpInput): boolean {
  const c = input.competition;
  if (c == null || !Number.isFinite(c)) return false;
  if (c < COMPETITION_HIGH_MIN) return false;
  return hasTier1Hit(input.tier1Names);
}
