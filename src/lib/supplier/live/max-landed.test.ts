import { describe, expect, it } from "vitest";
import { MAX_LANDED_SOFT_OVERAGE } from "@/lib/constants";
import {
  gateLiveLeadsByMaxLanded,
  importSeatShouldHideForMaxLanded,
  leadFitsMaxLanded,
  maxLandedGateFromOnboarding,
} from "@/lib/supplier/live/max-landed";
import { mergeLiveLeadsIntoShortlist } from "@/lib/supplier/live/merge";
import {
  priorRowToImportLead,
  shouldKeepPersistedImportLiveSeat,
  unionImportRefreshLeads,
} from "@/lib/supplier/live/refresh";
import type { SupplierLead } from "@/lib/supplier/live/types";
import { readFileSync } from "fs";
import path from "path";

const gate100 = {
  maxLandedCost: 100,
  intlShip: 0,
  clearanceTaxes: 0,
  localCourier: 0,
};

function lead(hint: number | null, platform: "alibaba" | "aliexpress" = "alibaba"): SupplierLead {
  return {
    name: platform === "aliexpress" ? "AE Seller" : "Ali Seller",
    platform,
    sourceUrl:
      platform === "aliexpress"
        ? "https://www.aliexpress.com/item/100500.html"
        : "https://www.alibaba.com/product-detail/x.html",
    externalTitle: "Widget",
    unitPriceHint: hint,
    leadSource: "live_search",
  };
}

describe("leadFitsMaxLanded", () => {
  it("drops a $300 unit vs $100 cap", () => {
    expect(
      leadFitsMaxLanded({ unitUsd: 300, ...gate100 }),
    ).toBe(false);
  });

  it("keeps $20 unit + $10 legs vs $100 cap", () => {
    expect(
      leadFitsMaxLanded({
        unitUsd: 20,
        maxLandedCost: 100,
        intlShip: 4,
        clearanceTaxes: 3,
        localCourier: 3,
      }),
    ).toBe(true);
  });

  it("drops at 1.2× when unit + legs exceed the soft ceiling", () => {
    expect(MAX_LANDED_SOFT_OVERAGE).toBe(1.2);
    // $95 + $20 = $115 ≤ $120 → still fits
    expect(
      leadFitsMaxLanded({
        unitUsd: 95,
        maxLandedCost: 100,
        intlShip: 10,
        clearanceTaxes: 5,
        localCourier: 5,
      }),
    ).toBe(true);
    // $95 + $26 = $121 > $120 → hide
    expect(
      leadFitsMaxLanded({
        unitUsd: 95,
        maxLandedCost: 100,
        intlShip: 12,
        clearanceTaxes: 8,
        localCourier: 6,
      }),
    ).toBe(false);
  });
});

