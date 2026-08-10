/**
 * Merge live leads into the 3+2 GenSupplier shape.
 * Import: pad remaining seats with heuristic (planning estimates).
 * Local (live on): never invent-pad — only real live seats (partial shortlist OK).
 */

import type { SupplierSource } from "@/lib/supplier/source";
import type { SupplierLead } from "@/lib/supplier/live/types";

export type MergeableSupplier = {
  name: string;
  role: "primary" | "backup";
  rank: number;
  source: SupplierSource;
  years: number;
  rating: number;
  verified: boolean;
  moq: number;
  unitPrice: number;
  sampleReplies: boolean;
  negotiationDraft: string;
  paymentMapEstimate: string;
  redFlags: string[];
  leadSource: "heuristic" | "live_search";
  platform: string | null;
  sourceUrl: string | null;
  externalTitle: string | null;
};

const MOQ_LADDER = [50, 100, 150, 200, 300, 500];

/**
 * Overlay live leads onto heuristic seat templates.
 * - `padHeuristic: true` (Import default): fill remaining seats from invent.
 * - `padHeuristic: false` (Local live): emit only live seats; empty → [].
 */
export function mergeLiveLeadsIntoShortlist(input: {
  source: SupplierSource;
  liveLeads: SupplierLead[];
  heuristic: MergeableSupplier[];
  /** Default true for Import. Local live must pass false. */
  padHeuristic?: boolean;
}): MergeableSupplier[] {
  const padHeuristic = input.padHeuristic ?? true;

  if (input.liveLeads.length === 0) {
    if (!padHeuristic) return [];
    return input.heuristic.map((h) => ({
      ...h,
      leadSource: h.leadSource ?? "heuristic",
      platform: h.platform ?? null,
      sourceUrl: h.sourceUrl ?? null,
      externalTitle: h.externalTitle ?? null,
    }));
  }

  const seats = input.heuristic;
  const out: MergeableSupplier[] = [];
  let liveIdx = 0;

  for (const seat of seats) {
    const lead = input.liveLeads[liveIdx];
    if (!lead) {
      if (padHeuristic) {
        out.push({
          ...seat,
          leadSource: "heuristic",
          platform: null,
          sourceUrl: null,
          externalTitle: null,
        });
      }
      continue;
    }
    liveIdx += 1;
    const moq = seat.moq || MOQ_LADDER[2]!;
    const unitPrice =
      lead.unitPriceHint != null && lead.unitPriceHint > 0
        ? lead.unitPriceHint
        : seat.unitPrice;
    out.push({
      ...seat,
      name: lead.name.slice(0, 160),
      unitPrice,
      moq,
      // Never present invent “Verified” as marketplace truth — Assess listing scrapes.
      verified: false,
      sampleReplies: true,
      negotiationDraft: seat.negotiationDraft,
      paymentMapEstimate: seat.paymentMapEstimate,
      // Live seats: drop invent red-flags (newSupplier / mixedReviews / slowSample).
      redFlags: [],
      leadSource: "live_search",
      platform: lead.platform,
      sourceUrl: lead.sourceUrl,
      externalTitle: lead.externalTitle.slice(0, 240),
    });
  }

  return out;
}
