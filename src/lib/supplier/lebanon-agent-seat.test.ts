import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { shouldShowAssessListing } from "@/lib/supplier/diligence/listing-url";
import {
  knownWorkingUnitPrice,
  resolveCostQuotesPrefill,
} from "@/lib/supplier/quotes";
import {
  IMPORT_SOURCING_AGENT_DIRECTORY,
  LEBANON_AGENT_LEAD_SOURCE,
  LEBANON_AGENT_PLATFORM,
  agentNameForHost,
  batchUnitPriceForEstimate,
  buildLebanonAgentSeatValues,
  defaultBatchQty,
  defaultBatchSupplierId,
  estimateBatchCostAtMoq,
  fallbackBatchUnitPrice,
  hostFromAgentSourceUrl,
  importCostQuoteCopyKeys,
  isLebanonAgentPlatform,
  knownSupplierMoq,
  knownSupplierUnitPrice,
  planUndoLebanonAgentSeat,
  planUseLebanonAgentSeat,
  sanitiseAllowListedAgentHttpsUrl,
  seatedHostAfterUndo,
  suppliersIncludingLebanonAgentSeat,
  undoLebanonAgentDeleteIds,
} from "@/lib/supplier/lebanon-agent-seat";
import {
  classifyImportRefreshConflict,
  planImportRefreshDeletes,
  priorRowToImportLead,
  shouldKeepPersistedImportLiveSeat,
  unionImportRefreshLeads,
  visibleImportRefreshSeats,
} from "@/lib/supplier/live/refresh";
import { keepImportLiveLead } from "@/lib/supplier/live/max-landed";
import { supplierCardSampleCta } from "@/lib/supplier/sample-flight";

const gate100 = {
  maxLandedCost: 100,
  intlShip: 0,
  clearanceTaxes: 0,
  localCourier: 0,
};

function loadMessages() {
  const en = JSON.parse(
    readFileSync(path.join(process.cwd(), "messages/en.json"), "utf8"),
  ) as { Supplier: Record<string, string> };
  const ar = JSON.parse(
    readFileSync(path.join(process.cwd(), "messages/ar.json"), "utf8"),
  ) as { Supplier: Record<string, string> };
  return { en: en.Supplier, ar: ar.Supplier };
}

describe("sanitiseAllowListedAgentHttpsUrl", () => {
  it("inserts allow-listed host only and rejects other URLs", () => {
    expect(sanitiseAllowListedAgentHttpsUrl("nourexpress.me")).toBe(
      "https://nourexpress.me",
    );
    expect(
      sanitiseAllowListedAgentHttpsUrl("https://www.chinatolebanon.com/foo?x=1"),
    ).toBe("https://chinatolebanon.com");
    expect(sanitiseAllowListedAgentHttpsUrl("http://picknship.net")).toBe(
      "https://picknship.net",
    );
    expect(sanitiseAllowListedAgentHttpsUrl("https://chinagatelb.com")).toBe(
      "https://chinagatelb.com",
    );
    expect(sanitiseAllowListedAgentHttpsUrl("https://evil.com")).toBeNull();
    expect(
      sanitiseAllowListedAgentHttpsUrl("https://nourexpress.me.evil.com"),
    ).toBeNull();
    expect(sanitiseAllowListedAgentHttpsUrl("https://asl.com.lb")).toBeNull();
    expect(
      sanitiseAllowListedAgentHttpsUrl("javascript:alert(1)"),
    ).toBeNull();
    expect(
      sanitiseAllowListedAgentHttpsUrl("https://user:pass@nourexpress.me"),
    ).toBeNull();
    expect(IMPORT_SOURCING_AGENT_DIRECTORY).toHaveLength(4);
    expect(agentNameForHost("picknship.net")).toBe("Pick N Ship");
  });
});

