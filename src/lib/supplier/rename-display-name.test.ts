import { describe, expect, it } from "vitest";
import {
  clampSupplierDisplayName,
  SUPPLIER_DISPLAY_NAME_MAX,
} from "@/lib/supplier/live/company-name";
import { evaluateRenameSupplierDisplayName } from "@/lib/supplier/rename-display-name";

describe("evaluateRenameSupplierDisplayName", () => {
  it("rejects when supplier is not owned", () => {
    expect(
      evaluateRenameSupplierDisplayName({
        supplierOwned: false,
        hasSampleRecord: true,
        nextNameRaw: "Real Co",
      }),
    ).toEqual({ ok: false, error: "not_found" });
  });

  it("rejects before any sample request (too_early)", () => {
    expect(
      evaluateRenameSupplierDisplayName({
        supplierOwned: true,
        hasSampleRecord: false,
        nextNameRaw: "Real Co",
      }),
    ).toEqual({ ok: false, error: "too_early" });
  });

  it("allows rename after sample request", () => {
    expect(
      evaluateRenameSupplierDisplayName({
        supplierOwned: true,
        hasSampleRecord: true,
        nextNameRaw: "  Shenzhen Foo Co., Ltd.  ",
      }),
    ).toEqual({ ok: true, name: "Shenzhen Foo Co., Ltd." });
  });

  it("rejects empty / too-short names", () => {
    expect(
      evaluateRenameSupplierDisplayName({
        supplierOwned: true,
        hasSampleRecord: true,
        nextNameRaw: " ",
      }),
    ).toEqual({ ok: false, error: "empty" });
    expect(
      evaluateRenameSupplierDisplayName({
        supplierOwned: true,
        hasSampleRecord: true,
        nextNameRaw: "A",
      }),
    ).toEqual({ ok: false, error: "empty" });
  });

  it("clamps long names to SUPPLIER_DISPLAY_NAME_MAX", () => {
    const long = "X".repeat(SUPPLIER_DISPLAY_NAME_MAX + 40);
    const res = evaluateRenameSupplierDisplayName({
      supplierOwned: true,
      hasSampleRecord: true,
      nextNameRaw: long,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.name.length).toBeLessThanOrEqual(SUPPLIER_DISPLAY_NAME_MAX);
      expect(res.name).toBe(clampSupplierDisplayName(long));
    }
  });
});
