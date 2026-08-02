import { describe, expect, it } from "vitest";
import { resolveHubSupplierStatusFactsFromRows } from "@/lib/dashboard/hub-status-facts";
import { mapSkuJourneysBySkuId, type SkuJourneyRow } from "@/lib/sku/journey";
import { toStoredEta } from "@/lib/supplier/batch-eta";

describe("mapSkuJourneysBySkuId", () => {
  it("indexes by skuId", () => {
    const rows = [
      { skuId: "a", id: "1" },
      { skuId: "b", id: "2" },
    ] as SkuJourneyRow[];
    const map = mapSkuJourneysBySkuId(rows);
    expect(map.get("a")?.id).toBe("1");
    expect(map.get("b")?.id).toBe("2");
    expect(map.size).toBe(2);
  });
});

describe("resolveHubSupplierStatusFactsFromRows", () => {
  const suppliers = [
    { id: "s1", name: "Shenzhen Co" },
    { id: "s2", name: "Local Bridge" },
  ];

  it("names in-flight sample supplier and status", () => {
    const facts = resolveHubSupplierStatusFactsFromRows({
      sampleRows: [
        { supplierId: "s1", status: "requested" },
        { supplierId: "s2", status: "approved" },
      ],
      supplierRows: suppliers,
      batchArrivalEtaJson: null,
      reorderPathSupplierId: null,
      reorderSupplierId: null,
    });
    expect(facts.activeSampleStatus).toBe("requested");
    expect(facts.supplierName).toBe("Shenzhen Co");
    expect(facts.etaFounderSet).toBe(false);
  });

  it("falls back to working-path name when no in-flight sample", () => {
    const facts = resolveHubSupplierStatusFactsFromRows({
      sampleRows: [{ supplierId: "s2", status: "approved" }],
      supplierRows: suppliers,
      batchArrivalEtaJson: null,
      reorderPathSupplierId: null,
      reorderSupplierId: null,
    });
    expect(facts.activeSampleStatus).toBeNull();
    expect(facts.supplierName).toBe("Local Bridge");
  });

  it("surfaces founder-set batch ETA summaries", () => {
    const stored = toStoredEta({
      preset: "1m",
      weeks: 4,
      date: null,
      label: null,
    });
    const facts = resolveHubSupplierStatusFactsFromRows({
      sampleRows: [],
      supplierRows: suppliers,
      batchArrivalEtaJson: JSON.stringify(stored),
      reorderPathSupplierId: null,
      reorderSupplierId: null,
    });
    expect(facts.etaFounderSet).toBe(true);
    expect(facts.etaSummaryEn.length).toBeGreaterThan(0);
    expect(facts.etaSummaryAr.length).toBeGreaterThan(0);
  });
});
