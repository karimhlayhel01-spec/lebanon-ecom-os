import { describe, expect, it } from "vitest";
import { computeMargin } from "@/lib/skills/margin";
import {
  batchFreightLegs,
  buildPersistedQuotedCosts,
  toMarginInput,
  unitCogsExcludingCourier,
} from "@/lib/supplier/quotes";
import {
  canShowSupplierShortlist,
  filterGroupsByTab,
  groupSuppliersBySourceAndRank,
  isSourceTabFrozen,
  supplierGenerationPlan,
} from "@/lib/supplier/source";
import { parseQuotedCosts } from "@/lib/sku/service";
import { costBasisForSku, type CostBasis } from "@/lib/finance/service";
import type { SkuCardView } from "@/lib/sku/service";
import { computeSourceCostHint, localPlanningLegs } from "@/lib/discovery/local-hint";
import { CATALOG } from "@/lib/discovery/catalog";
import { batchCostBasis } from "@/lib/supplier/service";

describe("local → margin skill mapping", () => {
  it("maps supplierDelivery→intlShip and packaging→clearanceTaxes", () => {
    const mapped = toMarginInput(
      {
        source: "local",
        productCost: 10,
        supplierDelivery: 2.5,
        packaging: 0.5,
        localCourier: 3,
        sellPrice: 40,
      },
      300,
    );
    expect(mapped.intlShip).toBe(2.5);
    expect(mapped.clearanceTaxes).toBe(0.5);
    expect(mapped.localCourier).toBe(3);

    const viaMap = computeMargin(mapped);
    const direct = computeMargin({
      sellPrice: 40,
      productCost: 10,
      intlShip: 2.5,
      clearanceTaxes: 0.5,
      localCourier: 3,
      monthlyFollowOnBudget: 300,
    });
    expect(viaMap.landedCost).toBe(direct.landedCost);
    expect(viaMap.marginBefore).toBe(direct.marginBefore);
  });

  it("persists local quotes with mapped slots + explicit local fields", () => {
    const persisted = buildPersistedQuotedCosts(
      {
        source: "local",
        productCost: 8,
        supplierDelivery: 1.2,
        packaging: 0,
        localCourier: 2,
        sellPrice: 30,
      },
      0,
      "2026-01-01T00:00:00.000Z",
    );
    expect(persisted.source).toBe("local");
    expect(persisted.intlShip).toBe(1.2);
    expect(persisted.clearanceTaxes).toBe(0);
    expect(persisted.supplierDelivery).toBe(1.2);
    expect(persisted.packaging).toBe(0);
    expect(persisted.localCourier).toBe(2);
  });
});

describe("batch cash / COGS exclude last-mile", () => {
  it("import batch freight excludes localCourier", () => {
    const input = {
      source: "import" as const,
      productCost: 5,
      intlShip: 3,
      clearanceTaxes: 1,
      localCourier: 99,
      sellPrice: 40,
    };
    expect(batchFreightLegs(input)).toEqual({
      freightOrDelivery: 3,
      clearanceOrPackaging: 1,
    });
    expect(unitCogsExcludingCourier(input)).toBe(9);
  });

  it("local batch cash = unit + delivery + packaging (never courier)", () => {
    const input = {
      source: "local" as const,
      productCost: 5,
      supplierDelivery: 2,
      packaging: 1,
      localCourier: 99,
      sellPrice: 40,
    };
    expect(unitCogsExcludingCourier(input)).toBe(8);
  });
});

