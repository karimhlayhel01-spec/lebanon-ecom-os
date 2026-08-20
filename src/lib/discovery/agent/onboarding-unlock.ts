/**
 * WAVE-2 §14.12 — Edit onboarding dry-run.
 * One knob at a time, smallest step. Same 70/35% / demand / oversized / hide-dump.
 * Never advises monthlyFollowOnBudget, storage text, or categoryLikes.
 */

import {
  MAX_LANDED_SOFT_OVERAGE,
} from "@/lib/constants";
import type { CatalogProduct } from "@/lib/discovery/catalog";
import {
  applyHideDumpToRanked,
  type HideDumpScoreHint,
} from "@/lib/discovery/agent/hide-dump";
import {
  isAcceptReadyForShortlist,
  resolveSystemDemandInput,
  type SystemDemandGateInput,
} from "@/lib/discovery/dual-gate";
import { computeFit, type FitProfile } from "@/lib/skills/fit";
import { computeMargin } from "@/lib/skills/margin";

export const ONBOARDING_UNLOCK_KNOBS = [
  "maxLandedCost",
  "hoursPerWeek",
  "riskTolerance",
  "experience",
] as const;

export type OnboardingUnlockField = (typeof ONBOARDING_UNLOCK_KNOBS)[number];

export const ONBOARDING_UNLOCK_PREVIEW_MAX = 3;
/** Hard ceiling so dry-run never recommends an unbounded landed cost. */
export const ONBOARDING_UNLOCK_MAX_LANDED_CAP = 500;

export type UnlockProfile = FitProfile & {
  monthlyFollowOnBudget: number;
};

export type OnboardingUnlockAdvice = {
  field: OnboardingUnlockField;
  fromValue: string | number;
  toValue: string | number;
  extraKeys: string[];
  extraNamesEn: string[];
  extraNamesAr: string[];
};

export type UnlockScoreHint = HideDumpScoreHint & SystemDemandGateInput;

const RISK_NEXT = {
  low: "medium",
  medium: "high",
  high: null,
} as const;

const EXPERIENCE_NEXT = {
  beginner: "some",
  some: "experienced",
  experienced: null,
} as const;

function landedOf(p: CatalogProduct): number {
  return p.productCost + p.intlShip + p.clearanceTaxes + p.localCourier;
}

function selectLandedPool(
  catalog: readonly CatalogProduct[],
  maxLandedCost: number,
): CatalogProduct[] {
  const ceiling = maxLandedCost * MAX_LANDED_SOFT_OVERAGE;
  const within = catalog.filter((p) => landedOf(p) <= ceiling);
  if (within.length > 0) return within;
  return [...catalog].sort((a, b) => landedOf(a) - landedOf(b));
}

export function parseUnlockField(
  raw: string | null | undefined,
): OnboardingUnlockField | null {
  if (!raw) return null;
  return (ONBOARDING_UNLOCK_KNOBS as readonly string[]).includes(raw)
    ? (raw as OnboardingUnlockField)
    : null;
}

export function discoveryReturnHref(input: {
  fromDiscovery: boolean;
  isFirstCompletion: boolean;
  unlockField?: string | null;
  hub?: boolean;
  addSku?: boolean;
}): string {
  if (input.isFirstCompletion || !input.fromDiscovery) return "/dashboard";
  const params = new URLSearchParams();
  if (input.hub) params.set("hub", "1");
  if (input.addSku) params.set("addSku", "1");
  const field = parseUnlockField(input.unlockField);
  if (field) params.set("unlock", field);
  const q = params.toString();
  return q ? `/dashboard?${q}#discovery` : "/dashboard#discovery";
}

export function listAcceptReadyForUnlock(
  profile: UnlockProfile,
  catalog: readonly CatalogProduct[],
  opts: {
    systemGateEnabled?: boolean;
    liveSearchEnabled?: boolean;
    scoresByKey?: ReadonlyMap<string, UnlockScoreHint | undefined>;
    hideDump?: { poolV2: boolean; agentUi: boolean };
  } = {},
): CatalogProduct[] {
  const systemGateEnabled = opts.systemGateEnabled === true;
  const pool = selectLandedPool(catalog, profile.maxLandedCost);
  const listed: { p: CatalogProduct; fitScore: number }[] = [];
  for (const p of pool) {
    const landedCost = landedOf(p);
    const fit = computeFit(profile, {
      category: p.category,
      landedCost,
      difficulty: p.difficulty,
      risk: p.risk,
      timeNeed: p.timeNeed,
      workload: p.workload,
      storageFootprint: p.storageFootprint,
    });
    const margin = computeMargin({
      sellPrice: p.sellPrice,
      productCost: p.productCost,
      intlShip: p.intlShip,
      clearanceTaxes: p.clearanceTaxes,
      localCourier: p.localCourier,
      monthlyFollowOnBudget: profile.monthlyFollowOnBudget,
    });
    const score = opts.scoresByKey?.get(p.key);
    const system = systemGateEnabled
      ? resolveSystemDemandInput({
          cache: score ?? null,
          heuristicProduct: {
            catalogKey: p.key,
            category: p.category,
            difficulty: p.difficulty,
            risk: p.risk,
            tier1Marketplaces: JSON.stringify(p.tier1Marketplaces),
            nameEn: p.en.name,
          },
          liveSearchEnabled: opts.liveSearchEnabled === true,
        })
      : null;
    if (
      !isAcceptReadyForShortlist({
        marginsPass: margin.pass,
        oversized: p.oversized,
        fitNotRecommended: fit.notRecommended,
        system,
        systemGateEnabled,
      })
    ) {
      continue;
    }
    listed.push({ p, fitScore: fit.score });
  }
  listed.sort((a, b) => b.fitScore - a.fitScore);
  const ranked = listed.map((row) => ({ p: row.p }));
  if (!opts.hideDump) return ranked.map((row) => row.p);
  return applyHideDumpToRanked(ranked, opts.scoresByKey ?? new Map(), {
    poolV2: opts.hideDump.poolV2,
    agentUi: opts.hideDump.agentUi,
  }).map((row) => row.p);
}

