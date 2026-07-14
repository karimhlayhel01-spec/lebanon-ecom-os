import { describe, expect, it } from "vitest";
import {
  FounderEditError,
  checkFounderEditable,
  enforceFounderEdit,
  isFounderEditable,
} from "@/lib/memory/allowed-fields";

describe("allowed-field edit policy", () => {
  it("recognises founder-editable fields per entity", () => {
    expect(isFounderEditable("workspace", "name")).toBe(true);
    expect(isFounderEditable("workspace", "language")).toBe(true);
    expect(isFounderEditable("skuCard", "founderNotes")).toBe(true);
    expect(isFounderEditable("storeReadiness", "courierChoice")).toBe(true);
  });

  it("rejects system-owned fields", () => {
    expect(isFounderEditable("workspace", "activeSkuId")).toBe(false);
    expect(isFounderEditable("workspace", "shopifyStatus")).toBe(false);
    expect(isFounderEditable("skuCard", "moneySnapshot")).toBe(false);
    expect(isFounderEditable("storeReadiness", "storeReadyPercent")).toBe(false);
  });

  it("checkFounderEditable lists disallowed fields", () => {
    expect(
      checkFounderEditable("workspace", { name: "New", activeSkuId: "x" }),
    ).toEqual({ ok: false, disallowed: ["activeSkuId"] });
    expect(checkFounderEditable("workspace", { name: "New" })).toEqual({
      ok: true,
    });
  });

  it("enforceFounderEdit returns only defined, allowed fields", () => {
    const patch = enforceFounderEdit("workspace", {
      name: "Cedar Store",
      language: undefined,
    });
    expect(patch).toEqual({ name: "Cedar Store" });
  });

  it("enforceFounderEdit throws FounderEditError on disallowed field", () => {
    expect(() =>
      enforceFounderEdit("skuCard", { moneySnapshot: "{}" }),
    ).toThrowError(FounderEditError);

    try {
      enforceFounderEdit("skuCard", { founderNotes: "ok", moneySnapshot: "{}" });
    } catch (err) {
      expect(err).toBeInstanceOf(FounderEditError);
      expect((err as FounderEditError).disallowed).toEqual(["moneySnapshot"]);
    }
  });
});
