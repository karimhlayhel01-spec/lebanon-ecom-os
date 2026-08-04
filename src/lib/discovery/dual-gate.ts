/**
 * Wave 2 dual-gate demand confirm (WAVE-2 §7).
 * When DISCOVERY_POOL_V2 is on: accept needs system demand/score AND founder paste.
 * When flag off: Wave 1 paste-only. Paste UI stays until a later trusted rollout.
 */

import { isDiscoveryPoolV2Enabled } from "@/lib/discovery/flags";
import { scoreDemand } from "@/lib/discovery/scoring/demand";

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

export type DualAcceptError =
  | "needs_demand"
  | "needs_system_demand";

export type DualAcceptCheck = {
  dualEnabled: boolean;
  pasteConfirmed: boolean;
  system: SystemDemandGateResult;
  ok: boolean;
  error: DualAcceptError | null;
};

/** Dual-gate is tied to pool/score cache (Approach A). Flag off → Wave 1 paste only. */
export function isDualDemandGateEnabled(): boolean {
  return isDiscoveryPoolV2Enabled();
}

/**
 * System demand/score gate — dual path (whitespace OR local-proven).
 * Missing score cache → fail-closed while dual-gate is on.
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
      reason: "score_cache_missing",
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
 * Dual-gate accept check (pure). Paste-only when dual disabled.
 * Prefer paste error first when both missing (clearer Wave 1-compatible copy).
 */
export function evaluateDualAcceptGate(input: {
  pasteConfirmed: boolean;
  system: SystemDemandGateInput | null | undefined;
  dualEnabled?: boolean;
}): DualAcceptCheck {
  const dualEnabled =
    input.dualEnabled !== undefined
      ? input.dualEnabled
      : isDualDemandGateEnabled();
  const system = evaluateSystemDemandGate(input.system);

  if (!dualEnabled) {
    if (!input.pasteConfirmed) {
      return {
        dualEnabled: false,
        pasteConfirmed: false,
        system,
        ok: false,
        error: "needs_demand",
      };
    }
    return {
      dualEnabled: false,
      pasteConfirmed: true,
      system,
      ok: true,
      error: null,
    };
  }

  if (!input.pasteConfirmed) {
    return {
      dualEnabled: true,
      pasteConfirmed: false,
      system,
      ok: false,
      error: "needs_demand",
    };
  }
  if (!system.pass) {
    return {
      dualEnabled: true,
      pasteConfirmed: true,
      system,
      ok: false,
      error: "needs_system_demand",
    };
  }
  return {
    dualEnabled: true,
    pasteConfirmed: true,
    system,
    ok: true,
    error: null,
  };
}

/**
 * Soft-margin listing vs hard accept mismatch (WAVE-2 §5.2 vs Wave 1 accept).
 * True when listed under soft band but hard Shared Margin skill fails accept.
 */
export function isSoftListedHardAcceptBlocked(input: {
  marginsPass: boolean;
  oversized: boolean;
  softMarginBand?: string | null;
}): boolean {
  if (input.oversized || input.marginsPass) return false;
  return input.softMarginBand === "soft_ok";
}
