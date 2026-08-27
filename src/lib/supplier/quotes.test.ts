import { describe, expect, it } from "vitest";
import { costBasisForSku } from "@/lib/finance/service";
import type { SkuCardView } from "@/lib/sku/service";
import {
  buildPersistedQuotedCosts,
  costQuotesNeedRefresh,
  knownWorkingUnitPrice,
  pathSwitchShouldStaleCostQuotes,
  resolveCostQuotesDisplayMode,
  resolveCostQuotesPrefill,
} from "@/lib/supplier/quotes";

describe("resolveCostQuotesDisplayMode", () => {
  it("stays locked when quotes are not unlocked", () => {
    expect(
      resolveCostQuotesDisplayMode({
        unlocked: false,
        browseShortlist: true,
      }),
    ).toBe("locked");
    expect(
      resolveCostQuotesDisplayMode({
        unlocked: false,
        browseShortlist: false,
      }),
    ).toBe("locked");
  });

  it("collapses the form while spare shortlist browse is open", () => {
    expect(
      resolveCostQuotesDisplayMode({
        unlocked: true,
        browseShortlist: true,
      }),
    ).toBe("collapsed");
  });

  it("shows the full form when browse is closed and unlocked", () => {
    expect(
      resolveCostQuotesDisplayMode({
        unlocked: true,
        browseShortlist: false,
      }),
    ).toBe("form");
  });

  it("keeps the form expanded after path-switch refresh even if browse is open", () => {
    expect(
      resolveCostQuotesDisplayMode({
        unlocked: true,
        browseShortlist: true,
        needsRefresh: true,
      }),
    ).toBe("form");
  });

  it("collapses when stage prefers quiet costs (not the costs/batch job)", () => {
    expect(
      resolveCostQuotesDisplayMode({
        unlocked: true,
        browseShortlist: false,
        preferCollapsed: true,
      }),
    ).toBe("collapsed");
  });

  it("needsRefresh still wins over preferCollapsed", () => {
    expect(
      resolveCostQuotesDisplayMode({
        unlocked: true,
        browseShortlist: false,
        preferCollapsed: true,
        needsRefresh: true,
      }),
    ).toBe("form");
  });
});

describe("pathSwitchShouldStaleCostQuotes", () => {
  it("stales quotes on warm and crisis_skip path switch", () => {
    expect(pathSwitchShouldStaleCostQuotes("warm")).toBe(true);
    expect(pathSwitchShouldStaleCostQuotes("crisis_skip")).toBe(true);
  });

  it("does not stale on cold sample start", () => {
    expect(pathSwitchShouldStaleCostQuotes("cold_sample")).toBe(false);
  });
});

describe("costQuotesNeedRefresh / spare approve does not stale", () => {
  it("needs refresh only when unlocked, unsaved, and prior quotes exist", () => {
    expect(
      costQuotesNeedRefresh({
        unlocked: true,
        saved: false,
        hasQuoted: true,
      }),
    ).toBe(true);
    // First path after approve — no prior quotes yet.
    expect(
      costQuotesNeedRefresh({
        unlocked: true,
        saved: false,
        hasQuoted: false,
      }),
    ).toBe(false);
    // Spare approve leaves saved flag alone.
    expect(
      costQuotesNeedRefresh({
        unlocked: true,
        saved: true,
        hasQuoted: true,
      }),
    ).toBe(false);
  });
});

describe("resolveCostQuotesPrefill after path switch", () => {
  const planning = {
    productCost: 4,
    intlShip: 1,
    clearanceTaxes: 0.5,
    supplierDelivery: 1,
    packaging: 0.5,
    localCourier: 2,
    sellPrice: 30,
  };
  const quoted = {
    productCost: 5,
    intlShip: 1.2,
    clearanceTaxes: 0.8,
    localCourier: 2.5,
    sellPrice: 32,
    supplierDelivery: 1.2,
    packaging: 0.8,
  };

  it("keeps saved quoted numbers when still saved", () => {
    expect(
      resolveCostQuotesPrefill({
        saved: true,
        quoted,
        planningPrefill: planning,
        workingUnitPrice: 9,
      }).productCost,
    ).toBe(5);
  });

  it("prefills product unit cost from the new working supplier when unsaved", () => {
    const prefill = resolveCostQuotesPrefill({
      saved: false,
      quoted,
      planningPrefill: planning,
      workingUnitPrice: 7.5,
    });
    expect(prefill.productCost).toBe(7.5);
    // Other legs stay as a starting point from prior quotes.
    expect(prefill.intlShip).toBe(1.2);
    expect(prefill.sellPrice).toBe(32);
  });

  it("treats working unitPrice <= 0 as missing (not $0)", () => {
    expect(knownWorkingUnitPrice(0)).toBeNull();
    expect(knownWorkingUnitPrice(-1)).toBeNull();
    expect(knownWorkingUnitPrice(null)).toBeNull();
    expect(knownWorkingUnitPrice(7.5)).toBe(7.5);
    expect(
      resolveCostQuotesPrefill({
        saved: false,
        quoted: null,
        planningPrefill: planning,
        workingUnitPrice: 0,
      }).productCost,
    ).toBe(4);
    expect(
      resolveCostQuotesPrefill({
        saved: false,
        quoted: null,
        planningPrefill: planning,
        workingUnitPrice: -1,
      }).productCost,
    ).toBe(4);
    expect(
      resolveCostQuotesPrefill({
        saved: false,
        quoted,
        planningPrefill: planning,
        workingUnitPrice: 0,
      }).productCost,
    ).toBe(5);
    expect(
      resolveCostQuotesPrefill({
        saved: true,
        quoted,
        planningPrefill: planning,
        workingUnitPrice: 0,
      }).productCost,
    ).toBe(5);
  });
});

describe("save after switch updates Topic A/B cost basis", () => {
  function sku(quoted: SkuCardView["quotedCosts"]): SkuCardView {
    return {
      id: "s1",
      name: "Test",
      founderNotes: "",
      basics: {} as SkuCardView["basics"],
      shipFitness: {} as SkuCardView["shipFitness"],
      storage: {} as SkuCardView["storage"],
      handling: {} as SkuCardView["handling"],
      importBatch: {} as SkuCardView["importBatch"],
      moneySnapshot: {
        sellPrice: 40,
        productCost: 5,
        intlShip: 2,
        clearanceTaxes: 1,
        localCourier: 3,
        landedCost: 8,
        marginBefore: 0.7,
        marginAfter: 0.4,
      },
      quotedCosts: quoted,
      reportedMargin: null,
      marketingHooks: { hooks: [] },
    };
  }

  it("costBasisForSku follows newly saved quoted costs (not historical rewrite)", () => {
    const oldQuoted = buildPersistedQuotedCosts(
      {
        source: "import",
        productCost: 5,
        intlShip: 2,
        clearanceTaxes: 1,
        localCourier: 3,
        sellPrice: 40,
      },
      0,
      "2026-01-01T00:00:00.000Z",
    );
    const newQuoted = buildPersistedQuotedCosts(
      {
        source: "import",
        productCost: 8,
        intlShip: 2,
        clearanceTaxes: 1,
        localCourier: 3,
        sellPrice: 40,
      },
      0,
      "2026-02-01T00:00:00.000Z",
    );

    expect(costBasisForSku(sku(oldQuoted)).importCogsPerUnit).toBe(8);
    expect(costBasisForSku(sku(newQuoted)).importCogsPerUnit).toBe(11);
    expect(costBasisForSku(sku(newQuoted)).usesQuotes).toBe(true);
  });
});
