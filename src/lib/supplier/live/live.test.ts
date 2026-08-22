import { describe, expect, it } from "vitest";
import { buildGmailComposeUrl, supplierEmailSubject } from "@/lib/supplier/email/gmail-compose";
import {
  isSupplierGmailSendEnabled,
  isSupplierLiveLeadsEnabled,
} from "@/lib/supplier/live-flags";
import { mergeLiveLeadsIntoShortlist } from "@/lib/supplier/live/merge";
import { getSupplierLeadProvider } from "@/lib/supplier/live/provider";
import {
  classifyImportRefreshConflict,
  classifyLocalRefreshConflict,
  classifyLocalRefreshFallback,
  classifyRefreshFallback,
  countVisibleImportLiveSeats,
  importRefreshNeedsConfirm,
  localRefreshNeedsConfirm,
  planImportRefreshDeletes,
  planLocalRefreshDeletes,
  refreshImportToastKey,
} from "@/lib/supplier/live/refresh";
import type { SupplierLead } from "@/lib/supplier/live/types";
import { readFileSync } from "fs";
import path from "path";

describe("supplier live flags", () => {
  it("defaults live leads and gmail send off", () => {
    expect(isSupplierLiveLeadsEnabled({})).toBe(false);
    expect(isSupplierGmailSendEnabled({})).toBe(false);
    expect(isSupplierLiveLeadsEnabled({ SUPPLIER_LIVE_LEADS: "1" })).toBe(true);
  });

  it("returns noop provider when live leads off", () => {
    expect(getSupplierLeadProvider({}).id).toBe("noop");
  });
});

