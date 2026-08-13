import { describe, expect, it } from "vitest";
import {
  buildToolsHrefs,
  resolveHubOrientationSkuId,
  resolveHubToolSkuId,
  skuToolHref,
  storeToolHref,
} from "@/lib/sku/tools";

describe("resolveHubToolSkuId", () => {
  it("returns null when no live SKUs", () => {
    expect(resolveHubToolSkuId([], "a")).toBeNull();
  });

  it("prefers activeSkuId when it is live", () => {
    expect(resolveHubToolSkuId(["a", "b"], "b")).toBe("b");
  });

  it("falls back to first live when active missing or not live", () => {
    expect(resolveHubToolSkuId(["a", "b"], null)).toBe("a");
    expect(resolveHubToolSkuId(["a", "b"], "archived")).toBe("a");
  });
});

describe("resolveHubOrientationSkuId", () => {
  it("prefers active when live", () => {
    expect(
      resolveHubOrientationSkuId(
        [
          { id: "a", attentionCount: 2 },
          { id: "b", attentionCount: 0 },
        ],
        "b",
      ),
    ).toBe("b");
  });

  it("falls back to first with attention, then first live", () => {
    expect(
      resolveHubOrientationSkuId(
        [
          { id: "a", attentionCount: 0 },
          { id: "b", attentionCount: 1 },
        ],
        null,
      ),
    ).toBe("b");
    expect(
      resolveHubOrientationSkuId(
        [
          { id: "a", attentionCount: 0 },
          { id: "b", attentionCount: 0 },
        ],
        null,
      ),
    ).toBe("a");
  });
});

describe("tool hrefs", () => {
  it("points Store at /store?sku= when a SKU is known", () => {
    expect(storeToolHref()).toBe("/store");
    expect(storeToolHref("sku1")).toBe("/store?sku=sku1");
    expect(skuToolHref("sku1", "supplier")).toBe("/sku/sku1#supplier");
    expect(buildToolsHrefs("sku1")).toEqual({
      store: "/store?sku=sku1",
      supplier: "/sku/sku1#supplier",
      marketing: "/sku/sku1#marketing",
      finance: "/sku/sku1#finance",
    });
    expect(buildToolsHrefs(null)).toEqual({
      store: "/store",
      supplier: null,
      marketing: null,
      finance: null,
    });
  });
});
