import { describe, expect, it } from "vitest";
import {
  buildPath1IntakeQueries,
  catalogKeyFromSourceUrl,
  dedupeNormalizedCandidates,
  extractPriceSeed,
  isBlockedIntakeUrl,
  looksLikeBrandDirectory,
  nextPath1ImageUrl,
  normalizeSearchItemToPoolCandidate,
  sanitizeHttpImageUrl,
} from "@/lib/discovery/normalize";
import { DISCOVERY_INTAKE_QUERIES_PER_RUN_MAX } from "@/lib/constants";

describe("Path 1 normalize mapping", () => {
  it("maps a shopping hit into pool fields with path1_search source", () => {
    const row = normalizeSearchItemToPoolCandidate(
      {
        title: "LED Facial Wand Red Light",
        url: "https://www.amazon.com/dp/B0EXAMPLE",
        snippet: "Rechargeable skincare wand — $29.99",
        price: 29.99,
      },
      "beauty_personal_care",
    );
    expect(row).not.toBeNull();
    expect(row!.source).toBe("path1_search");
    expect(row!.category).toBe("beauty_personal_care");
    expect(row!.nameEn).toContain("LED Facial Wand");
    expect(row!.sellPrice).toBe(29.99);
    expect(row!.productCost).toBeCloseTo(29.99 * 0.25, 2);
    expect(row!.sourceUrl).toContain("amazon.com");
    expect(row!.moqHint).toBeNull();
    expect(row!.catalogKey).toMatch(/^path1_/);
    expect(row!.imageUrl).toBeNull();
  });

  it("keeps https thumbnail URLs and drops non-http", () => {
    expect(
      normalizeSearchItemToPoolCandidate(
        {
          title: "Canvas print",
          url: "https://shop.example/p",
          price: 20,
          imageUrl: "https://cdn.example/t.jpg",
        },
        "home_kitchen",
      )?.imageUrl,
    ).toBe("https://cdn.example/t.jpg");
    expect(
      normalizeSearchItemToPoolCandidate(
        {
          title: "Canvas print",
          url: "https://shop.example/p2",
          imageUrl: "http://cdn.example/t.jpg",
        },
        "home_kitchen",
      )?.imageUrl,
    ).toBe("http://cdn.example/t.jpg");
    expect(
      sanitizeHttpImageUrl("data:image/png;base64,abc"),
    ).toBeNull();
    expect(sanitizeHttpImageUrl("javascript:alert(1)")).toBeNull();
    expect(sanitizeHttpImageUrl("")).toBeNull();
    expect(sanitizeHttpImageUrl("/relative.jpg")).toBeNull();
    expect(nextPath1ImageUrl(null, "https://cdn.example/kept.jpg")).toBe(
      "https://cdn.example/kept.jpg",
    );
    expect(
      nextPath1ImageUrl("https://cdn.example/new.jpg", "https://old.example/x.jpg"),
    ).toBe("https://cdn.example/new.jpg");
  });

  it("rejects Alibaba / Accio URLs and brand-directory titles", () => {
    expect(isBlockedIntakeUrl("https://www.alibaba.com/product/x")).toBe(true);
    expect(isBlockedIntakeUrl("https://www.accio.com/brand/foo")).toBe(true);
    expect(isBlockedIntakeUrl("https://shop.example.com/p/1")).toBe(false);
    expect(looksLikeBrandDirectory("Nike Official Store")).toBe(true);
    expect(
      normalizeSearchItemToPoolCandidate(
        {
          title: "Nike Official Store",
          url: "https://www.nike.com/",
        },
        "fashion_accessories",
      ),
    ).toBeNull();
  });

  it("extracts price seeds from structured price or snippet", () => {
    expect(extractPriceSeed({ title: "X", price: 12.5 })).toBe(12.5);
    expect(
      extractPriceSeed({ title: "Widget USD 18.00", snippet: "" }),
    ).toBe(18);
  });

  it("dedupes by catalogKey", () => {
    const a = normalizeSearchItemToPoolCandidate(
      { title: "A", url: "https://example.com/a", price: 10 },
      "home_kitchen",
    )!;
    const b = normalizeSearchItemToPoolCandidate(
      { title: "A again", url: "https://example.com/a", price: 11 },
      "home_kitchen",
    )!;
    expect(a.catalogKey).toBe(b.catalogKey);
    expect(catalogKeyFromSourceUrl("https://example.com/a")).toBe(a.catalogKey);
    expect(dedupeNormalizedCandidates([a, b])).toHaveLength(1);
  });
});

describe("Path 1 intake query caps", () => {
  it("buildPath1IntakeQueries respects maxQueries", () => {
    expect(buildPath1IntakeQueries(0)).toEqual([]);
    expect(buildPath1IntakeQueries(3)).toHaveLength(3);
    expect(buildPath1IntakeQueries(100).length).toBeLessThanOrEqual(
      DISCOVERY_INTAKE_QUERIES_PER_RUN_MAX,
    );
    const q = buildPath1IntakeQueries(4);
    expect(q[0].query).toMatch(/United States/);
    expect(q[1].query).toMatch(/Europe/);
  });
});
