import { afterEach, describe, expect, it } from "vitest";
import { CATALOG } from "@/lib/discovery/catalog";
import {
  poolRowToCatalogProduct,
  resolveDiscoveryCatalogSource,
  loadPoolProductsByCatalogKeys,
} from "@/lib/discovery/pool";
import type { PoolProductRow } from "@/lib/discovery/pool";

afterEach(() => {
  delete process.env.DISCOVERY_POOL_V2;
});

describe("poolRowToCatalogProduct", () => {
  it("maps pool row fields onto CatalogProduct shape", () => {
    const sample = CATALOG[0];
    const row = {
      id: "p1",
      catalogKey: sample.key,
      nameEn: sample.en.name,
      nameAr: sample.ar.name,
      category: sample.category,
      summaryEn: sample.en.summary,
      summaryAr: sample.ar.summary,
      differentiationEn: sample.en.differentiation,
      differentiationAr: sample.ar.differentiation,
      sellPrice: sample.sellPrice,
      productCost: sample.productCost,
      intlShip: sample.intlShip,
      clearanceTaxes: sample.clearanceTaxes,
      localCourier: sample.localCourier,
      difficulty: sample.difficulty,
      risk: sample.risk,
      timeNeed: sample.timeNeed,
      workload: sample.workload,
      storageFootprint: sample.storageFootprint,
      oversized: sample.oversized,
      tier1Marketplaces: JSON.stringify(sample.tier1Marketplaces),
      sourceUrl: null,
      moqHint: null,
      sampleCostHint: null,
      source: "catalog_seed",
      active: true,
      createdAt: "t",
      updatedAt: "t",
    } satisfies PoolProductRow;

    const mapped = poolRowToCatalogProduct(row);
    expect(mapped.key).toBe(sample.key);
    expect(mapped.en.name).toBe(sample.en.name);
    expect(mapped.sellPrice).toBe(sample.sellPrice);
    expect(mapped.tier1Marketplaces).toEqual(sample.tier1Marketplaces);
  });
});

describe("loadPoolProductsByCatalogKeys", () => {
  it("returns empty map without querying when no keys (view O(visible))", async () => {
    const map = await loadPoolProductsByCatalogKeys([]);
    expect(map.size).toBe(0);
    const deduped = await loadPoolProductsByCatalogKeys(["", ""]);
    expect(deduped.size).toBe(0);
  });
});

describe("resolveDiscoveryCatalogSource", () => {
  it("returns in-memory CATALOG when pool v2 flag is off", async () => {
    delete process.env.DISCOVERY_POOL_V2;
    const source = await resolveDiscoveryCatalogSource();
    expect(source).toBe(CATALOG);
  });
});
