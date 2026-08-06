/**
 * Wave 2 Discovery accept demand gate — system skill scores only.
 * Founder paste demand confirm is REMOVED (WAVE-2 §6.1 / §7).
 */

import {
  isDiscoveryLiveSearchEnabled,
  isDiscoveryPoolV2Enabled,
} from "@/lib/discovery/flags";
import { scoreDemand } from "@/lib/discovery/scoring/demand";
import {
  heuristicScoresFromPoolProduct,
  type HeuristicPoolFields,
} from "@/lib/discovery/scoring/heuristics";

/** Minimum demand skill score to pass the system gate (calibration). */
export const SYSTEM_DEMAND_GATE_MIN = 0.35;

export type SystemDemandGateInput = {
  abroadDemandScore?: number | null;
  lebanonDemandScore?: number | null;
  demandPath?: string | null;
  compositeScore?: number | null;
  lastScoreStatus?: string | null;
  confidence?: number | null;
};

export type SystemDemandGateResult = {
  pass: boolean;
  /** missing = no usable score cache; fail = scored but below bar; pass = ok. */
  status: "pass" | "fail" | "missing";
  demandPath: string | null;
  demandScore: number | null;
  reason: string | null;
};

export type AcceptDemandError =
  | "needs_system_demand_missing"
  | "needs_system_demand_weak";

export type AcceptDemandCheck = {
  /** True when POOL_V2 requires system score for accept. */
  systemGateEnabled: boolean;
  system: SystemDemandGateResult;
  ok: boolean;
  error: AcceptDemandError | null;
};

/** System demand gate when pool/score cache is the Discovery SoT. */
export function isSystemDemandGateEnabled(): boolean {
  return isDiscoveryPoolV2Enabled();
}

/** @deprecated Use isSystemDemandGateEnabled — paste dual-gate removed. */
export function isDualDemandGateEnabled(): boolean {
  return isSystemDemandGateEnabled();
}

/**
 * Heuristic seed scores when LIVE_SEARCH is off and the Approach A cache row
 * is missing / unusable (common after Path 1 intake before `discovery:score`).
 */
export function systemScoreFromHeuristicProduct(
  product: HeuristicPoolFields,
): SystemDemandGateInput {
  const snap = heuristicScoresFromPoolProduct(product);
  return {
    abroadDemandScore: snap.abroadDemandScore,
    lebanonDemandScore: snap.lebanonDemandScore,
    demandPath: snap.demandPath,
    compositeScore: snap.compositeScore,
    lastScoreStatus: "ok",
    confidence: snap.confidence,
  };
}

/**
 * Prefer usable score-cache rows; when LIVE_SEARCH is off and cache is missing,
 * fall back to deterministic heuristics from the pool product (read path only).
 */
export function resolveSystemDemandInput(opts: {
  cache: SystemDemandGateInput | null | undefined;
  heuristicProduct?: HeuristicPoolFields | null;
  liveSearchEnabled?: boolean;
}): SystemDemandGateInput | null {
  const live =
    opts.liveSearchEnabled !== undefined
      ? opts.liveSearchEnabled
      : isDiscoveryLiveSearchEnabled();
  const cache = opts.cache ?? null;
  if (cache) {
    const status = evaluateSystemDemandGate(cache).status;
    if (status !== "missing") return cache;
  }
  if (!live && opts.heuristicProduct) {
    return systemScoreFromHeuristicProduct(opts.heuristicProduct);
  }
  return cache;
}

/**
 * System demand/score gate — dual path (whitespace OR local-proven).
 * Missing score cache → fail-closed while pool v2 is on.
 * Heuristic or live rows with numeric scores / lastScoreStatus=ok count as scored.
 */
