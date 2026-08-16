import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import {
  effectiveJourneyState,
  filterSkuHeroCtas,
  isSkuFinanceSectionUnlocked,
  isSkuMarketingSectionUnlocked,
  isSkuStoreSectionUnlocked,
  SKU_BATCH_ARRIVED_HREF,
  SKU_BATCH_ARRIVED_ID,
  skuHeroHrefSectionId,
} from "@/lib/sku/page-sections";

describe("isSkuMarketingSectionUnlocked", () => {
  it("is locked at supplier_sample / accepted", () => {
    expect(
      isSkuMarketingSectionUnlocked({
        sampleStatus: "none",
        primaryState: "supplier_sample",
      }),
    ).toBe(false);
    expect(
      isSkuMarketingSectionUnlocked({
        sampleStatus: "requested",
        primaryState: "supplier_sample",
      }),
    ).toBe(false);
  });

  it("unlocks when sample approved (status or state)", () => {
    expect(
      isSkuMarketingSectionUnlocked({
        sampleStatus: "approved",
        primaryState: "supplier_sample",
      }),
    ).toBe(true);
    expect(
      isSkuMarketingSectionUnlocked({
        sampleStatus: "none",
        primaryState: "sample_approved",
      }),
    ).toBe(true);
    expect(
      isSkuMarketingSectionUnlocked({
        sampleStatus: "approved",
        primaryState: "batch_ordered",
      }),
    ).toBe(true);
  });

  it("stays unlocked when paused from a post-sample state", () => {
    expect(
      isSkuMarketingSectionUnlocked({
        sampleStatus: "approved",
        primaryState: "paused",
        pausedFromState: "sample_approved",
      }),
    ).toBe(true);
  });
});

describe("isSkuStoreSectionUnlocked", () => {
  it("matches marketing unlock (sample approved)", () => {
    expect(
      isSkuStoreSectionUnlocked({
        sampleStatus: "none",
        primaryState: "supplier_sample",
      }),
    ).toBe(false);
    expect(
      isSkuStoreSectionUnlocked({
        sampleStatus: "approved",
        primaryState: "supplier_sample",
      }),
    ).toBe(true);
    expect(
      isSkuStoreSectionUnlocked({
        sampleStatus: "none",
        primaryState: "store_setup",
      }),
    ).toBe(true);
  });
});

describe("isSkuFinanceSectionUnlocked", () => {
  it("is locked before batch arrived (accepted / sample / ordered)", () => {
    expect(
      isSkuFinanceSectionUnlocked({
        batchArrivedReady: false,
        primaryState: "supplier_sample",
      }),
    ).toBe(false);
    expect(
      isSkuFinanceSectionUnlocked({
        batchArrivedReady: false,
        primaryState: "sample_approved",
      }),
    ).toBe(false);
    expect(
      isSkuFinanceSectionUnlocked({
        batchArrivedReady: false,
        primaryState: "batch_ordered",
      }),
    ).toBe(false);
  });

  it("unlocks when batch arrived or selling", () => {
    expect(
      isSkuFinanceSectionUnlocked({
        batchArrivedReady: true,
        primaryState: "batch_arrived_ready",
      }),
    ).toBe(true);
    expect(
      isSkuFinanceSectionUnlocked({
        batchArrivedReady: false,
        primaryState: "selling",
      }),
    ).toBe(true);
  });

  it("stays unlocked when paused from selling", () => {
    expect(
      isSkuFinanceSectionUnlocked({
        batchArrivedReady: true,
        primaryState: "paused",
        pausedFromState: "selling",
      }),
    ).toBe(true);
  });
});

describe("filterSkuHeroCtas", () => {
  const ctas = [
    { href: "#supplier", label: "sample" },
    { href: "#marketing", label: "mkt" },
    { href: "#finance", label: "fin" },
  ];

  it("keeps supplier-only when both sections locked", () => {
    expect(
      filterSkuHeroCtas(ctas, { marketing: false, finance: false }).map(
        (c) => c.href,
      ),
    ).toEqual(["#supplier"]);
  });

  it("allows marketing after sample; finance only when unlocked", () => {
    expect(
      filterSkuHeroCtas(ctas, { marketing: true, finance: false }).map(
        (c) => c.href,
      ),
    ).toEqual(["#supplier", "#marketing"]);
    expect(
      filterSkuHeroCtas(ctas, { marketing: true, finance: true }).map(
        (c) => c.href,
      ),
    ).toEqual(["#supplier", "#marketing", "#finance"]);
  });

  it("keeps #batch-arrived (not a marketing/finance lock)", () => {
    expect(
      filterSkuHeroCtas(
        [
          { href: SKU_BATCH_ARRIVED_HREF, label: "arrived" },
          { href: "#marketing", label: "mkt" },
        ],
        { marketing: true, finance: false },
      ).map((c) => c.href),
    ).toEqual([SKU_BATCH_ARRIVED_HREF, "#marketing"]);
  });
});

describe("batch_ordered hero → Batch arrived card", () => {
  it("hero href for batch_ordered is #batch-arrived, mapped to supplier section", () => {
    expect(SKU_BATCH_ARRIVED_HREF).toBe("#batch-arrived");
    expect(skuHeroHrefSectionId(SKU_BATCH_ARRIVED_HREF)).toBe("supplier");
    expect(skuHeroHrefSectionId("#marketing")).toBe("marketing");
  });

  it("SKU page primary CTA uses #batch-arrived; card id exists when shown", () => {
    const page = readFileSync(
      path.join(process.cwd(), "src/app/[locale]/sku/[id]/page.tsx"),
      "utf8",
    );
    expect(page).toMatch(/case "batch_ordered"/);
    expect(page).toMatch(/SKU_BATCH_ARRIVED_HREF/);

    const panel = readFileSync(
      path.join(process.cwd(), "src/components/supplier/SupplierPanel.tsx"),
      "utf8",
    );
    expect(panel).toMatch(/batchOrdered && !view\.batchArrivedReady/);
    expect(panel).toMatch(`id="${SKU_BATCH_ARRIVED_ID}"`);
  });
});

describe("effectiveJourneyState", () => {
  it("resolves pausedFromState when paused", () => {
    expect(
      effectiveJourneyState({
        primaryState: "paused",
        pausedFromState: "selling",
      }),
    ).toBe("selling");
    expect(effectiveJourneyState({ primaryState: "sample_approved" })).toBe(
      "sample_approved",
    );
  });
});
