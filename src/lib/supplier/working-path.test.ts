import { describe, expect, it } from "vitest";
import { resolveHubWarmedSpares } from "@/lib/supplier/working-path";

function supplier(
  id: string,
  name: string,
  opts: { source?: "import" | "local"; role?: string } = {},
) {
  return {
    id,
    name,
    role: opts.role ?? "backup",
    source: opts.source ?? ("import" as const),
    moq: 50,
    unitPrice: 8,
  };
}

describe("resolveHubWarmedSpares", () => {
  it("omits line when insurance not available (no approved sample)", () => {
    const res = resolveHubWarmedSpares({
      sampleApproved: false,
      primaryState: "supplier_sample",
      pathSupplierId: null,
      pathSource: "import",
      suppliers: [supplier("p1", "Path Co", { role: "primary" })],
      approvedSampleSupplierIds: new Set(),
      unavailable: {},
    });
    expect(res.insuranceAvailable).toBe(false);
    expect(res.warmedSpareNames).toEqual([]);
  });

  it("lists warmed same-source non-path names only", () => {
    const res = resolveHubWarmedSpares({
      sampleApproved: true,
      primaryState: "selling",
      pathSupplierId: "path",
      pathSource: "import",
      suppliers: [
        supplier("path", "Path Co", { role: "primary" }),
        supplier("w1", "Warm One"),
        supplier("w2", "Warm Two"),
        supplier("cold", "Cold One"),
        supplier("local-warm", "Local Warm", { source: "local" }),
      ],
      approvedSampleSupplierIds: new Set(["path", "w1", "w2", "local-warm"]),
      unavailable: {},
    });
    expect(res.insuranceAvailable).toBe(true);
    expect(res.warmedSpareNames).toEqual(["Warm One", "Warm Two"]);
    expect(res.warmedSpareNames).not.toContain("Path Co");
    expect(res.warmedSpareNames).not.toContain("Cold One");
    expect(res.warmedSpareNames).not.toContain("Local Warm");
  });

  it("excludes unavailable warmed spares", () => {
    const res = resolveHubWarmedSpares({
      sampleApproved: true,
      primaryState: "sample_approved",
      pathSupplierId: "path",
      pathSource: "import",
      suppliers: [
        supplier("path", "Path Co", { role: "primary" }),
        supplier("w1", "Warm One"),
        supplier("gone", "Gone Warm"),
      ],
      approvedSampleSupplierIds: new Set(["path", "w1", "gone"]),
      unavailable: {
        gone: { reason: "no_stock", at: "2026-01-01" },
      },
    });
    expect(res.warmedSpareNames).toEqual(["Warm One"]);
  });

  it("insurance available with zero warmed names (none yet)", () => {
    const res = resolveHubWarmedSpares({
      sampleApproved: true,
      primaryState: "batch_ordered",
      pathSupplierId: "path",
      pathSource: "import",
      suppliers: [
        supplier("path", "Path Co", { role: "primary" }),
        supplier("cold", "Cold One"),
      ],
      approvedSampleSupplierIds: new Set(["path"]),
      unavailable: {},
    });
    expect(res.insuranceAvailable).toBe(true);
    expect(res.warmedSpareNames).toEqual([]);
  });

  it("isolates by inputs — SKU B data does not appear in SKU A call", () => {
    const skuA = resolveHubWarmedSpares({
      sampleApproved: true,
      primaryState: "selling",
      pathSupplierId: "a-path",
      pathSource: "import",
      suppliers: [
        supplier("a-path", "A Path"),
        supplier("a-warm", "A Warm"),
      ],
      approvedSampleSupplierIds: new Set(["a-path", "a-warm"]),
      unavailable: {},
    });
    const skuB = resolveHubWarmedSpares({
      sampleApproved: true,
      primaryState: "selling",
      pathSupplierId: "b-path",
      pathSource: "import",
      suppliers: [
        supplier("b-path", "B Path"),
        supplier("b-warm", "B Warm"),
      ],
      approvedSampleSupplierIds: new Set(["b-path", "b-warm"]),
      unavailable: {},
    });
    expect(skuA.warmedSpareNames).toEqual(["A Warm"]);
    expect(skuB.warmedSpareNames).toEqual(["B Warm"]);
  });
});
