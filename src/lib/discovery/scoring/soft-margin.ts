/**
 * SoftMargin skill — Discovery listing band around Wave 1 70%/35%. WAVE-2 §5.2.
 * Hard accept gates stay on computeMargin.pass (unchanged this pass).
 */

import type { MarginResult } from "@/lib/skills/margin";
import {
  SOFT_MARGIN_AFTER_FLOOR,
  SOFT_MARGIN_AFTER_LIST_MIN,
  SOFT_MARGIN_BEFORE_FLOOR,
  SOFT_MARGIN_BEFORE_LIST_MIN,
} from "@/lib/discovery/scoring/constants";

export type SoftMarginBand = "pass" | "soft_ok" | "far_below";

export type SoftMarginResult = {
  band: SoftMarginBand;
  /** Short note key for listing UI / explain payload (not accept gate). */
  note: string | null;
  marginBefore: number;
  marginAfter: number;
};

/**
 * Map hard margin math onto soft listing policy.
 * - pass: meets Wave 1 hard targets (same as margin.pass)
 * - soft_ok: within soft listing band (slightly under) → Okay + note
 * - far_below: under floor → do not recommend
 */
export function computeSoftMargin(margin: MarginResult): SoftMarginResult {
  const { marginBefore, marginAfter, pass } = margin;

  if (pass) {
    return {
      band: "pass",
      note: null,
      marginBefore,
      marginAfter,
    };
  }

  const withinSoft =
    marginBefore >= SOFT_MARGIN_BEFORE_LIST_MIN &&
    marginAfter >= SOFT_MARGIN_AFTER_LIST_MIN;

  if (withinSoft) {
    return {
      band: "soft_ok",
      note: "margins_tight_vs_target",
      marginBefore,
      marginAfter,
    };
  }

  const farBelow =
    marginBefore < SOFT_MARGIN_BEFORE_FLOOR ||
    marginAfter < SOFT_MARGIN_AFTER_FLOOR;

  if (farBelow) {
    return {
      band: "far_below",
      note: "margins_far_below_target",
      marginBefore,
      marginAfter,
    };
  }

  // Between soft list min and far floor — treat as soft_ok with tighter note.
  return {
    band: "soft_ok",
    note: "margins_tight_vs_target",
    marginBefore,
    marginAfter,
  };
}
