import { describe, expect, it } from "vitest";
import {
  mapMarketingStatusRow,
  mapSupplierStatusRow,
} from "@/lib/dashboard/status";

describe("mapSupplierStatusRow", () => {
  const base = {
    productAccepted: true,
    sampleStatus: "none",
    activeSampleStatus: null as string | null,
    supplierName: null as string | null,
    batchOrdered: false,
    batchArrivedReady: false,
    etaFounderSet: false,
    etaSummaryEn: "About 4 weeks",
    etaSummaryAr: "حوالي ٤ أسابيع",
    locale: "en" as const,
  };

  it("discovery / no product", () => {
    expect(
      mapSupplierStatusRow({ ...base, productAccepted: false }),
    ).toMatchObject({
      kind: "no_product",
      supplierName: null,
      etaSummary: null,
    });
  });

  it("product accepted, no sample", () => {
    expect(mapSupplierStatusRow(base)).toMatchObject({
      kind: "no_sample",
      supplierName: null,
    });
  });

  it("sample in flight names the supplier", () => {
    expect(
      mapSupplierStatusRow({
        ...base,
        sampleStatus: "in_flight",
        activeSampleStatus: "requested",
        supplierName: "Shenzhen Co",
        supplierId: "sup-1",
        contactEmail: "sales@sz.com",
        contactWhatsapp: "+86138",
      }),
    ).toMatchObject({
      kind: "sample_in_flight",
      supplierName: "Shenzhen Co",
      supplierId: "sup-1",
      contactEmail: "sales@sz.com",
      contactWhatsapp: "+86138",
      etaSummary: null,
    });
  });

  it("sample received", () => {
    expect(
      mapSupplierStatusRow({
        ...base,
        sampleStatus: "in_flight",
        activeSampleStatus: "received",
        supplierName: "Shenzhen Co",
      }),
    ).toMatchObject({ kind: "sample_received", supplierName: "Shenzhen Co" });
  });

  it("sample rejected — no approved naming", () => {
    expect(
      mapSupplierStatusRow({
        ...base,
        sampleStatus: "rejected",
        supplierName: "Old Co",
      }),
    ).toMatchObject({
      kind: "sample_rejected",
      supplierName: null,
    });
  });

  it("sample approved, batch not ordered", () => {
    expect(
      mapSupplierStatusRow({
        ...base,
        sampleStatus: "approved",
        activeSampleStatus: "approved",
        supplierName: "Shenzhen Co",
      }),
    ).toMatchObject({
      kind: "sample_approved",
      supplierName: "Shenzhen Co",
      etaSummary: null,
    });
  });

  it("batch ordered shows founder-set ETA only", () => {
    expect(
      mapSupplierStatusRow({
        ...base,
        sampleStatus: "approved",
        supplierName: "Shenzhen Co",
        batchOrdered: true,
        etaFounderSet: true,
        etaSummaryEn: "About 2 weeks",
      }),
    ).toMatchObject({
      kind: "batch_ordered",
      supplierName: "Shenzhen Co",
      etaSummary: "About 2 weeks",
    });

    expect(
      mapSupplierStatusRow({
        ...base,
        sampleStatus: "approved",
        supplierName: "Shenzhen Co",
        batchOrdered: true,
        etaFounderSet: false,
        etaSummaryEn: "About 4 weeks",
      }),
    ).toMatchObject({
      kind: "batch_ordered",
      etaSummary: null,
    });
  });

  it("batch arrived omits ETA", () => {
    expect(
      mapSupplierStatusRow({
        ...base,
        sampleStatus: "approved",
        supplierName: "Shenzhen Co",
        batchOrdered: true,
        batchArrivedReady: true,
        etaFounderSet: true,
        etaSummaryEn: "About 2 weeks",
      }),
    ).toMatchObject({
      kind: "batch_arrived",
      supplierName: "Shenzhen Co",
      etaSummary: null,
    });
  });
});

describe("mapMarketingStatusRow", () => {
  it("follows journey focus: sample → intro, ordered → pre-launch, arrived → launch, selling → weekly", () => {
    expect(
      mapMarketingStatusRow({
        primaryState: "sample_approved",
        sampleApproved: true,
        batchOrdered: false,
        batchArrivedReady: false,
        hasLaunchKit: false,
        sideStage: "none",
      }).stage,
    ).toBe("intro_pdf");

    expect(
      mapMarketingStatusRow({
        primaryState: "batch_ordered",
        sampleApproved: true,
        batchOrdered: true,
        batchArrivedReady: false,
        hasLaunchKit: false,
        sideStage: "none",
      }).stage,
    ).toBe("pre_launch");

    expect(
      mapMarketingStatusRow({
        primaryState: "batch_arrived_ready",
        sampleApproved: true,
        batchOrdered: true,
        batchArrivedReady: true,
        hasLaunchKit: true,
        sideStage: "monthly_refresh",
      }).stage,
    ).toBe("launch");

    expect(
      mapMarketingStatusRow({
        primaryState: "selling",
        sampleApproved: true,
        batchOrdered: true,
        batchArrivedReady: true,
        hasLaunchKit: true,
        sideStage: "none",
      }).stage,
    ).toBe("monthly_refresh");
  });

  it("stays none before sample approval", () => {
    expect(
      mapMarketingStatusRow({
        primaryState: "discovery",
        sampleApproved: false,
        batchOrdered: false,
        batchArrivedReady: false,
        hasLaunchKit: false,
        sideStage: "none",
      }),
    ).toMatchObject({ stage: "none", href: "/marketing" });
  });
});