describe("planUseLebanonAgentSeat", () => {
  it("one seat: second Use replaces when no sample; blocked when sample on that seat", () => {
    expect(
      planUseLebanonAgentSeat({
        canonicalUrl: "https://nourexpress.me",
        existing: null,
        hasSample: false,
      }),
    ).toEqual({ kind: "insert" });
    expect(
      planUseLebanonAgentSeat({
        canonicalUrl: "https://picknship.net",
        existing: {
          id: "seat-1",
          sourceUrl: "https://nourexpress.me",
        },
        hasSample: false,
      }),
    ).toEqual({ kind: "replace", existingId: "seat-1" });
    expect(
      planUseLebanonAgentSeat({
        canonicalUrl: "https://picknship.net",
        existing: {
          id: "seat-1",
          sourceUrl: "https://nourexpress.me",
        },
        hasSample: true,
      }),
    ).toEqual({ kind: "blocked", existingId: "seat-1" });
    expect(
      planUseLebanonAgentSeat({
        canonicalUrl: "https://nourexpress.me",
        existing: {
          id: "seat-1",
          sourceUrl: "https://nourexpress.me",
        },
        hasSample: true,
      }),
    ).toEqual({ kind: "keep", existingId: "seat-1" });
  });

  it("other-host Use still replaces when no sample", () => {
    expect(
      planUseLebanonAgentSeat({
        canonicalUrl: "https://chinagatelb.com",
        existing: {
          id: "seat-1",
          sourceUrl: "https://picknship.net",
        },
        hasSample: false,
      }),
    ).toEqual({ kind: "replace", existingId: "seat-1" });
  });
});

describe("planUndoLebanonAgentSeat", () => {
  it("Undo with no sample → seat gone, seatedHost null", () => {
    const plan = planUndoLebanonAgentSeat({
      existing: { id: "seat-1" },
      hasSample: false,
    });
    expect(plan).toEqual({ kind: "delete", existingId: "seat-1" });
    expect(
      seatedHostAfterUndo({
        seatedHost: "nourexpress.me",
        plan,
      }),
    ).toBeNull();
    expect(
      undoLebanonAgentDeleteIds([
        { id: "seat-1", platform: LEBANON_AGENT_PLATFORM },
        { id: "live-ae", platform: "aliexpress" },
        { id: "live-ali", platform: "alibaba" },
      ]),
    ).toEqual(["seat-1"]);
  });

  it("Undo with sample → blocked, seat remains", () => {
    const plan = planUndoLebanonAgentSeat({
      existing: { id: "seat-1" },
      hasSample: true,
    });
    expect(plan).toEqual({ kind: "blocked", existingId: "seat-1" });
    expect(
      seatedHostAfterUndo({
        seatedHost: "nourexpress.me",
        plan,
      }),
    ).toBe("nourexpress.me");
  });
});

