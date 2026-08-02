import { describe, expect, it } from "vitest";
import {
  parseGenerateKitSkuScope,
  parseRequiredSkuId,
} from "@/lib/sku/require-sku-id";

describe("parseRequiredSkuId", () => {
  it("accepts a non-empty trimmed id", () => {
    expect(parseRequiredSkuId("sku-1")).toEqual({ ok: true, skuId: "sku-1" });
    expect(parseRequiredSkuId("  sku-1  ")).toEqual({
      ok: true,
      skuId: "sku-1",
    });
  });

  it("rejects missing / blank skuId (no activeSkuId soft fallback)", () => {
    expect(parseRequiredSkuId(undefined)).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(parseRequiredSkuId(null)).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(parseRequiredSkuId("")).toEqual({ ok: false, error: "not_found" });
    expect(parseRequiredSkuId("   ")).toEqual({
      ok: false,
      error: "not_found",
    });
  });
});

describe("parseGenerateKitSkuScope", () => {
  it("allows null for explicit shop-kit scope", () => {
    expect(parseGenerateKitSkuScope(null)).toEqual({ ok: true, skuId: null });
  });

  it("requires a string skuId for SKU kits", () => {
    expect(parseGenerateKitSkuScope("sku-a")).toEqual({
      ok: true,
      skuId: "sku-a",
    });
    expect(parseGenerateKitSkuScope(undefined)).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(parseGenerateKitSkuScope("")).toEqual({
      ok: false,
      error: "not_found",
    });
  });
});
