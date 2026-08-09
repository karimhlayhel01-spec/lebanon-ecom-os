import { describe, expect, it } from "vitest";
import { buildGmailComposeUrl, supplierEmailSubject } from "@/lib/supplier/email/gmail-compose";
import {
  isSupplierGmailSendEnabled,
  isSupplierLiveLeadsEnabled,
} from "@/lib/supplier/live-flags";
import { mergeLiveLeadsIntoShortlist } from "@/lib/supplier/live/merge";
import { getSupplierLeadProvider } from "@/lib/supplier/live/provider";
import {
  classifyRefreshFallback,
  importRefreshNeedsConfirm,
  planImportRefreshDeletes,
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
        sourceUrl: "https://www.aliexpress.com/item/1.html",
        externalTitle: "AE Seller Widget",
        unitPriceHint: 8.5,
        leadSource: "live_search",
      },
    ];
    const merged = mergeLiveLeadsIntoShortlist({
      source: "import",
      liveLeads,
      heuristic,
    });
    expect(merged).toHaveLength(9);
    expect(merged[0]?.leadSource).toBe("live_search");
    expect(merged[0]?.sourceUrl).toContain("alibaba.com");
    expect(merged[0]?.verified).toBe(false);
    expect(merged[1]?.platform).toBe("aliexpress");
    expect(merged[1]?.unitPrice).toBe(8.5);
    expect(merged[2]?.leadSource).toBe("heuristic");
  });

  it("leaves local shortlists heuristic-only", () => {
    const local = heuristic.map((h) => ({ ...h, source: "local" as const }));
    const merged = mergeLiveLeadsIntoShortlist({
      source: "local",
      liveLeads: [
        {
          name: "ShouldIgnore",
          platform: "alibaba",
          sourceUrl: "https://www.alibaba.com/x",
          externalTitle: "x",
          unitPriceHint: null,
          leadSource: "live_search",
        },
      ],
      heuristic: local,
    });
    expect(merged.every((m) => m.leadSource === "heuristic")).toBe(true);
  });
});

describe("gmail compose helpers", () => {
  it("builds a Gmail compose URL with subject and body", () => {
    const url = buildGmailComposeUrl({
      subject: "Sample inquiry — Widget",
      body: "Hello supplier",
    });
    expect(url).toContain("mail.google.com/mail/");
    expect(url).toContain("su=Sample");
    expect(url).toContain("body=Hello");
  });

  it("localizes subject", () => {
    expect(supplierEmailSubject("Widget", "en")).toMatch(/Sample inquiry/);
    expect(supplierEmailSubject("Widget", "ar")).toMatch(/عيّنة/);
  });
});

describe("refresh Import leads planning", () => {
  it("needs confirm when Import is chosen or has samples", () => {
    expect(
      importRefreshNeedsConfirm({
        importSuppliers: [{ id: "i1", status: "available" }],
        sampleSupplierIds: [],
      }),
    ).toBe(false);
    expect(
      importRefreshNeedsConfirm({
        importSuppliers: [{ id: "i1", status: "chosen" }],
        sampleSupplierIds: [],
      }),
    ).toBe(true);
    expect(
      importRefreshNeedsConfirm({
        importSuppliers: [{ id: "i1", status: "available" }],
        sampleSupplierIds: ["i1"],
      }),
    ).toBe(true);
    expect(
      importRefreshNeedsConfirm({
        importSuppliers: [{ id: "i1", status: "available" }],
        sampleSupplierIds: ["local-1"],
      }),
    ).toBe(false);
  });

  it("plans deletes for Import only and preserves Local", () => {
    const plan = planImportRefreshDeletes({
      suppliers: [
        { id: "i1", source: "import" },
        { id: "i2", source: "import" },
        { id: "l1", source: "local" },
      ],
      samples: [
        { id: "s1", supplierId: "i1" },
        { id: "s2", supplierId: "l1" },
      ],
    });
    expect(plan.importSupplierIds).toEqual(["i1", "i2"]);
    expect(plan.localSupplierIds).toEqual(["l1"]);
    expect(plan.sampleIdsToDelete).toEqual(["s1"]);
    expect(plan.sampleIdsToDelete).not.toContain("s2");
  });

  it("classifies zero / partial / full live fallback", () => {
    expect(classifyRefreshFallback(0, 9)).toBe("heuristic");
    expect(classifyRefreshFallback(3, 9)).toBe("partial");
    expect(classifyRefreshFallback(9, 9)).toBe("none");
  });

  it("merge persists live_search + url and pads heuristic", () => {
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
    const leads: SupplierLead[] = [
      {
        name: "Live Factory A",
        platform: "alibaba",
        sourceUrl: "https://www.alibaba.com/a",
        externalTitle: "A",
        unitPriceHint: null,
        leadSource: "live_search",
      },
      {
        name: "Live Factory B",
        platform: "aliexpress",
        sourceUrl: "https://www.aliexpress.com/b",
        externalTitle: "B",
        unitPriceHint: 8,
        leadSource: "live_search",
      },
    ];
    const merged = mergeLiveLeadsIntoShortlist({
      source: "import",
      liveLeads: leads,
      heuristic,
    });
    expect(merged).toHaveLength(9);
    expect(merged.filter((m) => m.leadSource === "live_search")).toHaveLength(2);
    expect(merged[0]?.sourceUrl).toContain("alibaba.com");
    expect(merged[1]?.platform).toBe("aliexpress");
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
    expect(classifyRefreshFallback(0, merged.length)).toBe("heuristic");
  });

  it("wires refresh action + Import-tab control (Approach A)", () => {
    const service = readFileSync(
      path.join(process.cwd(), "src/lib/supplier/service.ts"),
      "utf8",
    );
    expect(service).toContain("export async function refreshImportLeads");
    expect(service).toContain("confirmResetProgress");
    const actions = readFileSync(
      path.join(process.cwd(), "src/actions/supplier.ts"),
      "utf8",
    );
    expect(actions).toContain("refreshImportLeadsAction");
    expect(actions).toContain("requireOwnedSku");
    const panel = readFileSync(
      path.join(process.cwd(), "src/components/supplier/SupplierPanel.tsx"),
      "utf8",
    );
    expect(panel).toContain("RefreshImportLeadsControl");
    expect(panel).toContain('effectiveTab === "import"');
    expect(panel).toContain("refreshImportLeadsAction");
  });
});