describe("lebanon_agent refresh / gate keep", () => {
  const agentRow = {
    source: "import" as const,
    status: "available" as const,
    leadSource: LEBANON_AGENT_LEAD_SOURCE,
    platform: LEBANON_AGENT_PLATFORM,
    sourceUrl: "https://nourexpress.me",
    name: "Nour Express",
    unitPrice: 0,
  };

  it("keeps lebanon_agent with unit 0 and does not run keepImportLiveLead on them", () => {
    expect(shouldKeepPersistedImportLiveSeat(agentRow, gate100)).toBe(true);
    expect(priorRowToImportLead(agentRow)).toBeNull();
    expect(
      priorRowToImportLead({
        ...agentRow,
        leadSource: "live_search",
      }),
    ).toBeNull();
    expect(
      visibleImportRefreshSeats([agentRow], gate100),
    ).toHaveLength(1);
    const mislabeled = {
      name: "Nour Express",
      platform: LEBANON_AGENT_PLATFORM as "other",
      sourceUrl: "https://nourexpress.me",
      externalTitle: "",
      unitPriceHint: null,
      leadSource: "live_search" as const,
    };
    expect(isLebanonAgentPlatform(mislabeled.platform)).toBe(true);
    expect(keepImportLiveLead(mislabeled, gate100)).toBe(false);
    expect(
      unionImportRefreshLeads({
        incoming: [],
        prior: [mislabeled],
        gate: gate100,
        maxSeats: 5,
      }),
    ).toHaveLength(0);
  });

  it("live_search unknown non-AE is still hidden (regression)", () => {
    const unknownAli = {
      source: "import" as const,
      status: "available" as const,
      leadSource: "live_search" as const,
      platform: "alibaba" as const,
      sourceUrl: "https://www.alibaba.com/product-detail/x.html",
      name: "Ali",
      unitPrice: 0,
    };
    expect(shouldKeepPersistedImportLiveSeat(unknownAli, gate100)).toBe(false);
    const lead = priorRowToImportLead(unknownAli);
    expect(lead).not.toBeNull();
    expect(keepImportLiveLead(lead!, gate100)).toBe(false);
    expect(
      unionImportRefreshLeads({
        incoming: [],
        prior: lead ? [lead] : [],
        gate: gate100,
        maxSeats: 5,
      }),
    ).toHaveLength(0);
  });

  it("Refresh deletes skip lebanon_agent; in-flight sample on agent does not block marketplace refresh", () => {
    const plan = planImportRefreshDeletes({
      suppliers: [
        { id: "i1", source: "import", platform: "alibaba" },
        {
          id: "agent",
          source: "import",
          platform: LEBANON_AGENT_PLATFORM,
        },
        { id: "l1", source: "local" },
      ],
      samples: [
        { id: "s-import", supplierId: "i1" },
        { id: "s-agent", supplierId: "agent" },
        { id: "s-local", supplierId: "l1" },
      ],
    });
    expect(plan.importSupplierIds).toEqual(["i1"]);
    expect(plan.sampleIdsToDelete).toEqual(["s-import"]);
    expect(plan.localSupplierIds).toEqual(["l1"]);
    expect(
      classifyImportRefreshConflict({
        importSuppliers: [
          { id: "i1", status: "available", platform: "alibaba" },
          {
            id: "agent",
            status: "available",
            platform: LEBANON_AGENT_PLATFORM,
          },
        ],
        samples: [{ supplierId: "agent", status: "requested" }],
      }),
    ).toEqual({ kind: "ok" });
  });
});

describe("lebanon_agent sample + Assess", () => {
  it("request sample works on the new id", () => {
    const values = buildLebanonAgentSeatValues({
      name: "Nour Express",
      sourceUrl: "https://nourexpress.me",
      productName: "Collapsible lunch box",
    });
    expect(values.platform).toBe(LEBANON_AGENT_PLATFORM);
    expect(values.leadSource).toBe(LEBANON_AGENT_LEAD_SOURCE);
    expect(values.unitPrice).toBe(0);
    expect(values.moq).toBe(0);
    expect(values.years).toBe(0);
    expect(values.rating).toBe(0);
    expect(values.source).toBe("import");
    const newId = "lebanon-agent-seat-1";
    expect(
      supplierCardSampleCta({
        mode: "first_sample",
        sampleInFlight: false,
        supplierId: newId,
        pathSupplierId: null,
        sameSourceAsPath: true,
      }).kind,
    ).toBe("request_sample");
    const service = readFileSync(
      path.join(process.cwd(), "src/lib/supplier/service.ts"),
      "utf8",
    );
    const start = service.indexOf("export async function requestSample");
    const end = service.indexOf("export async function markSampleReceived");
    const requestSampleFn = service.slice(start, end);
    expect(requestSampleFn).toContain("ownedSupplier(workspaceId, supplierId)");
    expect(requestSampleFn).not.toContain("lebanon_agent");
  });

  it("Assess is hidden for lebanon_agent", () => {
    expect(
      shouldShowAssessListing({
        platform: LEBANON_AGENT_PLATFORM,
        sourceUrl: "https://nourexpress.me",
      }),
    ).toBe(false);
    expect(
      shouldShowAssessListing({
        platform: "alibaba",
        sourceUrl: "https://www.alibaba.com/product-detail/x.html",
      }),
    ).toBe(true);
    const panel = readFileSync(
      path.join(process.cwd(), "src/components/supplier/SupplierPanel.tsx"),
      "utf8",
    );
    expect(panel).toContain("shouldShowAssessListing");
    expect(panel).toContain("isLebanonAgentPlatform(s.platform)");
    const diligence = readFileSync(
      path.join(process.cwd(), "src/lib/supplier/diligence/service.ts"),
      "utf8",
    );
    expect(diligence).toContain("isLebanonAgentPlatform(supplier.platform)");
  });
});

