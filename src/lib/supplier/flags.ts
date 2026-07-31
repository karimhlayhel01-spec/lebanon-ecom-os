/**
 * Per-SKU supplier journey flags — never OR workspace sideStatuses into a SKU
 * that has its own sku_journeys row (Wave 1 multi-SKU).
 */

const SAMPLE_APPROVED_STATES = new Set([
  "sample_approved",
  "store_setup",
  "batch_ordered",
  "batch_arrived_ready",
  "selling",
]);

export type SkuSupplierJourneyInput = {
  primaryState: string;
  pausedFromState?: string | null;
  sampleStatus: string;
  batchOrdered: boolean;
  batchArrivedReady: boolean;
  batchArrivalEta?: string | null;
  costQuotesSaved: boolean;
};

export type LegacySupplierJourneyInput = {
  primaryState: string;
  sampleStatus: string;
  batchOrdered: boolean;
  batchArrivedReady: boolean;
  batchArrivalEta?: string | null;
  costQuotesSaved: boolean;
};

export type ResolvedSupplierJourneyFlags = {
  primaryState: string;
  sampleStatus: string;
  sampleApproved: boolean;
  batchOrdered: boolean;
  batchArrivedReady: boolean;
  batchArrivalEta: string | null;
  costQuotesSaved: boolean;
};

/**
 * When `skuJourney` exists, use that SKU only.
 * Legacy single-SKU (no skuJourney) falls back to workspace journey/side.
 */
export function resolveSupplierJourneyFlags(args: {
  skuJourney: SkuSupplierJourneyInput | null;
  legacy: LegacySupplierJourneyInput | null;
}): ResolvedSupplierJourneyFlags {
  const src = args.skuJourney ?? args.legacy;
  if (!src) {
    return {
      primaryState: "",
      sampleStatus: "none",
      sampleApproved: false,
      batchOrdered: false,
      batchArrivedReady: false,
      batchArrivalEta: null,
      costQuotesSaved: false,
    };
  }

  let primaryState = src.primaryState;
  if (
    args.skuJourney &&
    primaryState === "paused" &&
    args.skuJourney.pausedFromState
  ) {
    primaryState = args.skuJourney.pausedFromState;
  }

  const sampleStatus = src.sampleStatus || "none";
  const sampleApproved =
    sampleStatus === "approved" || SAMPLE_APPROVED_STATES.has(primaryState);

  return {
    primaryState,
    sampleStatus,
    sampleApproved,
    batchOrdered: src.batchOrdered,
    batchArrivedReady: src.batchArrivedReady,
    batchArrivalEta: src.batchArrivalEta ?? null,
    costQuotesSaved: src.costQuotesSaved,
  };
}