describe("mergeLiveLeadsIntoShortlist", () => {
  const heuristic = [0, 1, 2].flatMap((rank) => [
    {
      name: `H-primary-${rank}`,
      role: "primary" as const,
      rank,
      source: "import" as const,
      years: 5,
      rating: 4.5,
      verified: true,
      moq: 150,
      unitPrice: 10,
      sampleReplies: true,
      negotiationDraft: "draft",
      paymentMapEstimate: "{}",
      redFlags: [] as string[],
      leadSource: "heuristic" as const,
      platform: null,
      sourceUrl: null,
      externalTitle: null,
    },
    {
      name: `H-backup-a-${rank}`,
      role: "backup" as const,
      rank,
      source: "import" as const,
      years: 3,
      rating: 4.0,
      verified: false,
      moq: 50,
      unitPrice: 11,
      sampleReplies: true,
      negotiationDraft: "draft",
      paymentMapEstimate: "{}",
      redFlags: [] as string[],
      leadSource: "heuristic" as const,
      platform: null,
      sourceUrl: null,
      externalTitle: null,
    },
    {
      name: `H-backup-b-${rank}`,
      role: "backup" as const,
      rank,
      source: "import" as const,
      years: 4,
      rating: 4.1,
      verified: false,
      moq: 200,
      unitPrice: 9,
      sampleReplies: true,
      negotiationDraft: "draft",
      paymentMapEstimate: "{}",
      redFlags: [] as string[],
      leadSource: "heuristic" as const,
      platform: null,
      sourceUrl: null,
      externalTitle: null,
    },
  ]);

  it("overlays live leads onto import seats and pads the rest", () => {
    const liveLeads: SupplierLead[] = [
      {
        name: "Shenzhen Live Co",
        platform: "alibaba",
        sourceUrl: "https://www.alibaba.com/product-detail/x.html",
        externalTitle: "Shenzhen Live Co — Widget",
        unitPriceHint: null,
        leadSource: "live_search",
      },
      {
        name: "AE Seller",
        platform: "aliexpress",
        sourceUrl: "https://www.aliexpress.com/item/100500.html",
        externalTitle: "AE Seller item",
        unitPriceHint: 8,
        leadSource: "live_search",
      },
    ];
    const merged = mergeLiveLeadsIntoShortlist({
      source: "import",
      liveLeads,
      heuristic,
      padHeuristic: true,
    });
    expect(merged).toHaveLength(9);
    expect(merged[0]?.leadSource).toBe("live_search");
    expect(merged[0]?.name).toBe("AE Seller");
    expect(merged[0]?.sourceUrl).toContain("aliexpress.com");
    expect(merged[0]?.unitPrice).toBe(8);
    expect(
      merged.some(
        (m) =>
          m.sourceUrl?.includes("alibaba.com") && m.unitPrice === 10,
      ),
    ).toBe(false);
    expect(merged.slice(2).every((m) => m.leadSource === "heuristic")).toBe(
      true,
    );
  });

  it("Import refresh confirm when chosen or sample-tied", () => {
    expect(
      importRefreshNeedsConfirm({
        importSuppliers: [{ id: "a", status: "available" }],
        sampleSupplierIds: [],
      }),
    ).toBe(false);
    expect(
      importRefreshNeedsConfirm({
        importSuppliers: [{ id: "a", status: "chosen" }],
        sampleSupplierIds: [],
      }),
    ).toBe(true);
    expect(
      importRefreshNeedsConfirm({
        importSuppliers: [{ id: "a", status: "available" }],
        sampleSupplierIds: ["a"],
      }),
    ).toBe(true);
  });

  it("blocks Refresh while Import sample in flight; confirms on approved warm", () => {
    expect(
      classifyImportRefreshConflict({
        importSuppliers: [{ id: "a", status: "available" }],
        samples: [{ supplierId: "a", status: "requested" }],
      }),
    ).toEqual({ kind: "sample_in_flight" });
    expect(
      classifyImportRefreshConflict({
        importSuppliers: [{ id: "a", status: "available" }],
        samples: [{ supplierId: "a", status: "approved" }],
      }),
    ).toEqual({ kind: "needs_confirm" });
    expect(
      classifyImportRefreshConflict({
        importSuppliers: [{ id: "a", status: "available" }],
        samples: [{ supplierId: "b", status: "requested" }],
      }),
    ).toEqual({ kind: "ok" });
    expect(
      classifyLocalRefreshConflict({
        localSuppliers: [{ id: "l1", status: "available" }],
        samples: [{ supplierId: "l1", status: "received" }],
      }),
    ).toEqual({ kind: "sample_in_flight" });
  });

  it("Import live merge with padHeuristic false leaves empty on zero leads", () => {
    const one = [
      {
        name: "Invent",
        role: "primary" as const,
        rank: 0,
        source: "import" as const,
        years: 5,
        rating: 4.5,
        verified: true,
        moq: 150,
        unitPrice: 10,
        sampleReplies: true,
        negotiationDraft: "draft",
        paymentMapEstimate: "{}",
        redFlags: [] as string[],
        leadSource: "heuristic" as const,
        platform: null,
        sourceUrl: null,
        externalTitle: null,
      },
    ];
    expect(
      mergeLiveLeadsIntoShortlist({
        source: "import",
        liveLeads: [],
        heuristic: one,
        padHeuristic: false,
      }),
    ).toEqual([]);
    expect(classifyRefreshFallback(0, 9)).toBe("empty");
  });

  it("plans Import deletes without touching Local ids", () => {
    const plan = planImportRefreshDeletes({
      suppliers: [
        { id: "i1", source: "import" },
        { id: "l1", source: "local" },
      ],
      samples: [
        { id: "s1", supplierId: "i1" },
        { id: "s2", supplierId: "l1" },
      ],
    });
    expect(plan.importSupplierIds).toEqual(["i1"]);
    expect(plan.localSupplierIds).toEqual(["l1"]);
    expect(plan.sampleIdsToDelete).toEqual(["s1"]);
  });
});

describe("gmail compose", () => {
  it("builds a compose URL with subject and body", () => {
    const url = buildGmailComposeUrl({
      subject: supplierEmailSubject("Widget"),
      body: "Hello",
    });
    expect(url).toContain("mail.google.com");
    expect(url).toContain("view=cm");
    expect(decodeURIComponent(url)).toContain("Widget");
  });
});

