import { describe, expect, it } from "vitest";
import { isLocalHitRelevantToProduct } from "@/lib/supplier/live/local-relevance";

describe("isLocalHitRelevantToProduct", () => {
  const sku = "Collapsible Food Containers";

  it("rejects broad food-container category hits missing collapsible", () => {
    expect(
      isLocalHitRelevantToProduct(
        sku,
        "Food Containers Wholesale Beirut",
        "Kitchen storage containers supplier in Lebanon",
      ),
    ).toBe(false);
  });

  it("accepts hits that include collapsible (+ Lebanon context)", () => {
    expect(
      isLocalHitRelevantToProduct(
        sku,
        "Collapsible Food Containers — Beirut Wholesale",
        "Supplier of collapsible lunch containers in Lebanon",
      ),
    ).toBe(true);
    expect(
      isLocalHitRelevantToProduct(
        sku,
        "Collapsible containers wholesale Lebanon",
        "Folding food storage — Beirut",
      ),
    ).toBe(true);
  });

  it("accepts full product phrase even with sparse extra words", () => {
    expect(
      isLocalHitRelevantToProduct(
        sku,
        `Buy ${sku} in Beirut`,
        null,
      ),
    ).toBe(true);
  });

  it("requires modifiers when present on short SKUs", () => {
    expect(
      isLocalHitRelevantToProduct(
        "Silicone Spatula",
        "Kitchen spatulas wholesale Beirut",
        "Lebanon",
      ),
    ).toBe(false);
    expect(
      isLocalHitRelevantToProduct(
        "Silicone Spatula",
        "Silicone spatula supplier Beirut",
        "Lebanon wholesale",
      ),
    ).toBe(true);
  });
});
