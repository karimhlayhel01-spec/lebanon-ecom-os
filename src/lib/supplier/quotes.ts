import { computeMargin, type MarginInput } from "@/lib/skills/margin";
import type { SupplierSource } from "@/lib/supplier/source";

/**
 * Cost quote shapes.
 *
 * Persistence always stores the shared Margin skill shape (intlShip /
 * clearanceTaxes slots) so Finance + batch cash keep working. For Local,
 * those slots are mapped from supplierDelivery / packaging — never last-mile.
 *
 * `localCourier` is ALWAYS customer last-mile COD (margin gates only; never
 * batch cash / Finance COGS).
 */

export type ImportCostQuoteInput = {
  source: "import";
  productCost: number;
  intlShip: number;
  clearanceTaxes: number;
  localCourier: number;
  sellPrice: number;
};

export type LocalCostQuoteInput = {
  source: "local";
  productCost: number;
  /** Delivery/pickup to founder — maps to intlShip slot. */
  supplierDelivery: number;
  /** Prep packaging — maps to clearanceTaxes slot; may be 0. */
  packaging: number;
  localCourier: number;
  sellPrice: number;
};

export type CostQuoteInput = ImportCostQuoteInput | LocalCostQuoteInput;

/** Mapped Margin skill input (shared module — one math path). */
export function toMarginInput(
  input: CostQuoteInput,
  monthlyFollowOnBudget: number,
): MarginInput {
  if (input.source === "local") {
    return {
      sellPrice: input.sellPrice,
      productCost: input.productCost,
      intlShip: input.supplierDelivery,
      clearanceTaxes: input.packaging,
      localCourier: input.localCourier,
      monthlyFollowOnBudget,
    };
  }
  return {
    sellPrice: input.sellPrice,
    productCost: input.productCost,
    intlShip: input.intlShip,
    clearanceTaxes: input.clearanceTaxes,
    localCourier: input.localCourier,
    monthlyFollowOnBudget,
  };
}

/**
 * Batch cash / Finance COGS legs (NEVER last-mile courier).
 * Import = unit + intlShip + clearance; Local = unit + delivery + packaging.
 */
export function batchFreightLegs(input: CostQuoteInput): {
  freightOrDelivery: number;
  clearanceOrPackaging: number;
} {
  if (input.source === "local") {
    return {
      freightOrDelivery: input.supplierDelivery,
      clearanceOrPackaging: input.packaging,
    };
  }
  return {
    freightOrDelivery: input.intlShip,
    clearanceOrPackaging: input.clearanceTaxes,
  };
}

export function unitCogsExcludingCourier(input: CostQuoteInput): number {
  const legs = batchFreightLegs(input);
  return input.productCost + legs.freightOrDelivery + legs.clearanceOrPackaging;
}

export type PersistedQuotedCosts = {
  productCost: number;
  intlShip: number;
  clearanceTaxes: number;
  localCourier: number;
  sellPrice: number;
  landedCost: number;
  expectedMarginBefore: number;
  savedAt: string;
  source: SupplierSource;
  /** Explicit local names when source=local (UI + audit). */
  supplierDelivery?: number;
  packaging?: number;
};

export function buildPersistedQuotedCosts(
  input: CostQuoteInput,
  monthlyFollowOnBudget: number,
  savedAt: string,
): PersistedQuotedCosts {
  const marginInput = toMarginInput(input, monthlyFollowOnBudget);
  const margin = computeMargin(marginInput);
  const base: PersistedQuotedCosts = {
    productCost: input.productCost,
    intlShip: marginInput.intlShip,
    clearanceTaxes: marginInput.clearanceTaxes,
    localCourier: input.localCourier,
    sellPrice: input.sellPrice,
    landedCost: margin.landedCost,
    expectedMarginBefore: margin.marginBefore,
    savedAt,
    source: input.source,
  };
  if (input.source === "local") {
    return {
      ...base,
      supplierDelivery: input.supplierDelivery,
      packaging: input.packaging,
    };
  }
  return base;
}