function extrasAgainst(
  baseline: ReadonlySet<string>,
  listed: readonly CatalogProduct[],
): CatalogProduct[] {
  return listed.filter((p) => !baseline.has(p.key));
}

function trial(
  profile: UnlockProfile,
  catalog: readonly CatalogProduct[],
  opts: Parameters<typeof listAcceptReadyForUnlock>[2],
  baseline: ReadonlySet<string>,
  patch: Partial<UnlockProfile>,
): CatalogProduct[] {
  return extrasAgainst(
    baseline,
    listAcceptReadyForUnlock({ ...profile, ...patch }, catalog, opts),
  );
}

function preview(products: readonly CatalogProduct[]): {
  extraKeys: string[];
  extraNamesEn: string[];
  extraNamesAr: string[];
} {
  const sliced = products.slice(0, ONBOARDING_UNLOCK_PREVIEW_MAX);
  return {
    extraKeys: products.map((p) => p.key),
    extraNamesEn: sliced.map((p) => p.en.name),
    extraNamesAr: sliced.map((p) => p.ar.name),
  };
}

/**
 * Pick the single onboarding knob that unlocks the most extra accept-ready
 * ids in this aisle. Tie → earlier knob. Null when nothing unlocks.
 */
export function pickOnboardingUnlock(input: {
  profile: UnlockProfile;
  catalog: readonly CatalogProduct[];
  systemGateEnabled?: boolean;
  liveSearchEnabled?: boolean;
  scoresByKey?: ReadonlyMap<string, UnlockScoreHint | undefined>;
  hideDump?: { poolV2: boolean; agentUi: boolean };
}): OnboardingUnlockAdvice | null {
  const { profile, catalog, ...opts } = input;
  const baselineList = listAcceptReadyForUnlock(profile, catalog, opts);
  const baseline = new Set(baselineList.map((p) => p.key));

  type Candidate = {
    field: OnboardingUnlockField;
    fromValue: string | number;
    toValue: string | number;
    extras: CatalogProduct[];
  };
  const candidates: Candidate[] = [];

  const landedCandidates = new Set<number>();
  for (const p of catalog) {
    if (baseline.has(p.key) || p.oversized) continue;
    const landed = landedOf(p);
    const forBand = Math.ceil(landed / MAX_LANDED_SOFT_OVERAGE);
    const forBudget = Math.ceil(landed);
    for (const v of [forBand, forBudget]) {
      if (v > profile.maxLandedCost && v <= ONBOARDING_UNLOCK_MAX_LANDED_CAP) {
        landedCandidates.add(v);
      }
    }
  }
  const sortedLanded = [...landedCandidates].sort((a, b) => a - b);
  for (const to of sortedLanded) {
    const extras = trial(profile, catalog, opts, baseline, {
      maxLandedCost: to,
    });
    if (extras.length > 0) {
      candidates.push({
        field: "maxLandedCost",
        fromValue: profile.maxLandedCost,
        toValue: to,
        extras,
      });
      break;
    }
  }

  const hourNeeds = catalog
    .filter((p) => !baseline.has(p.key))
    .map((p) => p.timeNeed)
    .filter((need) => need > profile.hoursPerWeek);
  if (hourNeeds.length > 0) {
    const nextHours = Math.min(168, ...hourNeeds);
    const extras = trial(profile, catalog, opts, baseline, {
      hoursPerWeek: nextHours,
    });
    if (extras.length > 0) {
      candidates.push({
        field: "hoursPerWeek",
        fromValue: profile.hoursPerWeek,
        toValue: nextHours,
        extras,
      });
    }
  }

  const nextRisk = RISK_NEXT[profile.riskTolerance];
  if (nextRisk) {
    const extras = trial(profile, catalog, opts, baseline, {
      riskTolerance: nextRisk,
    });
    if (extras.length > 0) {
      candidates.push({
        field: "riskTolerance",
        fromValue: profile.riskTolerance,
        toValue: nextRisk,
        extras,
      });
    }
  }

  const nextExp = EXPERIENCE_NEXT[profile.experience];
  if (nextExp) {
    const extras = trial(profile, catalog, opts, baseline, {
      experience: nextExp,
    });
    if (extras.length > 0) {
      candidates.push({
        field: "experience",
        fromValue: profile.experience,
        toValue: nextExp,
        extras,
      });
    }
  }

  if (candidates.length === 0) return null;
  let best = candidates[0]!;
  for (const row of candidates.slice(1)) {
    if (row.extras.length > best.extras.length) best = row;
  }
  return {
    field: best.field,
    fromValue: best.fromValue,
    toValue: best.toValue,
    ...preview(best.extras),
  };
}
