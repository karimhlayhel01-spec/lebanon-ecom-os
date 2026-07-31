import { eq } from "drizzle-orm";
import { db, ensureMigrated, schema } from "@/db";
import { getCatalogProduct, type CatalogProduct } from "@/lib/discovery/catalog";
import type { StorageFootprint } from "@/lib/skills/fit";

/**
 * Topic B — SKU card service.
 *
 * The SKU card is the founder-facing "product sheet" built from the accepted
 * candidate. All structured sections are system-written and stored as JSON on
 * `sku_cards`; the only founder-editable field is free-text `founderNotes`
 * (enforced by the allowed-field policy). This module owns the deterministic
 * section builder used at accept time and the typed read model for the UI.
 */

export type SkuBasics = {
  name: string;
  category: string;
  sellPrice: number;
  landedCost: number;
  differentiation: string;
};

export type ShipFitness = {
  footprint: StorageFootprint;
  oversized: boolean;
  parcelType: "standard-parcel" | "oversized-freight";
  notes: string[];
};

export type StorageSection = {
  ambiance: "ambient" | "cool_dry" | "climate_controlled";
  footprint: StorageFootprint;
  notes: string[];
};

export type HandlingSection = {
  fragile: boolean;
  battery: boolean;
  notes: string[];
};

export type ImportBatchSection = {
  moq: number | null;
  status: string;
  suggestedFirstBatch: number | null;
  /**
   * Units on hand after batch arrive (ordered qty). Hub/runway bootstrap when
   * Topic A has no left for this SKU yet. Topic A log-week left wins once set.
   */
  unitsLeft: number | null;
  notes: string[];
};

export type MoneySnapshotSection = {
  sellPrice: number;
  landedCost: number;
  marginBefore: number;
  marginAfter: number;
  productCost: number;
  intlShip: number;
  clearanceTaxes: number;
  localCourier: number;
};

/** Founder-quoted unit costs after sample approval — separate from Discovery planning. */
export type QuotedCostsSection = {
  productCost: number;
  /** Import freight OR mapped local supplierDelivery (Margin skill slot). */
  intlShip: number;
  /** Import clearance OR mapped local packaging (Margin skill slot). */
  clearanceTaxes: number;
  /** Customer last-mile COD — NEVER batch cash / Finance COGS. */
  localCourier: number;
  sellPrice: number;
  landedCost: number;
  expectedMarginBefore: number;
  savedAt: string;
  /** Wave 2. Legacy quotes without source parse as import. */
  source?: "import" | "local";
  /** Explicit local legs when source=local (UI); mirrored into intlShip/clearanceTaxes. */
  supplierDelivery?: number;
  packaging?: number;
};

/**
 * @deprecated Old manual "reported margin after ads". After-ads margins are now
 * computed automatically from Topic A weekly inputs (see finance service). This
 * type/field is no longer surfaced in product UI; kept only for a clean later
 * cleanup of the unused `reported_margin` column.
 */
export type ReportedMarginSection = {
  marginAfter: number; // fraction 0–1, consistent with moneySnapshot margin fields
  sellPrice: number; // effective sell price captured at report time (provenance)
  landed: number; // effective landed cost captured at report time (provenance)
  adPerUnit: number; // ad cost/unit used for the suggestion, if any
  reportedAt: string;
};

export type MarketingHooksSection = {
  hooks: string[];
};

export type SkuCardView = {
  id: string;
  name: string;
  founderNotes: string;
  basics: SkuBasics;
  shipFitness: ShipFitness;
  storage: StorageSection;
  handling: HandlingSection;
  importBatch: ImportBatchSection;
  moneySnapshot: MoneySnapshotSection;
  quotedCosts: QuotedCostsSection | null;
  /** @deprecated Superseded by automatic actual margins from Topic A. Not shown in UI. */
  reportedMargin: ReportedMarginSection | null;
  marketingHooks: MarketingHooksSection;
};

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed as T;
    return fallback;
  } catch {
    return fallback;
  }
}

const BATTERY_HINTS = [
  "charger",
  "light",
  "wand",
  "warmer",
  "vacuum",
  "massage",
  "blender",
  "scale",
  "fountain",
  "keypad",
  "treadmill",
];
const FRAGILE_HINTS = ["mirror", "glass", "blender", "sunglasses", "scale"];
const COOL_DRY_HINTS = ["skincare", "beauty", "oil", "wand", "gua"];

function includesAny(haystack: string, needles: string[]): boolean {
  const lower = haystack.toLowerCase();
  return needles.some((n) => lower.includes(n));
}

export type SkuSectionInput = {
  name: string;
  category: string;
  sellPrice: number;
  landedCost: number;
  marginBefore: number;
  marginAfter: number;
  differentiation: string;
  oversized: boolean;
  footprint: StorageFootprint;
  productCost: number;
  intlShip: number;
  clearanceTaxes: number;
  localCourier: number;
};

