/**
 * Merge live Import leads into the 3+2 GenSupplier shape; pad with heuristic.
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
 * Prefer live leads for Import slots; fill remaining 3+2 seats from heuristic.
 * Local rows stay heuristic-only in this pass.
 */
export function mergeLiveLeadsIntoShortlist(input: {
  source: SupplierSource;
  liveLeads: SupplierLead[];
  heuristic: MergeableSupplier[];
}): MergeableSupplier[] {
  if (input.source !== "import" || input.liveLeads.length === 0) {
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
      out.push({
        ...seat,
        leadSource: "heuristic",
        platform: null,
        sourceUrl: null,
        externalTitle: null,
      });
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
