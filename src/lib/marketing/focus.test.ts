import { describe, expect, it } from "vitest";
import {
  resolveDefaultFocusStage,
  resolveMarketingJourneyFlags,
  resolveUnlockedStages,
} from "@/lib/marketing/focus";

describe("resolveMarketingJourneyFlags (per-SKU)", () => {
  const sellingSku = {
    primaryState: "selling",
    sampleStatus: "approved",
    batchOrdered: true,
    batchArrivedReady: true,
    marketingStage: "weekly_refresh",
    batchArrivalEta: null,
  };

  const sampleOnlySku = {
    primaryState: "sample_approved",
    sampleStatus: "approved",
    batchOrdered: false,
    batchArrivedReady: false,
    marketingStage: "intro_pdf",
    batchArrivalEta: null,
  };

  const pollutedLegacy = {
    primaryState: "selling",
    sampleStatus: "approved",
    batchOrdered: true,
    batchArrivedReady: true,
    marketingStage: "weekly_refresh",
    batchArrivalEta: null,
  };

  it("uses skuJourney only — ignores polluted workspace side flags", () => {
    const flags = resolveMarketingJourneyFlags({
      skuJourney: sampleOnlySku,
      legacy: pollutedLegacy,
    });
    expect(flags.sampleApproved).toBe(true);
    expect(flags.batchOrdered).toBe(false);
    expect(flags.batchArrivedReady).toBe(false);
    expect(flags.primaryState).toBe("sample_approved");
    expect(flags.marketingStage).toBe("intro_pdf");

    const stages = resolveUnlockedStages({
      sampleApproved: flags.sampleApproved,
      batchOrdered: flags.batchOrdered,
      batchArrivedReady: flags.batchArrivedReady,
      hasLaunchKit: false,
    });
    expect(stages.find((s) => s.stage === "intro_pdf")?.unlocked).toBe(true);
    expect(stages.find((s) => s.stage === "pre_launch")?.unlocked).toBe(false);
    expect(stages.find((s) => s.stage === "launch")?.unlocked).toBe(false);
    expect(stages.find((s) => s.stage === "weekly_refresh")?.unlocked).toBe(
      false,
    );

    expect(
      resolveDefaultFocusStage({
        ...flags,
        stages,
        sideStage: flags.marketingStage,
      }),
    ).toBe("intro_pdf");
  });

  it("selling SKU unlocks weekly refresh when it has a launch kit", () => {
    const flags = resolveMarketingJourneyFlags({
      skuJourney: sellingSku,
      legacy: null,
    });
    const stages = resolveUnlockedStages({
      sampleApproved: flags.sampleApproved,
      batchOrdered: flags.batchOrdered,
      batchArrivedReady: flags.batchArrivedReady,
      hasLaunchKit: true,
    });
    expect(
      resolveDefaultFocusStage({
        ...flags,
        stages,
        sideStage: "weekly_refresh",
      }),
    ).toBe("weekly_refresh");
  });

  it("falls back to legacy workspace flags when no skuJourney", () => {
    const flags = resolveMarketingJourneyFlags({
      skuJourney: null,
      legacy: pollutedLegacy,
    });
    expect(flags.batchArrivedReady).toBe(true);
    expect(flags.primaryState).toBe("selling");
    expect(flags.marketingStage).toBe("weekly_refresh");
  });

  it("resolves pausedFromState for skuJourney", () => {
    const flags = resolveMarketingJourneyFlags({
      skuJourney: {
        ...sampleOnlySku,
        primaryState: "paused",
        pausedFromState: "sample_approved",
      },
      legacy: pollutedLegacy,
    });
    expect(flags.primaryState).toBe("sample_approved");
    expect(flags.batchOrdered).toBe(false);
  });

  it("maps legacy monthly_refresh marketingStage to weekly_refresh", () => {
    const flags = resolveMarketingJourneyFlags({
      skuJourney: {
        primaryState: "selling",
        sampleStatus: "approved",
        batchOrdered: true,
        batchArrivedReady: true,
        marketingStage: "monthly_refresh",
        batchArrivalEta: null,
      },
      legacy: null,
    });
    expect(flags.marketingStage).toBe("weekly_refresh");
  });
});
