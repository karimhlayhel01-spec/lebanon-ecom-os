/**
 * Fit skill — deterministic ability-matching for Product Discovery.
 *
 * Fit order (priority weights, highest first, per the approved plan):
 *   budget → experience → risk → time → storage → workload
 * Likes are a *soft* preference (small bonus, never a gate).
 *
 * Output strength: Strong or Okay. "Okay" means the founder must read and
 * acknowledge a risk note before accepting (Okay = risk read + approval).
 * Pure module (no I/O) so it is fully unit-tested.
 */

export type ExperienceLevel = "beginner" | "some" | "experienced";
export type RiskTolerance = "low" | "medium" | "high";
export type StorageFootprint = "small" | "medium" | "large";

export type FitProfile = {
  maxLandedCost: number;
  experience: ExperienceLevel;
  riskTolerance: RiskTolerance;
  hoursPerWeek: number;
  categoryLikes: readonly string[];
};

export type FitProduct = {
  category: string;
  landedCost: number;
  /** 0 easy … 2 hard. */
  difficulty: 0 | 1 | 2;
  /** 0 low … 2 high. */
  risk: 0 | 1 | 2;
  /** Hours/week to operate this product. */
  timeNeed: number;
  /** Ongoing content/ops burden, 0 low … 2 high. */
  workload: 0 | 1 | 2;
  storageFootprint: StorageFootprint;
};

export type FitBreakdown = {
  budget: number;
  experience: number;
  risk: number;
  time: number;
  storage: number;
  workload: number;
  likes: number;
};

export type FitResult = {
  score: number; // 0..100
  breakdown: FitBreakdown;
  strength: "Strong" | "Okay";
  riskRead: string | null;
  notRecommended: boolean;
};

const WEIGHTS = {
  budget: 0.28,
  experience: 0.2,
  risk: 0.2,
  time: 0.16,
  storage: 0.1,
  workload: 0.06,
} as const;

const LIKES_BONUS = 5; // soft: added to the 0..100 score when category is liked
const STRONG_MIN = 70;
const NOT_RECOMMENDED_MAX = 45;

const EXPERIENCE_RANK: Record<ExperienceLevel, number> = {
  beginner: 0,
  some: 1,
  experienced: 2,
};
const RISK_RANK: Record<RiskTolerance, number> = {
  low: 0,
  medium: 1,
  high: 2,
};
const STORAGE_SCORE: Record<StorageFootprint, number> = {
  small: 1,
  medium: 0.75,
  large: 0.45,
};

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export function computeFit(
  profile: FitProfile,
  product: FitProduct,
): FitResult {
  const exp = EXPERIENCE_RANK[profile.experience];
  const tol = RISK_RANK[profile.riskTolerance];

  const budget =
    product.landedCost <= profile.maxLandedCost
      ? 1
      : clamp01(profile.maxLandedCost / product.landedCost);
  const experience = clamp01(1 - Math.max(0, product.difficulty - exp) / 2);
  const risk = clamp01(1 - Math.max(0, product.risk - tol) / 2);
  const time =
    profile.hoursPerWeek >= product.timeNeed
      ? 1
      : clamp01(profile.hoursPerWeek / product.timeNeed);
  const storage = STORAGE_SCORE[product.storageFootprint];
  const workload = clamp01(1 - product.workload * 0.25);
  const likes = profile.categoryLikes.includes(product.category) ? 1 : 0;

  const breakdown: FitBreakdown = {
    budget,
    experience,
    risk,
    time,
    storage,
    workload,
    likes,
  };

  const weighted =
    budget * WEIGHTS.budget +
    experience * WEIGHTS.experience +
    risk * WEIGHTS.risk +
    time * WEIGHTS.time +
    storage * WEIGHTS.storage +
    workload * WEIGHTS.workload;

  const score = Math.round(
    Math.min(100, weighted * 100 + (likes ? LIKES_BONUS : 0)),
  );

  const riskWithinTolerance = product.risk <= tol;
  const strength: "Strong" | "Okay" =
    score >= STRONG_MIN && riskWithinTolerance ? "Strong" : "Okay";

  let riskRead: string | null = null;
  if (strength === "Okay") {
    if (!riskWithinTolerance) {
      riskRead =
        "This product carries more risk than your stated tolerance. Review demand certainty, competition, and cash exposure before committing.";
    } else {
      riskRead =
        "Fit is moderate rather than strong. Read the fit and margin notes and confirm you are comfortable before accepting.";
    }
  }

  return {
    score,
    breakdown,
    strength,
    riskRead,
    notRecommended: score < NOT_RECOMMENDED_MAX,
  };
}
