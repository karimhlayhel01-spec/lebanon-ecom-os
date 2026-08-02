import { describe, expect, it } from "vitest";
import {
  evaluateSkuOwnership,
  resolveApprovalSkuId,
} from "@/lib/sku/ownership";

const WS = "ws-a";
const OTHER = "ws-b";

describe("evaluateSkuOwnership", () => {
  it("accepts owned live card + journey", () => {
    expect(
      evaluateSkuOwnership({
        workspaceId: WS,
        card: { workspaceId: WS, lifecycleStatus: "live" },
        journey: { workspaceId: WS },
      }),
    ).toEqual({ ok: true });
  });

  it("accepts owned archived card", () => {
    expect(
      evaluateSkuOwnership({
        workspaceId: WS,
        card: { workspaceId: WS, lifecycleStatus: "archived" },
        journey: { workspaceId: WS },
      }),
    ).toEqual({ ok: true });
  });

  it("rejects foreign skuId (card or journey workspace mismatch)", () => {
    expect(
      evaluateSkuOwnership({
        workspaceId: WS,
        card: { workspaceId: OTHER, lifecycleStatus: "live" },
        journey: { workspaceId: OTHER },
      }),
    ).toEqual({ ok: false, error: "foreign" });

    expect(
      evaluateSkuOwnership({
        workspaceId: WS,
        card: { workspaceId: WS, lifecycleStatus: "live" },
        journey: { workspaceId: OTHER },
      }),
    ).toEqual({ ok: false, error: "foreign" });

    expect(
      evaluateSkuOwnership({
        workspaceId: WS,
        card: { workspaceId: OTHER, lifecycleStatus: "live" },
        journey: { workspaceId: WS },
      }),
    ).toEqual({ ok: false, error: "foreign" });
  });

  it("rejects wiped cards", () => {
    expect(
      evaluateSkuOwnership({
        workspaceId: WS,
        card: { workspaceId: WS, lifecycleStatus: "wiped" },
        journey: { workspaceId: WS },
      }),
    ).toEqual({ ok: false, error: "wiped" });
  });

  it("rejects missing card or journey", () => {
    expect(
      evaluateSkuOwnership({
        workspaceId: WS,
        card: null,
        journey: { workspaceId: WS },
      }),
    ).toEqual({ ok: false, error: "not_found" });
    expect(
      evaluateSkuOwnership({
        workspaceId: WS,
        card: { workspaceId: WS, lifecycleStatus: "live" },
        journey: null,
      }),
    ).toEqual({ ok: false, error: "not_found" });
  });
});

describe("resolveApprovalSkuId", () => {
  it("uses row.skuId and ignores mismatched payload", () => {
    expect(
      resolveApprovalSkuId({
        rowSkuId: "sku-owned",
        payloadSkuId: "sku-foreign",
      }),
    ).toBe("sku-owned");
  });

  it("does not trust payload alone when row.skuId is null", () => {
    expect(
      resolveApprovalSkuId({
        rowSkuId: null,
        payloadSkuId: "sku-injected",
      }),
    ).toBeNull();
  });

  it("returns null when both absent", () => {
    expect(
      resolveApprovalSkuId({ rowSkuId: null, payloadSkuId: null }),
    ).toBeNull();
  });
});
