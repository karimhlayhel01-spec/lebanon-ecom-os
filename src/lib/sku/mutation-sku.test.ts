import { describe, expect, it } from "vitest";
import {
  resolveAdvanceJourneySkuTarget,
  resolveBlockUnblockSkuTarget,
} from "@/lib/sku/mutation-sku";

describe("resolveAdvanceJourneySkuTarget", () => {
  it("requires explicit skuId when live SKUs exist (no active soft fallback)", () => {
    expect(
      resolveAdvanceJourneySkuTarget({ skuId: undefined, liveCount: 1 }),
    ).toEqual({ ok: false, error: "invalid_transition" });
    expect(
      resolveAdvanceJourneySkuTarget({ skuId: "", liveCount: 2 }),
    ).toEqual({ ok: false, error: "invalid_transition" });
    expect(
      resolveAdvanceJourneySkuTarget({ skuId: "   ", liveCount: 1 }),
    ).toEqual({ ok: false, error: "invalid_transition" });
    expect(
      resolveAdvanceJourneySkuTarget({ skuId: null, liveCount: 3 }),
    ).toEqual({ ok: false, error: "invalid_transition" });
  });

  it("accepts a non-empty trimmed skuId regardless of live count", () => {
    expect(
      resolveAdvanceJourneySkuTarget({ skuId: "sku-a", liveCount: 2 }),
    ).toEqual({ ok: true, kind: "sku", skuId: "sku-a" });
    expect(
      resolveAdvanceJourneySkuTarget({ skuId: "  sku-a  ", liveCount: 0 }),
    ).toEqual({ ok: true, kind: "sku", skuId: "sku-a" });
  });

  it("allows legacy workspace advance only when zero live SKUs", () => {
    expect(
      resolveAdvanceJourneySkuTarget({ skuId: undefined, liveCount: 0 }),
    ).toEqual({ ok: true, kind: "legacy" });
    expect(
      resolveAdvanceJourneySkuTarget({ skuId: "", liveCount: 0 }),
    ).toEqual({ ok: true, kind: "legacy" });
  });
});

describe("resolveBlockUnblockSkuTarget", () => {
  it("uses explicit skuId when provided", () => {
    expect(
      resolveBlockUnblockSkuTarget({
        skuId: "sku-b",
        liveSkuIds: ["sku-a", "sku-b"],
      }),
    ).toEqual({ ok: true, kind: "sku", skuId: "sku-b" });
  });

  it("allows legacy when the shop is empty", () => {
    expect(
      resolveBlockUnblockSkuTarget({ skuId: undefined, liveSkuIds: [] }),
    ).toEqual({ ok: true, kind: "legacy" });
  });

  it("uses the sole live SKU when skuId omitted (not active preference)", () => {
    expect(
      resolveBlockUnblockSkuTarget({
        skuId: undefined,
        liveSkuIds: ["only"],
      }),
    ).toEqual({ ok: true, kind: "sku", skuId: "only" });
  });

  it("fails closed when multiple live SKUs and no explicit skuId", () => {
    expect(
      resolveBlockUnblockSkuTarget({
        skuId: undefined,
        liveSkuIds: ["a", "b"],
      }),
    ).toEqual({ ok: false, error: "invalid_transition" });
    expect(
      resolveBlockUnblockSkuTarget({
        skuId: "  ",
        liveSkuIds: ["a", "b"],
      }),
    ).toEqual({ ok: false, error: "invalid_transition" });
  });
});