describe("batchCostBasis Local pre-quote planning", () => {
  const money = {
    sellPrice: 40,
    landedCost: 12,
    marginBefore: 0.7,
    marginAfter: 0.4,
    productCost: 5,
    intlShip: 4,
    clearanceTaxes: 2,
    localCourier: 3,
  };

  it("Local + no quotes → localPlanningLegs, not import moneySnapshot freight", () => {
    const legs = localPlanningLegs(money);
    const basis = batchCostBasis(money, null, "local");
    expect(basis.usesQuotes).toBe(false);
    expect(basis.intlShip).toBe(legs.supplierDelivery);
    expect(basis.clearanceTaxes).toBe(legs.packaging);
    expect(basis.intlShip).not.toBe(money.intlShip);
    expect(basis.clearanceTaxes).not.toBe(money.clearanceTaxes);
    // last-mile never in batch freight slots
    expect(basis.intlShip + basis.clearanceTaxes).not.toBe(
      money.intlShip + money.clearanceTaxes + money.localCourier,
    );
    expect(money.localCourier).toBe(3);
  });

  it("Import + no quotes → unchanged Discovery moneySnapshot freight", () => {
    const basis = batchCostBasis(money, null, "import");
    expect(basis.usesQuotes).toBe(false);
    expect(basis.intlShip).toBe(money.intlShip);
    expect(basis.clearanceTaxes).toBe(money.clearanceTaxes);
  });

  it("quotes win over Local planning legs", () => {
    const basis = batchCostBasis(
      money,
      {
        productCost: 5,
        intlShip: 1.1,
        clearanceTaxes: 0.2,
        localCourier: 3,
        sellPrice: 40,
        landedCost: 9.3,
        expectedMarginBefore: 0.77,
        savedAt: "t",
        source: "local",
        supplierDelivery: 1.1,
        packaging: 0.2,
      },
      "local",
    );
    expect(basis.usesQuotes).toBe(true);
    expect(basis.intlShip).toBe(1.1);
    expect(basis.clearanceTaxes).toBe(0.2);
  });
});

describe("finance costBasisForSku local vs import", () => {
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
        landedCost: 12,
        marginBefore: 0.7,
        marginAfter: 0.4,
        productCost: 5,
        intlShip: 3,
        clearanceTaxes: 1,
        localCourier: 2,
      },
      quotedCosts: quoted,
      reportedMargin: null,
      marketingHooks: { hooks: [] },
    };
  }

  it("import quoted COGS excludes courier (regression)", () => {
    const basis = costBasisForSku(
      sku({
        productCost: 5,
        intlShip: 3,
        clearanceTaxes: 1,
        localCourier: 2,
        sellPrice: 40,
        landedCost: 11,
        expectedMarginBefore: 0.725,
        savedAt: "t",
        source: "import",
      }),
    );
    expect(basis.importCogsPerUnit).toBe(9);
    expect(basis.usesQuotes).toBe(true);
  });

  it("local quoted COGS uses delivery+packaging, never courier", () => {
    const basis = costBasisForSku(
      sku({
        productCost: 6,
        intlShip: 1.5,
        clearanceTaxes: 0.5,
        localCourier: 4,
        sellPrice: 40,
        landedCost: 12,
        expectedMarginBefore: 0.7,
        savedAt: "t",
        source: "local",
        supplierDelivery: 1.5,
        packaging: 0.5,
      }),
    );
    expect(basis.importCogsPerUnit).toBe(8);
  });

  it("planning fallback also excludes courier", () => {
    const basis: CostBasis = costBasisForSku(sku(null));
    expect(basis.importCogsPerUnit).toBe(9); // 5+3+1
    expect(basis.usesQuotes).toBe(false);
  });
});

describe("parseQuotedCosts legacy import", () => {
  it("reads quotes without source field", () => {
    const parsed = parseQuotedCosts(
      JSON.stringify({
        productCost: 5,
        intlShip: 2,
        clearanceTaxes: 1,
        localCourier: 2,
        sellPrice: 40,
        landedCost: 10,
        expectedMarginBefore: 0.75,
        savedAt: "2026-01-01",
      }),
    );
    expect(parsed).not.toBeNull();
    expect(parsed!.source).toBeUndefined();
    expect(parsed!.productCost).toBe(5);
    expect(parsed!.intlShip).toBe(2);
  });

  it("reads local quotes with source + explicit legs", () => {
    const parsed = parseQuotedCosts(
      JSON.stringify({
        productCost: 5,
        intlShip: 1,
        clearanceTaxes: 0,
        localCourier: 2,
        sellPrice: 40,
        landedCost: 8,
        expectedMarginBefore: 0.8,
        savedAt: "t",
        source: "local",
        supplierDelivery: 1,
        packaging: 0,
      }),
    );
    expect(parsed!.source).toBe("local");
    expect(parsed!.supplierDelivery).toBe(1);
    expect(parsed!.packaging).toBe(0);
  });
});