describe("local live merge + refresh helpers", () => {
  const localHeuristic = [0, 1].flatMap((rank) => [
    {
      name: `L-primary-${rank}`,
      role: "primary" as const,
      rank,
      source: "local" as const,
      years: 5,
      rating: 4.5,
      verified: true,
      moq: 150,
      unitPrice: 10,
      sampleReplies: true,
      negotiationDraft: "draft",
      paymentMapEstimate: "{}",
      redFlags: [] as string[],
      leadSource: "heuristic" as const,
      platform: null,
      sourceUrl: null,
      externalTitle: null,
    },
    {
      name: `L-backup-${rank}`,
      role: "backup" as const,
      rank,
      source: "local" as const,
      years: 3,
      rating: 4.0,
      verified: false,
      moq: 50,
      unitPrice: 11,
      sampleReplies: true,
      negotiationDraft: "draft",
      paymentMapEstimate: "{}",
      redFlags: [] as string[],
      leadSource: "heuristic" as const,
      platform: null,
      sourceUrl: null,
      externalTitle: null,
    },
  ]);

  it("0 local live + padHeuristic false → no invent rows", () => {
    const merged = mergeLiveLeadsIntoShortlist({
      source: "local",
      liveLeads: [],
      heuristic: localHeuristic,
      padHeuristic: false,
    });
    expect(merged).toEqual([]);
    expect(classifyLocalRefreshFallback(0, localHeuristic.length)).toBe(
      "empty",
    );
  });

  it("N local live → N live_search rows, no invent pad", () => {
    const liveLeads: SupplierLead[] = [
      {
        name: "Beirut Wholesale Co.",
        platform: "local_web",
        sourceUrl: "https://www.beirutgoods.lb/shop",
        externalTitle: "Beirut Wholesale Co. — Widget",
        unitPriceHint: null,
        leadSource: "live_search",
      },
      {
        name: "Local listing · Widget",
        platform: "local_web",
        sourceUrl: "https://maps.google.com/maps/place/Lebanon+Widget",
        externalTitle: "Widget store Lebanon",
        unitPriceHint: null,
        leadSource: "live_search",
      },
    ];
    const merged = mergeLiveLeadsIntoShortlist({
      source: "local",
      liveLeads,
      heuristic: localHeuristic,
      padHeuristic: false,
    });
    expect(merged).toHaveLength(2);
    expect(merged.every((m) => m.leadSource === "live_search")).toBe(true);
    expect(merged.every((m) => m.source === "local")).toBe(true);
    expect(merged.every((m) => m.sourceUrl)).toBeTruthy();
    expect(classifyLocalRefreshFallback(2, localHeuristic.length)).toBe(
      "partial",
    );
  });

  it("Local refresh confirm + deletes never touch Import", () => {
    expect(
      localRefreshNeedsConfirm({
        localSuppliers: [{ id: "l1", status: "available" }],
        sampleSupplierIds: [],
      }),
    ).toBe(false);
    expect(
      localRefreshNeedsConfirm({
        localSuppliers: [{ id: "l1", status: "chosen" }],
        sampleSupplierIds: [],
      }),
    ).toBe(true);
    const plan = planLocalRefreshDeletes({
      suppliers: [
        { id: "i1", source: "import" },
        { id: "l1", source: "local" },
      ],
      samples: [
        { id: "s1", supplierId: "i1" },
        { id: "s2", supplierId: "l1" },
      ],
    });
    expect(plan.localSupplierIds).toEqual(["l1"]);
    expect(plan.importSupplierIds).toEqual(["i1"]);
    expect(plan.sampleIdsToDelete).toEqual(["s2"]);
  });
});