describe("gateLiveLeadsByMaxLanded + merge", () => {
  const heuristic = [
    {
      name: "H",
      role: "primary" as const,
      rank: 0,
      source: "import" as const,
      years: 5,
      rating: 4.5,
      verified: false,
      moq: 50,
      unitPrice: 10,
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

  it("$320 vs cap 100 is not in merge", () => {
    const merged = mergeLiveLeadsIntoShortlist({
      source: "import",
      liveLeads: [lead(320, "alibaba")],
      heuristic,
      padHeuristic: false,
      maxLandedGate: gate100,
    });
    expect(merged).toHaveLength(0);
    expect(merged.some((m) => m.unitPrice === 320)).toBe(false);
  });

  it("hides over-cap leads and does not invent-pad the hole", () => {
    const gated = gateLiveLeadsByMaxLanded(
      [lead(300, "alibaba"), lead(20, "aliexpress")],
      {
        maxLandedCost: 100,
        intlShip: 4,
        clearanceTaxes: 3,
        localCourier: 3,
      },
    );
    expect(gated.hiddenOverCap).toBe(1);
    expect(gated.kept).toHaveLength(1);
    expect(gated.kept[0]?.platform).toBe("aliexpress");
    expect(gated.kept[0]?.unitPriceHint).toBe(20);

    const merged = mergeLiveLeadsIntoShortlist({
      source: "import",
      liveLeads: [lead(300), lead(20, "aliexpress")],
      heuristic,
      padHeuristic: false,
      maxLandedGate: {
        maxLandedCost: 100,
        intlShip: 4,
        clearanceTaxes: 3,
        localCourier: 3,
      },
    });
    expect(merged).toHaveLength(1);
    expect(merged[0]?.platform).toBe("aliexpress");
    expect(merged[0]?.unitPrice).toBe(20);
    expect(merged.every((m) => m.leadSource === "live_search")).toBe(true);
  });

  it("keeps unknown AliExpress and hides unknown Alibaba", () => {
    const gated = gateLiveLeadsByMaxLanded(
      [lead(null, "alibaba"), lead(null, "aliexpress")],
      gate100,
    );
    expect(gated.hiddenOverCap).toBe(1);
    expect(gated.kept).toHaveLength(1);
    expect(gated.kept[0]?.platform).toBe("aliexpress");
    const mergedAe = mergeLiveLeadsIntoShortlist({
      source: "import",
      liveLeads: [lead(null, "aliexpress")],
      heuristic,
      padHeuristic: false,
      maxLandedGate: gate100,
    });
    expect(mergedAe).toHaveLength(1);
    expect(mergedAe[0]?.unitPrice).toBe(0);
    expect(mergedAe[0]?.sourceUrl).toContain("aliexpress.com");
    const mergedAli = mergeLiveLeadsIntoShortlist({
      source: "import",
      liveLeads: [lead(null, "alibaba")],
      heuristic,
      padHeuristic: false,
      maxLandedGate: gate100,
    });
    expect(mergedAli).toHaveLength(0);
  });

  it("hides an available Import live seat when Assess extracts over-cap unit", () => {
    expect(
      importSeatShouldHideForMaxLanded({
        source: "import",
        leadSource: "live_search",
        status: "available",
        hasSample: false,
        unitUsd: 320,
        gate: gate100,
      }),
    ).toBe(true);
    expect(
      importSeatShouldHideForMaxLanded({
        source: "import",
        leadSource: "live_search",
        status: "available",
        hasSample: false,
        unitUsd: 20,
        gate: gate100,
      }),
    ).toBe(false);
  });

  it("builds a gate from onboarding + money snapshot legs", () => {
    expect(
      maxLandedGateFromOnboarding(100, {
        intlShip: 4,
        clearanceTaxes: 3,
        localCourier: 3,
      }),
    ).toEqual({
      maxLandedCost: 100,
      intlShip: 4,
      clearanceTaxes: 3,
      localCourier: 3,
    });
    expect(
      maxLandedGateFromOnboarding(0, {
        intlShip: 1,
        clearanceTaxes: 1,
        localCourier: 1,
      }),
    ).toBeNull();
  });

  it("Import still queries Alibaba and AliExpress; no Gemini FX", () => {
    const serper = readFileSync(
      path.join(process.cwd(), "src/lib/supplier/live/serper-leads.ts"),
      "utf8",
    );
    expect(serper).toContain("site:alibaba.com/product-detail");
    expect(serper).toContain("site:aliexpress.com/item");
    expect(serper.indexOf("site:aliexpress.com/item")).toBeLessThan(
      serper.indexOf("site:alibaba.com/product-detail"),
    );
    const fx = readFileSync(
      path.join(process.cwd(), "src/lib/supplier/live/unit-price.ts"),
      "utf8",
    );
    expect(fx).not.toContain("gemini");
    expect(fx).not.toContain("GEMINI");
  });
});

describe("unionImportRefreshLeads", () => {
  it("keeps prior cheap AliExpress when incoming is one survivor", () => {
    const prior = [
      lead(8, "aliexpress"),
      {
        ...lead(12, "aliexpress"),
        sourceUrl: "https://www.aliexpress.com/item/100501.html",
        name: "AE Two",
      },
    ];
    const incoming = [lead(9, "aliexpress")];
    const unioned = unionImportRefreshLeads({
      incoming,
      prior,
      gate: gate100,
      maxSeats: 5,
    });
    expect(unioned.length).toBeGreaterThanOrEqual(2);
    expect(
      unioned.filter((l) => l.sourceUrl.includes("aliexpress.com")),
    ).toHaveLength(unioned.length);
    expect(
      unionImportRefreshLeads({
        incoming: [lead(320, "alibaba")],
        prior,
        gate: gate100,
        maxSeats: 5,
      }).some((l) => l.unitPriceHint === 320),
    ).toBe(false);
  });

  it("invent $12 + Alibaba live URL is not shown", () => {
    const inventAli = priorRowToImportLead({
      leadSource: "live_search",
      platform: "alibaba",
      sourceUrl:
        "https://www.alibaba.com/product-detail/RingConn-Gen-3_1.html",
      name: "Alibaba listing · RingConn Gen 3",
      unitPrice: 12,
    });
    expect(inventAli?.unitPriceHint).toBe(12);
    expect(
      shouldKeepPersistedImportLiveSeat(
        {
          leadSource: "live_search",
          platform: "alibaba",
          sourceUrl:
            "https://www.alibaba.com/product-detail/RingConn-Gen-3_1.html",
          name: "Alibaba listing · RingConn Gen 3",
          unitPrice: 12,
          status: "available",
          source: "import",
        },
        gate100,
      ),
    ).toBe(false);
    expect(
      unionImportRefreshLeads({
        incoming: [],
        prior: inventAli ? [inventAli] : [],
        gate: gate100,
        maxSeats: 5,
      }),
    ).toHaveLength(0);
  });

  it("keeps prior AE LBP-converted unit vs cap 100", () => {
    const aeLbp = priorRowToImportLead({
      leadSource: "live_search",
      platform: "aliexpress",
      sourceUrl: "https://www.aliexpress.com/item/100500.html",
      name: "AE Seller",
      unitPrice: 3.35,
    });
    expect(
      unionImportRefreshLeads({
        incoming: [],
        prior: aeLbp ? [aeLbp] : [],
        gate: gate100,
        maxSeats: 5,
      }),
    ).toHaveLength(1);
    expect(
      shouldKeepPersistedImportLiveSeat(
        {
          leadSource: "live_search",
          platform: "aliexpress",
          sourceUrl: "https://www.aliexpress.com/item/100500.html",
          name: "AE Seller",
          unitPrice: 3.35,
          status: "available",
          source: "import",
        },
        gate100,
      ),
    ).toBe(true);
  });

  it("drops prior RingConn-priced Alibaba and maps prior rows", () => {
    expect(
      priorRowToImportLead({
        leadSource: "heuristic",
        platform: "alibaba",
        sourceUrl: "https://www.alibaba.com/product-detail/x.html",
        name: "H",
        unitPrice: 10,
      }),
    ).toBeNull();
    const ring = priorRowToImportLead({
      leadSource: "live_search",
      platform: "alibaba",
      sourceUrl:
        "https://www.alibaba.com/product-detail/RingConn-Gen-3_1.html",
      name: "RingConn",
      unitPrice: 320,
    });
    expect(ring?.unitPriceHint).toBe(320);
    const unioned = unionImportRefreshLeads({
      incoming: [],
      prior: ring ? [ring] : [],
      gate: gate100,
      maxSeats: 5,
    });
    expect(unioned).toHaveLength(0);
  });
});