describe("source tabs + grouping + backfill plan", () => {
  it("freezes tabs when sample is in flight (not merely approved)", () => {
    expect(
      isSourceTabFrozen({
        hasActiveSample: true,
        sampleApproved: false,
        batchOrdered: false,
      }),
    ).toBe(true);
    expect(
      canShowSupplierShortlist({
        hasActiveSample: false,
        sampleApproved: false,
        batchOrdered: false,
      }),
    ).toBe(true);
    expect(
      isSourceTabFrozen({
        hasActiveSample: false,
        sampleApproved: false,
        batchOrdered: false,
      }),
    ).toBe(false);
    // Approved alone still hides interactive first-pick shortlist.
    expect(
      canShowSupplierShortlist({
        hasActiveSample: false,
        sampleApproved: true,
        batchOrdered: false,
      }),
    ).toBe(false);
  });

  it("unlocks after reject/replace (no active sample)", () => {
    expect(
      canShowSupplierShortlist({
        hasActiveSample: false,
        sampleApproved: false,
        batchOrdered: false,
      }),
    ).toBe(true);
  });

  it("groups by source + rank (18-row fix)", () => {
    const views = [0, 1, 2].flatMap((rank) =>
      (["import", "local"] as const).flatMap((source) => [
        {
          source,
          rank,
          role: "primary",
          id: `${source}-${rank}-p`,
        },
        {
          source,
          rank,
          role: "backup",
          id: `${source}-${rank}-b1`,
        },
        {
          source,
          rank,
          role: "backup",
          id: `${source}-${rank}-b2`,
        },
      ]),
    );
    const groups = groupSuppliersBySourceAndRank(views);
    expect(groups).toHaveLength(6);
    expect(groups.filter((g) => g.source === "import")).toHaveLength(3);
    expect(groups.filter((g) => g.source === "local")).toHaveLength(3);
    // Flat rank-only grouping would merge 6 primaries into 3 groups — we don't.
    expect(groups.every((g) => g.primary && g.backups.length === 2)).toBe(true);

    const both = filterGroupsByTab(groups, "both");
    expect(both).toHaveLength(6);
    expect(filterGroupsByTab(groups, "local")).toHaveLength(3);
  });

  it("backfill plan: import-only → add local; empty → both", () => {
    expect(supplierGenerationPlan([])).toEqual({
      generateImport: true,
      generateLocal: true,
    });
    expect(supplierGenerationPlan(["import"])).toEqual({
      generateImport: false,
      generateLocal: true,
    });
    expect(supplierGenerationPlan(["import", "local"])).toEqual({
      generateImport: false,
      generateLocal: false,
    });
  });
});

describe("discovery accept stays import-gated; hint present", () => {
  it("hint compares local vs import without changing import margin gate", () => {
    const p = CATALOG[0];
    const hint = computeSourceCostHint(p, 300);
    expect(hint.importLanded).toBe(
      p.productCost + p.intlShip + p.clearanceTaxes + p.localCourier,
    );
    expect(hint.localLanded).toBeLessThan(hint.importLanded);
    // Import margin used for accept is independent of local hint.
    const importMargin = computeMargin({
      sellPrice: p.sellPrice,
      productCost: p.productCost,
      intlShip: p.intlShip,
      clearanceTaxes: p.clearanceTaxes,
      localCourier: p.localCourier,
      monthlyFollowOnBudget: 300,
    });
    expect(hint.importMarginBefore).toBe(importMargin.marginBefore);
    expect(hint.localMarginBefore).not.toBe(hint.importMarginBefore);
  });
});
