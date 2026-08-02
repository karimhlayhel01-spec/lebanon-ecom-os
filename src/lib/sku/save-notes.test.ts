import { describe, expect, it } from "vitest";
import {
  evaluateLiveSkuForNotes,
  parseSkuNotesForm,
} from "@/lib/sku/save-notes";

const WS = "ws-a";
const OTHER = "ws-b";

describe("parseSkuNotesForm", () => {
  it("requires skuId — no write without skuId", () => {
    expect(
      parseSkuNotesForm({ skuId: null, founderNotes: "hello" }),
    ).toEqual({ ok: false, error: "missing_sku" });
    expect(
      parseSkuNotesForm({ skuId: "  ", founderNotes: "hello" }),
    ).toEqual({ ok: false, error: "missing_sku" });
    expect(
      parseSkuNotesForm({ skuId: undefined, founderNotes: "" }),
    ).toEqual({ ok: false, error: "missing_sku" });
  });

  it("accepts owned-form shape with skuId + notes", () => {
    expect(
      parseSkuNotesForm({ skuId: "sku-1", founderNotes: "  note  " }),
    ).toEqual({ ok: true, skuId: "sku-1", notes: "  note  " });
  });
});

describe("evaluateLiveSkuForNotes (ownership for notes)", () => {
  it("accepts owned live sku", () => {
    expect(
      evaluateLiveSkuForNotes({
        workspaceId: WS,
        card: { workspaceId: WS, lifecycleStatus: "live" },
        journey: { workspaceId: WS },
      }),
    ).toEqual({ ok: true });
  });

  it("rejects foreign skuId", () => {
    expect(
      evaluateLiveSkuForNotes({
        workspaceId: WS,
        card: { workspaceId: OTHER, lifecycleStatus: "live" },
        journey: { workspaceId: OTHER },
      }),
    ).toEqual({ ok: false, error: "foreign" });
  });

  it("rejects archived / wiped (notes are live-only)", () => {
    expect(
      evaluateLiveSkuForNotes({
        workspaceId: WS,
        card: { workspaceId: WS, lifecycleStatus: "archived" },
        journey: { workspaceId: WS },
      }),
    ).toEqual({ ok: false, error: "not_live" });
    expect(
      evaluateLiveSkuForNotes({
        workspaceId: WS,
        card: { workspaceId: WS, lifecycleStatus: "wiped" },
        journey: { workspaceId: WS },
      }),
    ).toEqual({ ok: false, error: "wiped" });
  });
});
