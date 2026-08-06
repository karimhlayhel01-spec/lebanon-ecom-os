/**
 * SoftMargin skill — margin band for composite scoring / explain. WAVE-2 §5.2.
 * Shortlist listing requires band "pass" (hard 70%/35%); soft_ok is scoring
 * signal only — never listed for browsing.
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
 * Map hard margin math onto soft-margin scoring bands.
 * - pass: meets Wave 1 hard targets (same as margin.pass) → listable
 * - soft_ok: slightly under hard targets → scoring addon only, not listed
 * - far_below: under floor → not listed
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