export function validateCostQuoteNumbers(input: CostQuoteInput): boolean {
  const nums =
    input.source === "local"
      ? [
          input.productCost,
          input.supplierDelivery,
          input.packaging,
          input.localCourier,
          input.sellPrice,
        ]
      : [
          input.productCost,
          input.intlShip,
          input.clearanceTaxes,
          input.localCourier,
          input.sellPrice,
        ];
  return nums.every((n) => Number.isFinite(n) && n >= 0);
}

/**
 * UI mode for Real unit costs while browsing Mode B spare cards.
 * Unlock/save rules stay elsewhere — this only collapses the form during browse.
 * Path-switch refresh keeps the form expanded even if browse is open.
 */
export type CostQuotesDisplayMode = "locked" | "collapsed" | "form";

export function resolveCostQuotesDisplayMode(args: {
  unlocked: boolean;
  browseShortlist: boolean;
  /** Cleared costQuotesSaved after path switch — keep form visible. */
  needsRefresh?: boolean;
  /**
   * Stage is not the costs / first-batch job (e.g. in transit or selling).
   * Prefer collapsed; UI may expand to edit. Unlock/save rules unchanged.
   */
  preferCollapsed?: boolean;
}): CostQuotesDisplayMode {
  if (!args.unlocked) return "locked";
  if (args.needsRefresh) return "form";
  if (args.browseShortlist || args.preferCollapsed) return "collapsed";
  return "form";
}

/** Warm / crisis path switch must stale quotes; cold sample start must not. */
export function pathSwitchShouldStaleCostQuotes(
  mode: "warm" | "crisis_skip" | "cold_sample",
): boolean {
  return mode === "warm" || mode === "crisis_skip";
}

export type CostQuotesPrefillFields = {
  productCost: number;
  intlShip: number;
  clearanceTaxes: number;
  supplierDelivery: number;
  packaging: number;
  localCourier: number;
  sellPrice: number;
};

type QuotedPrefillSource = {
  productCost: number;
  intlShip: number;
  clearanceTaxes: number;
  localCourier: number;
  sellPrice: number;
  supplierDelivery?: number;
  packaging?: number;
};

function prefillFromQuoted(quoted: QuotedPrefillSource): CostQuotesPrefillFields {
  return {
    productCost: quoted.productCost,
    intlShip: quoted.intlShip,
    clearanceTaxes: quoted.clearanceTaxes,
    supplierDelivery:
      typeof quoted.supplierDelivery === "number"
        ? quoted.supplierDelivery
        : quoted.intlShip,
    packaging:
      typeof quoted.packaging === "number"
        ? quoted.packaging
        : quoted.clearanceTaxes,
    localCourier: quoted.localCourier,
    sellPrice: quoted.sellPrice,
  };
}

/**
 * When quotes are saved, show saved numbers.
 * When unsaved (first path or after path switch), prefer the working supplier’s
 * unit price for productCost; keep other legs from prior quotes if present.
 * unitPrice <= 0 is unknown (agent directory seats) — do not let `??` keep $0.
 */
export function knownWorkingUnitPrice(
  unitPrice: number | null | undefined,
): number | null {
  if (unitPrice == null || unitPrice <= 0) return null;
  return unitPrice;
}

export function resolveCostQuotesPrefill(args: {
  saved: boolean;
  quoted: QuotedPrefillSource | null;
  planningPrefill: CostQuotesPrefillFields;
  workingUnitPrice: number | null;
}): CostQuotesPrefillFields {
  if (args.saved && args.quoted) {
    return prefillFromQuoted(args.quoted);
  }
  const base = args.quoted
    ? prefillFromQuoted(args.quoted)
    : args.planningPrefill;
  return {
    ...base,
    productCost:
      knownWorkingUnitPrice(args.workingUnitPrice) ?? base.productCost,
  };
}

/** Prior quotes exist but saved flag cleared → prompt refresh after path switch. */
export function costQuotesNeedRefresh(args: {
  unlocked: boolean;
  saved: boolean;
  hasQuoted: boolean;
}): boolean {
  return args.unlocked && !args.saved && args.hasQuoted;
}
