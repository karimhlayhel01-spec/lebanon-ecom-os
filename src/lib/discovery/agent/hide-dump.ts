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

export type HideDumpScoreHint = {
  competitionScore?: number | null;
  rawEvidenceJson?: string | null;
};

export type HideDumpRanked = {
  p: { key: string; tier1Marketplaces: readonly string[] };
};

function hasTier1Hit(names: readonly string[]): boolean {
  const blob = names.map((n) => n.toLowerCase()).join(" ");
  if (!blob.trim()) return false;
  return TIER1_MARKETPLACES.some((m) => blob.includes(m.toLowerCase()));
}

/** Pool marketplace names plus live-evidence `tier1Found` when present. */
export function collectHideDumpTier1Names(
  poolNames: readonly string[],
  rawEvidenceJson?: string | null,
): string[] {
  const names = poolNames.filter((n) => n.trim().length > 0);
  if (!rawEvidenceJson) return names;
  try {
    const parsed = JSON.parse(rawEvidenceJson) as { tier1Found?: unknown };
    if (!Array.isArray(parsed.tier1Found)) return names;
    for (const item of parsed.tier1Found) {
      if (typeof item === "string" && item.trim()) names.push(item.trim());
    }
  } catch {
    /* malformed evidence is not a Tier-1 hit */
  }
  return names;
}

/** True → do not put this catalogKey on the agent grid. */
export function isDiscoveryDumpHidden(input: HideDumpInput): boolean {
  const c = input.competition;
  if (c == null || !Number.isFinite(c)) return false;
  if (c < COMPETITION_HIGH_MIN) return false;
  return hasTier1Hit(input.tier1Names);
}

/**
 * Drop high+Tier-1 dumps from a skills-ranked retrieve set.
 * No-op unless POOL_V2 + agent UI — never a fake Ishtari filter on catalog-only.
 * Remaining order is the existing composite rank (whitespace already in demand).
 */
export function applyHideDumpToRanked<T extends HideDumpRanked>(
  ranked: readonly T[],
  scoresByKey: ReadonlyMap<string, HideDumpScoreHint | undefined>,
  opts: { poolV2: boolean; agentUi: boolean },
): T[] {
  if (!opts.poolV2 || !opts.agentUi) return [...ranked];
  return ranked.filter((item) => {
    const score = scoresByKey.get(item.p.key);
    return !isDiscoveryDumpHidden({
      competition: score?.competitionScore,
      tier1Names: collectHideDumpTier1Names(
        item.p.tier1Marketplaces,
        score?.rawEvidenceJson,
      ),
    });
  });
}