describe("lebanon_agent cost-quote copy", () => {
  it("agent-path clearance guide has no asl.com.lb; factory-direct Import guide still has brokers", () => {
    const { en, ar } = loadMessages();
    expect(en.costQuotesGuideClearance).toContain("asl.com.lb");
    expect(ar.costQuotesGuideClearance).toContain("asl.com.lb");
    expect(en.costQuotesGuideClearanceAgent).not.toMatch(/asl\.com\.lb/i);
    expect(ar.costQuotesGuideClearanceAgent).not.toMatch(/asl\.com\.lb/i);
    expect(en.costQuotesGuideClearanceAgent).not.toMatch(/oceanlink/i);
    expect(en.costQuotesGuideClearanceAgent).not.toMatch(/chami\.co/i);
    expect(en.costQuotesGuideFreightAgent).toMatch(/door-to-door|all-in/i);
    expect(en.costQuotesIntroAgent).toMatch(/invoice/i);
    expect(importCostQuoteCopyKeys("lebanon_agent").clearance).toBe(
      "costQuotesGuideClearanceAgent",
    );
    expect(importCostQuoteCopyKeys("alibaba").clearance).toBe(
      "costQuotesGuideClearance",
    );
  });

  it("agent unitPrice 0 prefills from snapshot or saved quotes, not $0", () => {
    const values = buildLebanonAgentSeatValues({
      name: "Nour Express",
      sourceUrl: "https://nourexpress.me",
      productName: "Collapsible lunch box",
    });
    expect(values.unitPrice).toBe(0);
    expect(knownWorkingUnitPrice(values.unitPrice)).toBeNull();
    const planning = {
      productCost: 6.25,
      intlShip: 1,
      clearanceTaxes: 0.5,
      supplierDelivery: 1,
      packaging: 0.5,
      localCourier: 2,
      sellPrice: 30,
    };
    expect(
      resolveCostQuotesPrefill({
        saved: false,
        quoted: null,
        planningPrefill: {
          ...planning,
          productCost:
            knownWorkingUnitPrice(values.unitPrice) ?? planning.productCost,
        },
        workingUnitPrice: knownWorkingUnitPrice(values.unitPrice),
      }).productCost,
    ).toBe(6.25);
    expect(
      resolveCostQuotesPrefill({
        saved: true,
        quoted: {
          productCost: 9,
          intlShip: 1.2,
          clearanceTaxes: 0.8,
          localCourier: 2.5,
          sellPrice: 32,
        },
        planningPrefill: planning,
        workingUnitPrice: values.unitPrice,
      }).productCost,
    ).toBe(9);
    const service = readFileSync(
      path.join(process.cwd(), "src/lib/supplier/service.ts"),
      "utf8",
    );
    const start = service.indexOf("const planningPrefill");
    const end = service.indexOf("const primaryState");
    const slice = service.slice(start, end);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(slice).toContain("knownWorkingUnitPrice");
    expect(slice).toContain("sku.moneySnapshot.productCost");
    expect(slice).not.toMatch(/chosenSupplier\?\.unitPrice \?\?/);
    expect(slice).not.toMatch(/\.set\(\{[^}]*unitPrice/);
    const saveStart = service.indexOf("export async function saveCostQuotes");
    const saveEnd = service.indexOf("export async function orderBatch");
    const saveFn = service.slice(saveStart, saveEnd);
    expect(saveFn).not.toContain("supplierOptions");
    expect(saveFn).toContain("quotedCosts");
  });

  it("does not add agent seats to Discovery service", () => {
    const discovery = readFileSync(
      path.join(process.cwd(), "src/lib/discovery/service.ts"),
      "utf8",
    );
    expect(discovery).not.toContain("lebanon_agent");
    expect(discovery).not.toContain("useLebanonSourcingAgent");
    expect(discovery).not.toContain("importSourcingAgentNote");
  });

  it("wires Use-this-agent action + picker", () => {
    const { en, ar } = loadMessages();
    const actions = readFileSync(
      path.join(process.cwd(), "src/actions/supplier.ts"),
      "utf8",
    );
    expect(actions).toContain("useLebanonSourcingAgentAction");
    expect(actions).toContain("undoLebanonSourcingAgentAction");
    const panel = readFileSync(
      path.join(process.cwd(), "src/components/supplier/SupplierPanel.tsx"),
      "utf8",
    );
    expect(panel).toContain("useThisAgentOnSku");
    expect(panel).toContain("openAgentSite");
    expect(panel).toContain("undoUseAgentOnSku");
    expect(panel).not.toContain("useAgentInUse");
    expect(en.undoUseAgentOnSku).toMatch(/Undo — remove this agent from this SKU/);
    expect(ar.undoUseAgentOnSku).toMatch(/تراجع/);
    expect(en.undoUseAgentOnSku).not.toMatch(/whatsapp|\+961/i);
    expect(hostFromAgentSourceUrl("https://www.nourexpress.me/path")).toBe(
      "nourexpress.me",
    );
  });
});

describe("lebanon_agent batch dropdown + estimate (WAVE-3 §3.6)", () => {
  const marketplace = {
    id: "ali-1",
    name: "Alibaba listing",
    platform: "alibaba",
    unitPrice: 4.5,
    moq: 200,
  };
  const agent = {
    id: "agent-1",
    name: "Nour Express",
    platform: LEBANON_AGENT_PLATFORM,
    unitPrice: 0,
    moq: 0,
  };

  it("includes the directory seat and prefers the approved agent id", () => {
    const groups = [
      {
        primary: marketplace,
        backups: [
          {
            id: "ali-2",
            name: "Backup",
            platform: "aliexpress",
            unitPrice: 3,
            moq: 100,
          },
        ],
      },
    ];
    const suppliers = suppliersIncludingLebanonAgentSeat(groups, agent);
    expect(suppliers.map((s) => s.id)).toEqual(["ali-1", "ali-2", "agent-1"]);
    expect(
      defaultBatchSupplierId({
        suppliers,
        approvedSampleSupplierId: agent.id,
        sampleSupplierId: agent.id,
        approvedSupplierIds: [agent.id],
      }),
    ).toBe(agent.id);
    expect(defaultBatchQty(knownSupplierMoq(agent))).toBe(100);
  });

  it("does not treat agent unitPrice 0 as a real MOQ cost", () => {
    expect(knownSupplierUnitPrice(agent)).toBeNull();
    expect(knownSupplierMoq(agent)).toBeNull();
    expect(
      estimateBatchCostAtMoq({
        supplier: agent,
        intlShip: 1,
        clearanceTaxes: 0.5,
        fallbackUnitPrice: 8,
      }),
    ).toBeNull();
    expect(
      batchUnitPriceForEstimate({
        supplier: agent,
        fallbackUnitPrice: 8,
      }),
    ).toBe(8);
    expect(
      batchUnitPriceForEstimate({
        supplier: agent,
        fallbackUnitPrice: 0,
      }),
    ).toBeNull();
    expect(
      fallbackBatchUnitPrice({
        quotedProductCost: 0,
        planningProductCost: 6.25,
      }),
    ).toBe(6.25);
    expect(
      estimateBatchCostAtMoq({
        supplier: marketplace,
        intlShip: 1,
        clearanceTaxes: 0.5,
      }),
    ).toBe(Math.round((4.5 + 1 + 0.5) * 200));
  });

  it("locks BatchOrder to the agent seat list (not groups-only)", () => {
    const panel = readFileSync(
      path.join(process.cwd(), "src/components/supplier/SupplierPanel.tsx"),
      "utf8",
    );
    const start = panel.indexOf("function BatchOrder");
    const end = panel.indexOf("function NextBatchOrder");
    const batchFn = panel.slice(start, end);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(batchFn).toContain("suppliersIncludingLebanonAgentSeat");
    expect(batchFn).toContain("view.lebanonAgentSeat");
    expect(batchFn).toContain("defaultBatchSupplierId");
    expect(batchFn).toContain("estimateBatchCostAtMoq");
    expect(batchFn).toContain("batchUnitPriceForEstimate");
    expect(batchFn).toContain("knownSupplierUnitPrice");
    expect(batchFn).not.toMatch(/view\.groups\.flatMap/);
    expect(batchFn).not.toContain("batchEstAtMoq");
  });
});
