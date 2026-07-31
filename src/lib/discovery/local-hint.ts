import { computeMargin } from "@/lib/skills/margin";
import type { CatalogProduct } from "@/lib/discovery/catalog";

/**
 * Discovery H1 — local vs import cost hint only.
 * Accept / Strong / Okay / Topic B stay on import planning costs.
 */

export type LocalPlanningLegs = {
  /** Delivery/pickup to founder (maps to intlShip for margin skill). */
  supplierDelivery: number;
  /** Prep packaging (maps to clearanceTaxes); may be 0. */
  packaging: number;
};

/** Deterministic local planning legs derived from catalog import legs. */
export function localPlanningLegs(
  p: Pick<CatalogProduct, "intlShip" | "clearanceTaxes">,
): LocalPlanningLegs {
  // Local inbound is cheaper than China freight; packaging is light prep.
  const supplierDelivery =
    Math.round(Math.max(0.5, p.intlShip * 0.45) * 100) / 100;
  const packaging =
    Math.round(Math.max(0, p.clearanceTaxes * 0.35) * 100) / 100;
  return { supplierDelivery, packaging };
}

export type SourceCostHint = {
  importLanded: number;
  localLanded: number;
  importMarginBefore: number;
  localMarginBefore: number;
  /** Positive = local cheaper landed; negative = import cheaper. */
  landedDelta: number;
};

export function computeSourceCostHint(
  p: Pick<
    CatalogProduct,
    | "sellPrice"
    | "productCost"
    | "intlShip"
    | "clearanceTaxes"
    | "localCourier"
  >,
  monthlyFollowOnBudget: number,
): SourceCostHint {
  const local = localPlanningLegs(p);

  const importMargin = computeMargin({
    sellPrice: p.sellPrice,
    productCost: p.productCost,
    intlShip: p.intlShip,
    clearanceTaxes: p.clearanceTaxes,
    localCourier: p.localCourier,
    monthlyFollowOnBudget,
  });

  const localMargin = computeMargin({
    sellPrice: p.sellPrice,
    productCost: p.productCost,
    intlShip: local.supplierDelivery,
    clearanceTaxes: local.packaging,
    localCourier: p.localCourier,
    monthlyFollowOnBudget,
  });

  return {
    importLanded: importMargin.landedCost,
    localLanded: localMargin.landedCost,
    importMarginBefore: importMargin.marginBefore,
    localMarginBefore: localMargin.marginBefore,
    landedDelta: importMargin.landedCost - localMargin.landedCost,
  };
}
