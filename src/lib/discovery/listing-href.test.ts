/**
 * WAVE-2 §14.13 — View listing is a stored http(s) href only.
 */

import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { CATALOG } from "@/lib/discovery/catalog";
import { listingHrefFromStoredSourceUrl } from "@/lib/discovery/listing-href";
import { poolRowToCatalogProduct } from "@/lib/discovery/pool";
import type { PoolProductRow } from "@/lib/discovery/pool";

const root = path.join(process.cwd(), "src");

function read(rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

function messages(locale: "en" | "ar"): Record<string, string> {
  return JSON.parse(
    readFileSync(path.join(process.cwd(), `messages/${locale}.json`), "utf8"),
  ).Discovery as Record<string, string>;
}

function samplePoolRow(
  overrides: Partial<PoolProductRow> = {},
): PoolProductRow {
  const sample = CATALOG[0]!;
  return {
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
    imageUrl: null,
    ...overrides,
  };
}

describe("listingHrefFromStoredSourceUrl", () => {
  it("keeps a Path 1 http(s) listing URL", () => {
    expect(
      listingHrefFromStoredSourceUrl(
        "https://www.amazon.com/dp/B0EXAMPLE",
      ),
    ).toBe("https://www.amazon.com/dp/B0EXAMPLE");
    expect(
      listingHrefFromStoredSourceUrl("http://shop.example/p/1"),
    ).toBe("http://shop.example/p/1");
  });

  it("hides catalog null / missing / non-http", () => {
    expect(listingHrefFromStoredSourceUrl(null)).toBeNull();
    expect(listingHrefFromStoredSourceUrl(undefined)).toBeNull();
    expect(listingHrefFromStoredSourceUrl("")).toBeNull();
    expect(listingHrefFromStoredSourceUrl("javascript:alert(1)")).toBeNull();
    expect(listingHrefFromStoredSourceUrl("data:text/html,hi")).toBeNull();
    expect(listingHrefFromStoredSourceUrl("vbscript:msgbox(1)")).toBeNull();
    expect(listingHrefFromStoredSourceUrl("/relative/listing")).toBeNull();
    expect(listingHrefFromStoredSourceUrl("ftp://files.example/p")).toBeNull();
  });

  it("never invents a Google search for the product name", () => {
    const src = read("lib/discovery/listing-href.ts");
    expect(src).not.toContain("google.com/search");
    expect(src).not.toContain("q=");
    expect(listingHrefFromStoredSourceUrl("LED Facial Wand")).toBeNull();
  });
});

describe("poolRowToCatalogProduct sourceUrl", () => {
  it("plumbs a Path 1 stored URL and hides catalog / javascript", () => {
    expect(
      poolRowToCatalogProduct(
        samplePoolRow({
          source: "path1_search",
          sourceUrl: "https://www.amazon.com/dp/B0EXAMPLE",
        }),
      ).sourceUrl,
    ).toBe("https://www.amazon.com/dp/B0EXAMPLE");

    expect(
      poolRowToCatalogProduct(samplePoolRow({ sourceUrl: null })).sourceUrl,
    ).toBeNull();

    expect(
      poolRowToCatalogProduct(
        samplePoolRow({ sourceUrl: "javascript:alert(1)" }),
      ).sourceUrl,
    ).toBeNull();
  });

  it("catalog.ts seed never invents a listing URL", () => {
    expect(CATALOG.every((p) => !p.sourceUrl)).toBe(true);
    const seed = read("lib/discovery/pool.ts");
    const catalogToPool = seed.slice(
      seed.indexOf("function catalogToPoolValues"),
      seed.indexOf("export async function syncCatalogSeedToPool"),
    );
    expect(catalogToPool).toContain("sourceUrl: null");
  });
});

describe("§14.13 view mapper + cards", () => {
  it("getDiscoveryView maps stored sourceUrl and does not call a search provider", () => {
    const service = read("lib/discovery/service.ts");
    const viewFn = service.slice(
      service.indexOf("export async function getDiscoveryView"),
    );
    expect(viewFn).toContain("listingHrefFromStoredSourceUrl");
    expect(viewFn).toContain("sourceUrl: listingHrefFromStoredSourceUrl");
    expect(viewFn).not.toContain("getDiscoverySearchProvider");
    expect(viewFn).not.toContain("createSerpApiProvider");
    expect(viewFn).not.toContain("createSerperSearchProvider");
    expect(viewFn).not.toContain("google.com/search");
    expect(service).not.toContain("runPath1IntakeJob");
  });

  it("AgentProductTile and ProductCard share the stored-href control", () => {
    const board = read("components/discovery/DiscoveryBoard.tsx");
    const helper = board.slice(
      board.indexOf("function ViewListingLink"),
      board.indexOf("const passFeedbackInitial"),
    );
    expect(helper).toContain('target="_blank"');
    expect(helper).toContain('rel="noopener noreferrer"');
    expect(helper).toContain("data-discovery-view-listing");
    expect(helper).toContain('t("viewListing")');
    expect(helper).toContain('t("viewListingPriceNote")');
    expect(helper).toContain("if (!href) return null");
    expect(helper.indexOf("if (!href) return null")).toBeLessThan(
      helper.indexOf('t("viewListingPriceNote")'),
    );
    expect(helper).not.toContain("${sellPrice}");
    expect(helper).not.toContain("${landedCost}");
    expect(helper).not.toContain("acceptProductAction");
    expect(helper).not.toContain("onToggleBasket");
    expect(helper).not.toContain("google.com/search");
    expect(helper).not.toContain("fetch(");

    const tile = board.slice(
      board.indexOf("function AgentProductTile"),
      board.indexOf("function WorthConsideringCompareBox"),
    );
    expect(tile).toContain("<ViewListingLink href={c.sourceUrl} />");

    const card = board.slice(
      board.indexOf("function ProductCard"),
      board.indexOf("function ScoreFreshnessNote"),
    );
    expect(card).toContain("<ViewListingLink href={c.sourceUrl} />");
  });

  it("has EN+AR viewListing copy", () => {
    const en = messages("en");
    const ar = messages("ar");
    expect(en.viewListing).toBe("View listing");
    expect(ar.viewListing.length).toBeGreaterThan(4);
    expect(ar.viewListing).not.toBe(en.viewListing);
    expect(ar.viewListing).toMatch(/[\u0600-\u06FF]/);
  });

  it("has EN+AR viewListingPriceNote templates (no Gemini / prices / سعر المتجر)", () => {
    const en = messages("en");
    const ar = messages("ar");
    expect(en.viewListingPriceNote).toBe(
      "Shop price ≠ your cost. Your unit cost is about the landed cost on this card (estimate).",
    );
    expect(ar.viewListingPriceNote).toBe(
      "السعر في الرابط ليس تكلفتك. تكلفة وحدتك تقريباً تكلفة الوصول هنا (تقدير).",
    );
    expect(ar.viewListingPriceNote).toContain("الرابط");
    expect(ar.viewListingPriceNote).not.toContain("المتجر");
    expect(en.viewListingPriceNote).not.toContain("${sellPrice}");
    expect(en.viewListingPriceNote).not.toContain("${landedCost}");
    expect(ar.viewListingPriceNote).not.toContain("${sellPrice}");
    expect(ar.viewListingPriceNote).not.toContain("${landedCost}");
  });
});
