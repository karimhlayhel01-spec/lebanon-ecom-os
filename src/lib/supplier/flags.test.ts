import { describe, expect, it } from "vitest";
import {
  resolveSupplierJourneyFlags,
} from "@/lib/supplier/flags";
import { canShowSupplierShortlist } from "@/lib/supplier/source";

describe("resolveSupplierJourneyFlags (per-SKU)", () => {
  const sellingApproved = {
    primaryState: "selling",
    sampleStatus: "approved",
    batchOrdered: true,
    batchArrivedReady: true,
    batchArrivalEta: null,
    costQuotesSaved: true,
  };

  const freshSample = {
    primaryState: "supplier_sample",
    sampleStatus: "none",
    batchOrdered: false,
    batchArrivedReady: false,
    batchArrivalEta: null,
    costQuotesSaved: false,
  };

  it("uses skuJourney only — ignores polluted workspace side from SKU A", () => {
    const flags = resolveSupplierJourneyFlags({
      skuJourney: freshSample,
      legacy: sellingApproved,
    });
    expect(flags.sampleApproved).toBe(false);
    expect(flags.sampleStatus).toBe("none");
    expect(flags.batchOrdered).toBe(false);
    expect(flags.costQuotesSaved).toBe(false);
  });

  it("unlocks sampleApproved from THIS SKU’s approved sample", () => {
    const flags = resolveSupplierJourneyFlags({
      skuJourney: {
        ...freshSample,
        primaryState: "sample_approved",
        sampleStatus: "approved",
      },
      legacy: sellingApproved,
    });
    expect(flags.sampleApproved).toBe(true);
    expect(flags.batchOrdered).toBe(false);
  });

  it("falls back to legacy when no skuJourney", () => {
    const flags = resolveSupplierJourneyFlags({
      skuJourney: null,
      legacy: sellingApproved,
    });
    expect(flags.sampleApproved).toBe(true);
    expect(flags.batchOrdered).toBe(true);
    expect(flags.costQuotesSaved).toBe(true);
  });

  it("resolves pausedFromState for skuJourney", () => {
    const flags = resolveSupplierJourneyFlags({
      skuJourney: {
        ...freshSample,
        primaryState: "paused",
        pausedFromState: "supplier_sample",
      },
      legacy: sellingApproved,
    });
    expect(flags.primaryState).toBe("supplier_sample");
    expect(flags.sampleApproved).toBe(false);
  });

  it("new SKU supplier_sample: shortlist path, cost quotes locked (no A bleed)", () => {
    const flags = resolveSupplierJourneyFlags({
      skuJourney: freshSample,
      legacy: sellingApproved,
    });
    const showShortlist = canShowSupplierShortlist({
      hasActiveSample: false,
      sampleApproved: flags.sampleApproved,
      batchOrdered: flags.batchOrdered,
    });
    expect(showShortlist).toBe(true);
    expect(flags.sampleApproved).toBe(false); // costQuotes.unlocked
    expect(flags.costQuotesSaved).toBe(false);
  });
});