/** Deterministically build every structured SKU section from an accepted product. */
export function buildSkuSections(input: SkuSectionInput) {
  const nameKey = `${input.name} ${input.category}`;
  const battery = includesAny(nameKey, BATTERY_HINTS);
  const fragile = includesAny(nameKey, FRAGILE_HINTS);
  const coolDry = includesAny(nameKey, COOL_DRY_HINTS);

  const basics: SkuBasics = {
    name: input.name,
    category: input.category,
    sellPrice: input.sellPrice,
    landedCost: input.landedCost,
    differentiation: input.differentiation,
  };

  const shipFitness: ShipFitness = {
    footprint: input.footprint,
    oversized: input.oversized,
    parcelType: input.oversized ? "oversized-freight" : "standard-parcel",
    notes: input.oversized
      ? ["@ship.oversizedRisk", "@ship.freightQuote"]
      : ["@ship.smallParcel", "@ship.consolidate"],
  };

  const storage: StorageSection = {
    ambiance: coolDry ? "cool_dry" : "ambient",
    footprint: input.footprint,
    notes:
      input.footprint === "large"
        ? ["@storage.bulky", "@storage.turnover"]
        : ["@storage.compact", "@storage.stackable"],
  };

  const handling: HandlingSection = {
    fragile,
    battery,
    notes: [
      ...(battery ? ["@handling.battery"] : []),
      ...(fragile ? ["@handling.fragile"] : []),
      "@handling.qcOnArrival",
      // COD is ops (buyer pays the delivery person) — not a marketing hook.
      "@handling.codOps",
    ],
  };

  const importBatch: ImportBatchSection = {
    moq: null,
    status: "not_ordered",
    suggestedFirstBatch: null,
    unitsLeft: null,
    notes: ["@import.sampleFirst", "@import.startSmall"],
  };

  const moneySnapshot: MoneySnapshotSection = {
    sellPrice: input.sellPrice,
    landedCost: input.landedCost,
    marginBefore: input.marginBefore,
    marginAfter: input.marginAfter,
    productCost: input.productCost,
    intlShip: input.intlShip,
    clearanceTaxes: input.clearanceTaxes,
    localCourier: input.localCourier,
  };

  const marketingHooks: MarketingHooksSection = {
    // COD trust is ops/handling — never list under marketing hooks.
    hooks: [input.differentiation, "@hooks.localAngle"],
  };

  return {
    basics: JSON.stringify(basics),
    shipFitness: JSON.stringify(shipFitness),
    storageAmbiance: JSON.stringify(storage),
    handling: JSON.stringify(handling),
    importBatch: JSON.stringify(importBatch),
    moneySnapshot: JSON.stringify(moneySnapshot),
    marketingHooks: JSON.stringify(marketingHooks),
  };
}

/** Footprint for a candidate, resolved from the catalog when available. */
export function footprintForCatalogKey(key: string): StorageFootprint {
  const product: CatalogProduct | undefined = getCatalogProduct(key);
  return product?.storageFootprint ?? "small";
}

export async function getActiveSku(workspaceId: string) {
  await ensureMigrated();
  const workspace = await db
    .select({ activeSkuId: schema.workspaces.activeSkuId })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId))
    .then((rows) => rows[0]);
  if (!workspace?.activeSkuId) return undefined;
  return db
    .select()
    .from(schema.skuCards)
    .where(eq(schema.skuCards.id, workspace.activeSkuId))
    .then((rows) => rows[0]);
}

function rowToSkuView(
  row: typeof schema.skuCards.$inferSelect,
): SkuCardView {
  const basics = parseJson<SkuBasics>(row.basics, {
    name: row.name,
    category: "",
    sellPrice: 0,
    landedCost: 0,
    differentiation: "",
  });

  // Tolerant of the earlier plain-string section shape.
  const shipFitness = parseJson<ShipFitness>(row.shipFitness, {
    footprint: "small",
    oversized: false,
    parcelType: "standard-parcel",
    notes: ["ship.smallParcel"],
  });
  const storage = parseJson<StorageSection>(row.storageAmbiance, {
    ambiance: "ambient",
    footprint: "small",
    notes: ["storage.compact"],
  });
  const handling = parseJson<HandlingSection>(row.handling, {
    fragile: false,
    battery: false,
    notes: ["handling.qcOnArrival"],
  });
  const importBatchRaw = parseJson<ImportBatchSection>(row.importBatch, {
    moq: null,
    status: "not_ordered",
    suggestedFirstBatch: null,
    unitsLeft: null,
    notes: ["import.sampleFirst"],
  });
  const importBatch: ImportBatchSection = {
    ...importBatchRaw,
    unitsLeft:
      importBatchRaw.unitsLeft != null && Number.isFinite(importBatchRaw.unitsLeft)
        ? Math.max(0, Math.floor(importBatchRaw.unitsLeft))
        : null,
  };
  const moneySnapshot = parseJson<MoneySnapshotSection>(row.moneySnapshot, {
    sellPrice: basics.sellPrice,
    landedCost: basics.landedCost,
    marginBefore: 0,
    marginAfter: 0,
    productCost: 0,
    intlShip: 0,
    clearanceTaxes: 0,
    localCourier: 0,
  });
  const marketingHooksRaw = parseJson<MarketingHooksSection>(row.marketingHooks, {
    hooks: [row.marketingHooks].filter(Boolean),
  });
  // COD is ops-only — strip legacy @hooks.codTrust from marketing hooks on read.
  const marketingHooks: MarketingHooksSection = {
    hooks: marketingHooksRaw.hooks.filter((h) => h !== "@hooks.codTrust"),
  };
  const quotedCosts = parseQuotedCosts(row.quotedCosts);
  const reportedMargin = parseReportedMargin(row.reportedMargin);

  return {
    id: row.id,
    name: row.name,
    founderNotes: row.founderNotes,
    basics,
    shipFitness,
    storage,
    handling,
    importBatch,
    moneySnapshot,
    quotedCosts,
    reportedMargin,
    marketingHooks,
  };
}

