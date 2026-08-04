/**
 * Wave 2 Discovery scoring calibration (Pass 1).
 * Soft-margin band widths are implementation detail (WAVE-2 §5.2) — not product locks.
 *
 * Wave 1 hard accept targets remain 70% / 35% (`MARGIN_*` in `@/lib/constants`).
 * Soft listing allows a slightly-under band; far below is not recommended.
 */

/** Listing OK when before-ads margin is at least this (5pp under Wave 1 70%). */
export const SOFT_MARGIN_BEFORE_LIST_MIN = 0.65;
/** Listing OK when after-ads margin is at least this (5pp under Wave 1 35%). */
export const SOFT_MARGIN_AFTER_LIST_MIN = 0.3;
/**
 * Far-below floor — below either → do not recommend for Discovery listing.
 * ~15pp under Wave 1 before / ~13pp under after.
 */
export const SOFT_MARGIN_BEFORE_FLOOR = 0.55;
export const SOFT_MARGIN_AFTER_FLOOR = 0.22;

/** Demand path thresholds (0..1 evidence scores). */
export const DEMAND_ABROAD_STRONG = 0.55;
export const DEMAND_LEBANON_WEAK = 0.4;
export const DEMAND_LEBANON_STRONG = 0.5;
/** Neutral fill when a demand leg is missing (WAVE-2 §7 missing data = neutral). */
export const DEMAND_NEUTRAL = 0.5;

/** Competition intensity bands (0..1 stored score). */
export const COMPETITION_LOW_MAX = 0.33;
export const COMPETITION_HIGH_MIN = 0.66;
/** How hard high competition multiplies the core (never zero — still listable). */
export const COMPETITION_RANK_PENALTY_WEIGHT = 0.55;

/**
 * Budget×fight soft penalties (multipliers). Soft mode only downranks.
 * Calibrated vs onboarding budgetUsd / monthlyFollowOnBudget.
 */
export const BUDGET_FIGHT_LOW_MIN_USD = 400;
export const BUDGET_FIGHT_MED_ADS_MIN_USD = 150;
export const BUDGET_FIGHT_HIGH_ADS_MIN_USD = 400;
export const BUDGET_FIGHT_PENALTY_SOFT = 0.72;
export const BUDGET_FIGHT_PENALTY_HARD_SHADOW = 0.45;

/** Soft additive after core product of multipliers (WAVE-2 §2). */
export const SOFT_MARGIN_ADDON_PASS = 0.08;
export const SOFT_MARGIN_ADDON_SOFT_OK = 0.02;

/** Heuristic seed confidence (low → polish can cap Strong → Okay). */
export const HEURISTIC_SEED_CONFIDENCE = 0.35;
export const CONFIDENCE_OKAY_CAP = 0.5;

/** Polish: mild rank nudge only (must not cancel core winners). */
export const POLISH_LOW_CONFIDENCE_PENALTY = 0.04;
export const POLISH_AFFORDABILITY_PENALTY = 0.03;
