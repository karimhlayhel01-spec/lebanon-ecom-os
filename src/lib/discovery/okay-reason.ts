/**
 * WAVE-2 §6.1 — ONE typed Okay reason from ONE source.
 *
 * The yellow “why this is Okay” note on the card and the reason handed to the
 * Gemini narrator must never disagree, so both the Discovery view and the
 * explain payload resolve the reason here. Live scoring keeps its own resolver
 * (scoring/composite.resolveOkayReason); this module only *reads* what a stored
 * session row already carries and heals legacy rows the same way for both.
 */

import {
  riskReadForOkayReason,
  type OkayReason,
} from "@/lib/discovery/scoring/composite";
import {
  COMPETITION_HIGH_MIN,
  CONFIDENCE_OKAY_CAP,
  HEURISTIC_SEED_CONFIDENCE,
} from "@/lib/discovery/scoring/constants";

/** Mirrors the Fit skill's Strong threshold — below it, Fit risk is genuine. */
export const FIT_STRONG_MIN = 70;

export type OkayReasonSources = {
  strength: "Strong" | "Okay";
  fitScore: number;
  /** Typed reason stored on the candidate (fitBreakdown wave2.okayReason). */
  storedOkayReason?: string | null;
  /** Note key stored on the candidate row (legacy inference + Fit riskRead). */
  storedRiskRead?: string | null;
  /** Session snapshot explain fields (fitBreakdown wave2.explain). */
  snapshotCompetitionLevel?: string | null;
  snapshotConfidence?: number | null;
  /** Score-cache overlay — more current than the session snapshot. */
  scoreConfidence?: number | null;
  scoreCompetitionScore?: number | null;
};

export type ResolvedOkayReason = {
  okayReason: OkayReason | null;
  /** Note key for the yellow card note; always matches okayReason. */
  riskRead: string | null;
};

function parseOkayReason(raw: string | null | undefined): OkayReason | null {
  return raw === "fit_risk" ||
    raw === "low_evidence_confidence" ||
    raw === "high_competition"
    ? raw
    : null;
}

/** Legacy rows stored only the note key. */
function reasonFromRiskRead(raw: string | null | undefined): OkayReason | null {
  switch (raw) {
    case "@listing.lowEvidenceConfidence":
      return "low_evidence_confidence";
    case "@listing.highCompetition":
    // Old rows could store a combined reason; competition is the concrete one.
    case "@listing.multipleOkay":
      return "high_competition";
    case "@fit.moderateOkay":
    case "@fit.riskOverTolerance":
      return "fit_risk";
    default:
      return null;
  }
}

function num(n: number | null | undefined): number | null {
  return n != null && Number.isFinite(n) ? n : null;
}

/**
 * Resolve the single Okay reason (and its matching note key) for a stored
 * candidate. Strong recommendations never carry an Okay reason or note.
 */
export function resolveOkayReasonForDisplay(
  input: OkayReasonSources,
): ResolvedOkayReason {
  if (input.strength !== "Okay") {
    return { okayReason: null, riskRead: null };
  }

  // A Fit-risk label only holds when Fit actually constrains the founder:
  // a weak score, or a risk level above tolerance at any score.
  const fitRiskCredible =
    input.fitScore < FIT_STRONG_MIN ||
    input.storedRiskRead === "@fit.riskOverTolerance";

  const competitionScore = num(input.scoreCompetitionScore);
  const competitionHigh =
    competitionScore != null
      ? competitionScore >= COMPETITION_HIGH_MIN
      : input.snapshotCompetitionLevel === "high";

  // Unknown confidence is heuristic-grade, and the cap value itself is not
  // "confident enough" — the same floor the polish skill applies.
  const confidence =
    num(input.scoreConfidence) ??
    num(input.snapshotConfidence) ??
    HEURISTIC_SEED_CONFIDENCE;
  const lowConfidence = confidence <= CONFIDENCE_OKAY_CAP;

  let okayReason =
    parseOkayReason(input.storedOkayReason) ??
    reasonFromRiskRead(input.storedRiskRead);

  // Legacy Wave 2 rows stored @fit.moderateOkay when confidence or competition
  // capped strength, which reads as “your Fit is moderate” on a Fit-100 card.
  if (okayReason === "fit_risk" && !fitRiskCredible) okayReason = null;

  if (!okayReason) {
    // Same ladder as scoring/composite.resolveOkayReason: genuine Fit risk is
    // primary, then concrete competition, then the evidence-confidence cap.
    okayReason = fitRiskCredible
      ? "fit_risk"
      : competitionHigh
        ? "high_competition"
        : lowConfidence
          ? "low_evidence_confidence"
          : "fit_risk";
  }

  return {
    okayReason,
    riskRead: riskReadForOkayReason(
      okayReason,
      input.storedRiskRead?.startsWith("@fit.")
        ? input.storedRiskRead
        : null,
    ),
  };
}
