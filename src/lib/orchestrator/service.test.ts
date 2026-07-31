import { describe, expect, it } from "vitest";
import {
  SKU_SPECIFIC_CTA_IDS,
  buildShopOrchestration,
  buildSkuCtas,
  buildSkuOrchestration,
} from "@/lib/orchestrator/service";
import { reorderInvestNextTone } from "@/lib/supplier/reorder";
import { resolveSkuInvestNextTone } from "@/lib/supplier/reorder-economics";

describe("buildShopOrchestration", () => {
  it("never emits SKU-specific CTAs (even when shop has mixed journeys)", () => {
    const shop = buildShopOrchestration({
      liveSkuCount: 2,
      anySelling: true,
      storeReady: false,
    });
    expect(shop.ctas).toEqual([]);
    for (const cta of shop.ctas) {
      expect(SKU_SPECIFIC_CTA_IDS.has(cta.id)).toBe(false);
    }
  });

  it("uses shop themes: multi-SKU, COD, margins — not sampleFirst", () => {
    const shop = buildShopOrchestration({
      liveSkuCount: 2,
      anySelling: true,
      storeReady: true,
    });
    const ids = shop.coaching.map((c) => c.id);
    expect(ids).toContain("multiSku");
    expect(ids).toContain("codRisk");
    expect(ids).toContain("cashCod");
    expect(ids).toContain("protectMargins");
    expect(ids).not.toContain("sampleFirst");
    expect(ids).not.toContain("costQuotesPending");
  });
});

describe("multi-SKU hub vs per-SKU CTAs", () => {
  it("SKU A needs sample while SKU B needs batch — hub does not claim requestSample", () => {
    const skuA = buildSkuOrchestration({
      primaryState: "supplier_sample",
      sampleStatus: "none",
      costQuotesSaved: false,
      storeReady: false,
      anyOverLimit: false,
    });
    const skuB = buildSkuOrchestration({
      primaryState: "sample_approved",
      sampleStatus: "approved",
      costQuotesSaved: true,
      storeReady: false,
      anyOverLimit: false,
    });

    expect(skuA.ctas.map((c) => c.id)).toContain("requestSample");
    expect(skuB.ctas.map((c) => c.id)).toContain("orderBatch");
    expect(skuB.ctas.map((c) => c.id)).not.toContain("requestSample");

    // Hub with both live: shop tips only — must not copy A's requestSample.
    const hub = buildShopOrchestration({
      liveSkuCount: 2,
      anySelling: false,
      storeReady: false,
    });
    expect(hub.ctas.map((c) => c.id)).not.toContain("requestSample");
    expect(hub.ctas.map((c) => c.id)).not.toContain("orderBatch");
    expect(hub.coaching.map((c) => c.id)).toContain("multiSku");
  });

  it("buildSkuCtas follows that SKU sampleStatus, not a foreign state", () => {
    const needingBatch = buildSkuCtas({
      primaryState: "sample_approved",
      sampleStatus: "approved",
      costQuotesSaved: true,
      storeReady: false,
      anyOverLimit: false,
    });
    expect(needingBatch.ctas.map((c) => c.id)).toEqual(
      expect.arrayContaining(["orderBatch", "storeSetup", "marketingIntro"]),
    );
    expect(needingBatch.ctas.map((c) => c.id)).not.toContain("requestSample");
  });

  it("selling surfaces reorder CTA on nudge; mark arrived when ordered", () => {
    const nudged = buildSkuCtas({
      primaryState: "selling",
      sampleStatus: "approved",
      costQuotesSaved: true,
      storeReady: true,
      anyOverLimit: false,
      reorderStatus: "idle",
      reorderNudge: true,
      reorderInvestTone: "strengthen",
    });
    expect(nudged.ctas.map((c) => c.id)).toContain("reorderBatch");
    expect(nudged.ctas.map((c) => c.id)).toContain("logWeek");

    const inTransit = buildSkuCtas({
      primaryState: "selling",
      sampleStatus: "approved",
      costQuotesSaved: true,
      storeReady: true,
      anyOverLimit: false,
      reorderStatus: "ordered",
      reorderNudge: false,
    });
    expect(inTransit.ctas.map((c) => c.id)).toContain("markReorderArrived");
    expect(inTransit.ctas.map((c) => c.id)).not.toContain("reorderBatch");
  });

  it("per-SKU reorder tone: weak A warns; healthy B can strengthen (no shop bleed)", () => {
    // Same Mode C weeks as Fix #3 economics isolation — shop blended looks fine,
    // but SKU A after-share is weak while B is reinvest.
    const entries = [1, 2, 3, 4].map((n) => ({
      weekStart: `2026-0${n}-01`,
      sales: 600,
      skuSold: 60,
      metaSpend: 40,
      tiktokSpend: 0,
      courierFees: 20,
      skus: {
        a: { sales: 100, sold: 10, left: 10 },
        b: { sales: 500, sold: 50, left: 10 },
      },
    }));

    const toneA = reorderInvestNextTone({
      recommendation: resolveSkuInvestNextTone({
        skuId: "a",
        entries,
        importCogsPerUnit: 8,
      }),
      runwayNudge: true,
    });
    const toneB = reorderInvestNextTone({
      recommendation: resolveSkuInvestNextTone({
        skuId: "b",
        entries,
        importCogsPerUnit: 5,
      }),
      runwayNudge: true,
    });

    expect(toneA).toBe("warn");
    expect(toneB).toBe("strengthen");

    const orchA = buildSkuOrchestration({
      primaryState: "selling",
      sampleStatus: "approved",
      costQuotesSaved: true,
      storeReady: true,
      anyOverLimit: false,
      reorderStatus: "idle",
      reorderNudge: true,
      reorderInvestTone: toneA,
    });
    const orchB = buildSkuOrchestration({
      primaryState: "selling",
      sampleStatus: "approved",
      costQuotesSaved: true,
      storeReady: true,
      anyOverLimit: false,
      reorderStatus: "idle",
      reorderNudge: true,
      reorderInvestTone: toneB,
    });

    expect(orchA.coaching.map((c) => c.id)).toContain("reorderEconomicsWarn");
    expect(orchA.coaching.map((c) => c.id)).not.toContain("reorderReinvest");
    expect(orchB.coaching.map((c) => c.id)).toContain("reorderReinvest");
    expect(orchB.coaching.map((c) => c.id)).not.toContain("reorderEconomicsWarn");
  });
});