export async function getSkuView(
  workspaceId: string,
): Promise<SkuCardView | null> {
  const row = await getActiveSku(workspaceId);
  if (!row) return null;
  return rowToSkuView(row);
}

/** Load a SKU card by id (live or archived — wiped names are still readable). */
export async function getSkuViewById(
  workspaceId: string,
  skuId: string,
): Promise<SkuCardView | null> {
  await ensureMigrated();
  const row = await db
    .select()
    .from(schema.skuCards)
    .where(eq(schema.skuCards.id, skuId))
    .then((rows) => rows[0]);
  if (!row || row.workspaceId !== workspaceId) return null;
  if (row.lifecycleStatus === "wiped") return null;
  return rowToSkuView(row);
}

/** @deprecated Kept only to read the legacy `reported_margin` column; not used by UI. */
export function parseReportedMargin(
  raw: string | null | undefined,
): ReportedMarginSection | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ReportedMarginSection>;
    if (typeof parsed.marginAfter !== "number") return null;
    return {
      marginAfter: parsed.marginAfter,
      sellPrice: typeof parsed.sellPrice === "number" ? parsed.sellPrice : 0,
      landed: typeof parsed.landed === "number" ? parsed.landed : 0,
      adPerUnit: typeof parsed.adPerUnit === "number" ? parsed.adPerUnit : 0,
      reportedAt: typeof parsed.reportedAt === "string" ? parsed.reportedAt : "",
    };
  } catch {
    return null;
  }
}

/**
 * Effective money source shared by every "after ads" / coaching surface so the
 * Finance panel and SKU sheets cannot drift: founder-quoted values win when the
 * post-sample cost quotes are saved; otherwise Discovery planning is used.
 */
export function getEffectiveSellPrice(sku: SkuCardView): number {
  return sku.quotedCosts?.sellPrice ?? sku.moneySnapshot.sellPrice;
}

export function getEffectiveLanded(sku: SkuCardView): number {
  return sku.quotedCosts?.landedCost ?? sku.moneySnapshot.landedCost;
}

export function parseQuotedCosts(
  raw: string | null | undefined,
): QuotedCostsSection | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<QuotedCostsSection>;
    if (
      typeof parsed.productCost !== "number" ||
      typeof parsed.intlShip !== "number" ||
      typeof parsed.clearanceTaxes !== "number" ||
      typeof parsed.localCourier !== "number" ||
      typeof parsed.sellPrice !== "number" ||
      typeof parsed.expectedMarginBefore !== "number"
    ) {
      return null;
    }
    const source =
      parsed.source === "local"
        ? ("local" as const)
        : parsed.source === "import"
          ? ("import" as const)
          : undefined;
    const out: QuotedCostsSection = {
      productCost: parsed.productCost,
      intlShip: parsed.intlShip,
      clearanceTaxes: parsed.clearanceTaxes,
      localCourier: parsed.localCourier,
      sellPrice: parsed.sellPrice,
      landedCost:
        typeof parsed.landedCost === "number"
          ? parsed.landedCost
          : parsed.productCost +
            parsed.intlShip +
            parsed.clearanceTaxes +
            parsed.localCourier,
      expectedMarginBefore: parsed.expectedMarginBefore,
      savedAt: typeof parsed.savedAt === "string" ? parsed.savedAt : "",
    };
    if (source) out.source = source;
    if (typeof parsed.supplierDelivery === "number") {
      out.supplierDelivery = parsed.supplierDelivery;
    }
    if (typeof parsed.packaging === "number") {
      out.packaging = parsed.packaging;
    }
    return out;
  } catch {
    return null;
  }
}
