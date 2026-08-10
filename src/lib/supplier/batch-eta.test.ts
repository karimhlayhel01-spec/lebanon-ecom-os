import { describe, expect, it } from "vitest";
import {
  DEFAULT_ETA_WEEKS,
  MAX_ETA_WEEKS,
  canEditBatchArrivalEta,
  computeEtaWeeks,
  resolveBatchArrivalEta,
  resolvePanelScopedSkuId,
  toStoredEta,
  weeksUntilDate,
} from "@/lib/supplier/batch-eta";
import { LAUNCH_PLAN_WEEKS } from "@/lib/marketing/creatives";

describe("panel-scoped first-batch skuId (arrived / ETA)", () => {
  it("uses panel skuId even when activeSkuId differs", () => {
    expect(
      resolvePanelScopedSkuId({
        panelSkuId: "panel-sku",
        activeSkuId: "active-sku",
      }),
    ).toBe("panel-sku");
  });

  it("rejects empty panel skuId — no activeSkuId fallback", () => {
    expect(
      resolvePanelScopedSkuId({
        panelSkuId: "",
        activeSkuId: "active-sku",
      }),
    ).toBeNull();
    expect(
      resolvePanelScopedSkuId({
        panelSkuId: null,
        activeSkuId: "active-sku",
      }),
    ).toBeNull();
    expect(resolvePanelScopedSkuId({ panelSkuId: "   " })).toBeNull();
  });
});

describe("batch arrival ETA", () => {
  it("ETA editable once sample approved (or batch ordered) until arrived", () => {
    expect(
      canEditBatchArrivalEta({
        sampleApproved: false,
        batchOrdered: false,
        batchArrivedReady: false,
      }),
    ).toBe(false);
    expect(
      canEditBatchArrivalEta({
        sampleApproved: true,
        batchOrdered: false,
        batchArrivedReady: false,
      }),
    ).toBe(true);
    expect(
      canEditBatchArrivalEta({
        sampleApproved: true,
        batchOrdered: true,
        batchArrivedReady: false,
      }),
    ).toBe(true);
    expect(
      canEditBatchArrivalEta({
        sampleApproved: true,
        batchOrdered: true,
        batchArrivedReady: true,
      }),
    ).toBe(false);
  });

  it("Launch plan weeks stay fixed (independent of ETA)", () => {
    expect(LAUNCH_PLAN_WEEKS).toBe(2);
    expect(computeEtaWeeks({ preset: "2m" })).toBe(8);
  });

  it("maps presets to week counts (2w / 1m / 2m)", () => {
    expect(computeEtaWeeks({ preset: "2w" })).toBe(2);
    expect(computeEtaWeeks({ preset: "1m" })).toBe(4);
    expect(computeEtaWeeks({ preset: "2m" })).toBe(8);
  });

  it("resolves null storage to default 1 month, founderSet false", () => {
    const eta = resolveBatchArrivalEta(null);
    expect(eta.founderSet).toBe(false);
    expect(eta.preset).toBe("default");
    expect(eta.weekCount).toBe(DEFAULT_ETA_WEEKS);
    expect(eta.summaryEn).toMatch(/1 month/i);
  });

  it("resolves founder-stored ETA as founderSet", () => {
    const stored = toStoredEta({ preset: "2w" });
    const eta = resolveBatchArrivalEta(JSON.stringify(stored));
    expect(eta.founderSet).toBe(true);
    expect(eta.weekCount).toBe(2);
    expect(eta.preset).toBe("2w");
  });

  it("computes custom date weeks and caps at max", () => {
    const now = new Date(2026, 6, 22); // Jul 22 2026
    expect(weeksUntilDate("2026-08-05", now)).toBe(2);
    expect(weeksUntilDate("2026-12-01", now)).toBe(MAX_ETA_WEEKS);
    expect(computeEtaWeeks({ preset: "custom", date: "2026-08-05" })).toBeGreaterThanOrEqual(1);
  });
});
