import { describe, expect, it } from "vitest";
import {
  combineImportLeadsForPriceFill,
  fillImportLeadUnitPrices,
} from "@/lib/supplier/live/fill-import-price";
import { mergeLiveLeadsIntoShortlist } from "@/lib/supplier/live/merge";
import type { SupplierLead } from "@/lib/supplier/live/types";

const gate100legs10 = {
  maxLandedCost: 100,
  intlShip: 4,
  clearanceTaxes: 3,
  localCourier: 3,
};

function lead(
  hint: number | null,
  url = "https://www.alibaba.com/product-detail/x.html",
): SupplierLead {
  return {
    name: "Live Co",
    platform: url.includes("aliexpress") ? "aliexpress" : "alibaba",
    sourceUrl: url,
    externalTitle: "Ring",
    unitPriceHint: hint,
    leadSource: "live_search",
  };
}

const heuristic = [
  {
    name: "Invent Co",
    role: "primary" as const,
    rank: 0,
    source: "import" as const,
    years: 5,
    rating: 4.5,
    verified: false,
    moq: 50,
    unitPrice: 12,
    sampleReplies: true,
    negotiationDraft: "draft",
    paymentMapEstimate: "{}",
    redFlags: [] as string[],
    leadSource: "heuristic" as const,
    platform: null,
    sourceUrl: null,
    externalTitle: null,
  },
];

describe("fillImportLeadUnitPrices + Import merge gate", () => {
  it("hint null + no scrape price → unknown Alibaba hidden, AliExpress kept", async () => {
    const filledAli = await fillImportLeadUnitPrices({
      leads: [lead(null)],
      scrapeFn: async () => ({ ok: true, text: "No price on this page" }),
    });
    expect(filledAli.leads[0]?.unitPriceHint).toBeNull();
    expect(filledAli.scrapesUsed).toBe(1);
    expect(
      mergeLiveLeadsIntoShortlist({
        source: "import",
        liveLeads: filledAli.leads,
        heuristic,
        padHeuristic: false,
        maxLandedGate: gate100legs10,
      }),
    ).toHaveLength(0);

    const filledAe = await fillImportLeadUnitPrices({
      leads: [lead(null, "https://www.aliexpress.com/item/9.html")],
      scrapeFn: async () => ({ ok: true, text: "No price on this page" }),
    });
    const mergedAe = mergeLiveLeadsIntoShortlist({
      source: "import",
      liveLeads: filledAe.leads,
      heuristic,
      padHeuristic: false,
      maxLandedGate: gate100legs10,
    });
    expect(mergedAe).toHaveLength(1);
    expect(mergedAe[0]?.unitPrice).toBe(0);
    expect(mergedAe[0]?.sourceUrl).toContain("aliexpress.com");
  });

  it("scrape/extract $320-340 vs cap $100 → dropped", async () => {
    const filled = await fillImportLeadUnitPrices({
      leads: [lead(null)],
      scrapeFn: async () => ({
        ok: true,
        text: "RingConn Gen 3 $5 off $300 · $320-340",
      }),
    });
    expect(filled.leads[0]?.unitPriceHint).toBe(320);
    const merged = mergeLiveLeadsIntoShortlist({
      source: "import",
      liveLeads: filled.leads,
      heuristic,
      padHeuristic: false,
      maxLandedGate: { ...gate100legs10, intlShip: 0, clearanceTaxes: 0, localCourier: 0 },
    });
    expect(merged).toHaveLength(0);
  });

  it("$20 + $10 legs vs cap $100 → kept", () => {
    const merged = mergeLiveLeadsIntoShortlist({
      source: "import",
      liveLeads: [lead(20, "https://www.aliexpress.com/item/1.html")],
      heuristic,
      padHeuristic: false,
      maxLandedGate: gate100legs10,
    });
    expect(merged).toHaveLength(1);
    expect(merged[0]?.unitPrice).toBe(20);
    expect(merged[0]?.sourceUrl).toContain("aliexpress.com");
  });

  it("LBP 300000 at 89500 vs cap 100 → kept (~$3.35)", async () => {
    const filled = await fillImportLeadUnitPrices({
      leads: [lead(null, "https://www.aliexpress.com/item/2.html")],
      usdLbpRate: 89500,
      scrapeFn: async () => ({ ok: true, text: "LBP 300000 / piece" }),
    });
    expect(filled.leads[0]?.unitPriceHint).toBeCloseTo(3.35, 2);
    const merged = mergeLiveLeadsIntoShortlist({
      source: "import",
      liveLeads: filled.leads,
      heuristic,
      padHeuristic: false,
      maxLandedGate: gate100legs10,
    });
    expect(merged).toHaveLength(1);
    expect(merged[0]?.unitPrice).toBeCloseTo(3.35, 2);
  });

  it("invent unit must not appear on a live sourceUrl", () => {
    const merged = mergeLiveLeadsIntoShortlist({
      source: "import",
      liveLeads: [lead(null, "https://www.aliexpress.com/item/x.html")],
      heuristic,
      padHeuristic: false,
      maxLandedGate: gate100legs10,
    });
    expect(merged).toHaveLength(1);
    expect(merged[0]?.unitPrice).toBe(0);
    expect(merged[0]?.unitPrice).not.toBe(12);
    const padded = mergeLiveLeadsIntoShortlist({
      source: "import",
      liveLeads: [lead(null)],
      heuristic,
      padHeuristic: true,
    });
    expect(padded.every((m) => m.sourceUrl == null)).toBe(true);
    expect(padded.every((m) => m.leadSource === "heuristic")).toBe(true);
    expect(padded.some((m) => m.unitPrice === 12 && m.sourceUrl)).toBe(false);
  });

  it("scrapes AliExpress before Alibaba", async () => {
    const seen: string[] = [];
    await fillImportLeadUnitPrices({
      leads: [
        lead(null, "https://www.alibaba.com/product-detail/ring.html"),
        lead(null, "https://www.aliexpress.com/item/1.html"),
        lead(null, "https://www.aliexpress.com/item/2.html"),
      ],
      maxScrapes: 2,
      scrapeFn: async (url) => {
        seen.push(url);
        return { ok: true, text: "US$ 8 / piece" };
      },
    });
    expect(seen).toHaveLength(2);
    expect(seen.every((u) => u.includes("aliexpress.com"))).toBe(true);
  });

  it("combine prior + incoming prefers incoming unit and AE-first", () => {
    const prior = [lead(null, "https://www.alibaba.com/product-detail/old.html")];
    const incoming = [
      lead(null, "https://www.aliexpress.com/item/new.html"),
      lead(20, "https://www.alibaba.com/product-detail/old.html"),
    ];
    const combined = combineImportLeadsForPriceFill(incoming, prior);
    expect(combined[0]?.sourceUrl).toContain("aliexpress.com");
    expect(
      combined.find((l) => l.sourceUrl.includes("old.html"))?.unitPriceHint,
    ).toBe(20);
  });

  it("bounds scrapes at 5", async () => {
    const leads = Array.from({ length: 7 }, (_, i) =>
      lead(null, `https://www.alibaba.com/product-detail/${i}.html`),
    );
    const filled = await fillImportLeadUnitPrices({
      leads,
      maxScrapes: 5,
      scrapeFn: async () => ({ ok: true, text: "US$ 9 / piece" }),
    });
    expect(filled.scrapesUsed).toBe(5);
    expect(filled.leads.filter((l) => l.unitPriceHint === 9)).toHaveLength(5);
    expect(filled.leads.filter((l) => l.unitPriceHint == null)).toHaveLength(2);
  });
});