export function evaluateSystemDemandGate(
  input: SystemDemandGateInput | null | undefined,
): SystemDemandGateResult {
  if (!input) {
    return {
      pass: false,
      status: "missing",
      demandPath: null,
      demandScore: null,
      reason: "score_cache_missing",
    };
  }

  const hasNumeric =
    (input.abroadDemandScore != null &&
      Number.isFinite(input.abroadDemandScore)) ||
    (input.lebanonDemandScore != null &&
      Number.isFinite(input.lebanonDemandScore));

  const scoredOk =
    input.lastScoreStatus === "ok" ||
    hasNumeric ||
    (input.demandPath != null && input.demandPath.length > 0);

  if (!scoredOk) {
    return {
      pass: false,
      status: "missing",
      demandPath: input.demandPath ?? null,
      demandScore: null,
      reason:
        input.lastScoreStatus === "failed"
          ? "score_refresh_failed"
          : "score_cache_missing",
    };
  }

  const demand = scoreDemand({
    abroadDemandScore: input.abroadDemandScore,
    lebanonDemandScore: input.lebanonDemandScore,
  });

  if (demand.score < SYSTEM_DEMAND_GATE_MIN) {
    return {
      pass: false,
      status: "fail",
      demandPath: demand.path,
      demandScore: demand.score,
      reason: "system_demand_too_weak",
    };
  }

  return {
    pass: true,
    status: "pass",
    demandPath: demand.path,
    demandScore: demand.score,
    reason: null,
  };
}

/**
 * Accept demand check — paste never required.
 * POOL_V2 off → no system score required (Wave 1 catalog path).
 * POOL_V2 on → system demand/score must pass.
 * Missing vs weak are distinct errors for founder-facing copy.
 */
export function evaluateAcceptDemandGate(input: {
  system: SystemDemandGateInput | null | undefined;
  systemGateEnabled?: boolean;
}): AcceptDemandCheck {
  const systemGateEnabled =
    input.systemGateEnabled !== undefined
      ? input.systemGateEnabled
      : isSystemDemandGateEnabled();
  const system = evaluateSystemDemandGate(input.system);

  if (!systemGateEnabled) {
    return {
      systemGateEnabled: false,
      system,
      ok: true,
      error: null,
    };
  }

  if (!system.pass) {
    return {
      systemGateEnabled: true,
      system,
      ok: false,
      error:
        system.status === "missing"
          ? "needs_system_demand_missing"
          : "needs_system_demand_weak",
    };
  }

  return {
    systemGateEnabled: true,
    system,
    ok: true,
    error: null,
  };
}

/**
 * @deprecated Paste dual-gate removed — use evaluateAcceptDemandGate.
 * Kept for a short transition; ignores pasteConfirmed.
 */
export function evaluateDualAcceptGate(input: {
  pasteConfirmed?: boolean;
  system: SystemDemandGateInput | null | undefined;
  dualEnabled?: boolean;
}): AcceptDemandCheck & { dualEnabled: boolean; pasteConfirmed: boolean } {
  const check = evaluateAcceptDemandGate({
    system: input.system,
    systemGateEnabled: input.dualEnabled,
  });
  return {
    ...check,
    dualEnabled: check.systemGateEnabled,
    pasteConfirmed: true,
  };
}

/**
 * Soft-margin listing vs hard accept mismatch — retired.
 * Shortlist is accept-ready only (WAVE-2 §5.2); soft_ok is never listed.
 * Kept for a short transition; always false.
 */
export function isSoftListedHardAcceptBlocked(_input: {
  marginsPass: boolean;
  oversized: boolean;
  softMarginBand?: string | null;
}): boolean {
  return false;
}

/**
 * Accept-ready for Discovery shortlist (WAVE-2 §5.2 / §7).
 * Same gates Accept would need — excluding Tier-1 customize / Okay risk-ack
 * (those stay on otherwise accept-ready cards).
 */
export function isAcceptReadyForShortlist(input: {
  marginsPass: boolean;
  oversized: boolean;
  /** Fit notRecommended → exclude (same spirit as prior core passers). */
  fitNotRecommended?: boolean;
  system: SystemDemandGateInput | null | undefined;
  systemGateEnabled?: boolean;
}): boolean {
  if (input.oversized || !input.marginsPass) return false;
  if (input.fitNotRecommended) return false;
  const demand = evaluateAcceptDemandGate({
    system: input.system,
    systemGateEnabled: input.systemGateEnabled,
  });
  return demand.ok;
}
