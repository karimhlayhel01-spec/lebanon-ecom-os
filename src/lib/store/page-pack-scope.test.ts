import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { parseRequiredSkuId } from "@/lib/sku/require-sku-id";
import { STORE_CHECKLIST_KEYS } from "@/lib/constants";
import {
  improveStorePageCopy,
  selectStorePageCopyVersion,
} from "@/lib/store/service";
import {
  legacyMigrateTargetSkuId,
  resolveStorePanelSkuId,
  writePackForSku,
} from "@/lib/store/page-pack-scope";

describe("resolveStorePanelSkuId", () => {
  it("returns null with no live SKUs", () => {
    expect(resolveStorePanelSkuId([], "a")).toBeNull();
  });

  it("honors a live requested sku", () => {
    expect(resolveStorePanelSkuId(["a", "b"], "b")).toBe("b");
  });

  it("missing or invalid sku picks first live — never another product via activeSkuId", () => {
    expect(resolveStorePanelSkuId(["a", "b"], undefined)).toBe("a");
    expect(resolveStorePanelSkuId(["a", "b"], "")).toBe("a");
    expect(resolveStorePanelSkuId(["a", "b"], "missing")).toBe("a");
    // activeSkuId is not an argument — cannot steal pack B when URL is empty.
    expect(resolveStorePanelSkuId(["a", "b"], null)).toBe("a");
  });

  it("1 live SKU always resolves to that product", () => {
    expect(resolveStorePanelSkuId(["only"], "other")).toBe("only");
    expect(resolveStorePanelSkuId(["only"], undefined)).toBe("only");
  });
});

describe("legacyMigrateTargetSkuId", () => {
  it("lands existing copy on exactly one SKU — prefer active if live, else first live", () => {
    expect(legacyMigrateTargetSkuId(["a", "b"], "b")).toBe("b");
    expect(legacyMigrateTargetSkuId(["a", "b"], "archived")).toBe("a");
    expect(legacyMigrateTargetSkuId(["a", "b"], null)).toBe("a");
    expect(legacyMigrateTargetSkuId(["only"], "only")).toBe("only");
    expect(legacyMigrateTargetSkuId([], "a")).toBeNull();
  });
});

describe("Improve / version mutations", () => {
  it("missing skuId fails closed (no activeSkuId fallback)", async () => {
    expect(parseRequiredSkuId(undefined).ok).toBe(false);
    const improve = await improveStorePageCopy("ws", undefined);
    expect(improve.ok).toBe(false);
    if (improve.ok) return;
    expect(improve.error).toBe("not_found");
    const select = await selectStorePageCopyVersion("ws", "", 0);
    expect(select.ok).toBe(false);
    if (select.ok) return;
    expect(select.error).toBe("not_found");
  });

  it("Improve B does not overwrite A", () => {
    let packs = new Map<string, { draft: string }>([
      ["skuA", { draft: "A-original" }],
      ["skuB", { draft: "B-original" }],
    ]);
    const scope = parseRequiredSkuId("skuB");
    expect(scope.ok).toBe(true);
    if (!scope.ok) return;
    packs = writePackForSku(packs, scope.skuId, { draft: "B-improved" });
    expect(packs.get("skuA")?.draft).toBe("A-original");
    expect(packs.get("skuB")?.draft).toBe("B-improved");
  });
});

describe("checklist stays shop-wide", () => {
  it("Shopify checklist keys are workspace-level, not per pack", () => {
    expect(STORE_CHECKLIST_KEYS.length).toBeGreaterThan(0);
    expect(STORE_CHECKLIST_KEYS).toContain("shopifyCreated");
    expect(STORE_CHECKLIST_KEYS).toContain("storePublic");
  });
});

describe("store service pack isolation (source)", () => {
  it("does not use getSkuView / activeSkuId for Improve or pack reads", () => {
    const src = readFileSync(
      path.join(process.cwd(), "src/lib/store/service.ts"),
      "utf8",
    );
    expect(src).not.toMatch(/\bgetSkuView\(/);
    expect(src).not.toMatch(/activeSkuId/);
    expect(src).toMatch(/assertSkuOwned/);
    expect(src).toMatch(/parseRequiredSkuId/);
    expect(src).toMatch(/storePagePacks/);
    expect(src).toMatch(/getSkuViewById/);
  });
});