describe("Approach A wiring smoke", () => {
  it("merge persists live_search + url and pads heuristic for Import", () => {
    const heuristic = [
      {
        name: `H-primary-0`,
        role: "primary" as const,
        rank: 0,
        source: "import" as const,
        years: 5,
        rating: 4.5,
        verified: true,
        moq: 150,
        unitPrice: 10,
        sampleReplies: true,
        negotiationDraft: "draft",
        paymentMapEstimate: "{}",
        redFlags: [] as string[],
        leadSource: "heuristic" as const,
        platform: null,
        sourceUrl: null,
        externalTitle: null,
      },
      {
        name: `H-backup-a-0`,
        role: "backup" as const,
        rank: 0,
        source: "import" as const,
        years: 3,
        rating: 4.0,
        verified: false,
        moq: 50,
        unitPrice: 11,
        sampleReplies: true,
        negotiationDraft: "draft",
        paymentMapEstimate: "{}",
        redFlags: [] as string[],
        leadSource: "heuristic" as const,
        platform: null,
        sourceUrl: null,
        externalTitle: null,
      },
      {
        name: `H-backup-b-0`,
        role: "backup" as const,
        rank: 0,
        source: "import" as const,
        years: 4,
        rating: 4.1,
        verified: false,
        moq: 200,
        unitPrice: 9,
        sampleReplies: true,
        negotiationDraft: "draft",
        paymentMapEstimate: "{}",
        redFlags: [] as string[],
        leadSource: "heuristic" as const,
        platform: null,
        sourceUrl: null,
        externalTitle: null,
      },
    ];
    const liveLeads: SupplierLead[] = [
      {
        name: "Live A",
        platform: "alibaba",
        sourceUrl: "https://www.alibaba.com/product-detail/a.html",
        externalTitle: "A",
        unitPriceHint: 8,
        leadSource: "live_search",
      },
      {
        name: "Live B",
        platform: "aliexpress",
        sourceUrl: "https://www.aliexpress.com/item/1.html",
        externalTitle: "B",
        unitPriceHint: 9,
        leadSource: "live_search",
      },
    ];
    const merged = mergeLiveLeadsIntoShortlist({
      source: "import",
      liveLeads,
      heuristic,
    });
    expect(merged.filter((m) => m.leadSource === "live_search")).toHaveLength(2);
    expect(merged.slice(2).every((m) => m.leadSource === "heuristic")).toBe(
      true,
    );
    expect(classifyRefreshFallback(2, merged.length)).toBe("partial");
  });

  it("zero-live merge keeps heuristic badges", () => {
    const heuristic = [
      {
        name: "Invent Commerce Ltd.",
        role: "primary" as const,
        rank: 0,
        source: "import" as const,
        years: 5,
        rating: 4.5,
        verified: true,
        moq: 150,
        unitPrice: 10,
        sampleReplies: true,
        negotiationDraft: "draft",
        paymentMapEstimate: "{}",
        redFlags: [] as string[],
        leadSource: "heuristic" as const,
        platform: null,
        sourceUrl: null,
        externalTitle: null,
      },
    ];
    const merged = mergeLiveLeadsIntoShortlist({
      source: "import",
      liveLeads: [],
      heuristic,
    });
    expect(merged[0]?.leadSource).toBe("heuristic");
    expect(merged[0]?.sourceUrl).toBeNull();
    expect(classifyRefreshFallback(0, merged.length)).toBe("empty");
  });

  it("toast liveCount uses Alibaba-distrust keep, not pre-filter merge length", () => {
    const gate100 = {
      maxLandedCost: 100,
      intlShip: 0,
      clearanceTaxes: 0,
      localCourier: 0,
    };
    const ae = (i: number) => ({
      name: `AE ${i}`,
      source: "import" as const,
      status: "available",
      leadSource: "live_search" as const,
      platform: "aliexpress",
      sourceUrl: `https://www.aliexpress.com/item/${i}.html`,
      externalTitle: `AE ${i}`,
      unitPrice: 8 + i,
    });
    const merged4 = [
      ae(1),
      ae(2),
      ae(3),
      {
        name: "Alibaba listing · RingConn Gen 3",
        source: "import" as const,
        status: "available",
        leadSource: "live_search" as const,
        platform: "alibaba",
        sourceUrl:
          "https://www.alibaba.com/product-detail/RingConn-Gen-3_1.html",
        externalTitle: "RingConn Gen 3",
        unitPrice: 12,
      },
    ];
    expect(merged4).toHaveLength(4);
    expect(countVisibleImportLiveSeats(merged4, gate100)).toBe(3);
    expect(
      refreshImportToastKey({
        visibleLiveCount: countVisibleImportLiveSeats(merged4, gate100),
        seatCount: 5,
      }),
    ).toBe("refreshImportPartial");

    const emptyAfter = [
      {
        name: "Alibaba listing · RingConn Gen 3",
        source: "import" as const,
        status: "available",
        leadSource: "live_search" as const,
        platform: "alibaba",
        sourceUrl:
          "https://www.alibaba.com/product-detail/RingConn-Gen-3_1.html",
        externalTitle: "RingConn Gen 3",
        unitPrice: 12,
      },
    ];
    expect(countVisibleImportLiveSeats(emptyAfter, gate100)).toBe(0);
    expect(classifyRefreshFallback(0, 5)).toBe("empty");
    expect(
      refreshImportToastKey({ visibleLiveCount: 0, seatCount: 5 }),
    ).toBe("refreshImportEmpty");
  });

  it("wires refresh action + Import-tab and Local-tab controls (Approach A)", () => {
    const service = readFileSync(
      path.join(process.cwd(), "src/lib/supplier/service.ts"),
      "utf8",
    );
    expect(service).toContain("export async function refreshImportLeads");
    expect(service).toContain("export async function refreshLocalLeads");
    expect(service).toContain("confirmResetProgress");
    expect(service).toContain("sample_in_flight");
    expect(service).toContain('emptyReason: liveCount === 0 ? "no_local_leads"');
    expect(service).toContain("padHeuristic: false");
    expect(service).toContain("maxLandedGate");
    expect(service).toContain("loadMaxLandedGateForWorkspace");
    expect(service).toContain("fillImportLiveLeadPrices");
    expect(service).toContain("unionImportRefreshLeads");
    expect(service).toContain("shouldKeepPersistedImportLiveSeat");
    expect(service).toContain("dropPersistedImportLiveThatFailGate");
    expect(service).toContain("distrustPersistedAlibabaUnit");
    expect(service).toContain("combineImportLeadsForPriceFill");
    expect(service).toContain("countVisibleImportLiveSeats");
    expect(service).toContain("visibleImportRefreshSeats");
    const en = JSON.parse(
      readFileSync(path.join(process.cwd(), "messages/en.json"), "utf8"),
    ) as { Supplier: { refreshImportPartial: string } };
    const ar = JSON.parse(
      readFileSync(path.join(process.cwd(), "messages/ar.json"), "utf8"),
    ) as { Supplier: { refreshImportPartial: string } };
    expect(en.Supplier.refreshImportPartial).toContain("{live}");
    expect(en.Supplier.refreshImportPartial).toContain("max landed");
    expect(en.Supplier.refreshImportPartial).not.toContain("no invent fill");
    expect(ar.Supplier.refreshImportPartial).toContain("{live}");
    expect(ar.Supplier.refreshImportPartial).toContain("سقف تكلفة الوصول");
    expect(ar.Supplier.refreshImportPartial).not.toContain("بلا تعبئة مخترعة");
    const discovery = readFileSync(
      path.join(process.cwd(), "src/lib/discovery/service.ts"),
      "utf8",
    );
    expect(discovery).toContain("ensureSuppliers");
    const actions = readFileSync(
      path.join(process.cwd(), "src/actions/supplier.ts"),
      "utf8",
    );
    expect(actions).toContain("refreshImportLeadsAction");
    expect(actions).toContain("refreshLocalLeadsAction");
    expect(actions).toContain("requireOwnedSku");
    const panel = readFileSync(
      path.join(process.cwd(), "src/components/supplier/SupplierPanel.tsx"),
      "utf8",
    );
    expect(panel).toContain("RefreshImportLeadsControl");
    expect(panel).toContain("RefreshLocalLeadsControl");
    expect(panel).toContain("LocalEmptyBanner");
    expect(panel).toContain("ImportEmptyBanner");
    expect(panel).toContain("refreshImportSampleInFlight");
    expect(panel).toContain('effectiveTab === "import"');
    expect(panel).toContain('effectiveTab === "local"');
    expect(panel).toContain("refreshImportLeadsAction");
    expect(panel).toContain("refreshLocalLeadsAction");
    const provider = readFileSync(
      path.join(process.cwd(), "src/lib/supplier/live/provider.ts"),
      "utf8",
    );
    expect(provider).toContain("gatherLocalLeadsWithSerper");
    expect(provider).toContain('input.source === "local"');
  });
});
