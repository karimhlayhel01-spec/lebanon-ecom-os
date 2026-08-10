import { asc, eq } from "drizzle-orm";
import { db, ensureMigrated, schema } from "@/db";
import { resolveBatchArrivalEta } from "@/lib/supplier/batch-eta";
import {
  findFirstApprovedSample,
  findInFlightSample,
  resolveWorkingPathSupplierId,
} from "@/lib/supplier/sample-flight";

/**
 * Minimal supplier facts for hub Status orientation.
 *
 * Replaces getSupplierPanel (~10+ queries: ensureSuppliers, topic history,
 * all options, onboarding, side, live list, …) with 2 light selects.
 *
 * Hub query reduction (N live SKUs on Shop hub):
 * - Journeys: N× getSkuJourney → 1× listSkuJourneysForSkus (chips) + 1× in
 *   getShopOrchestration (also batched)
 * - Orientation Status: full SupplierPanel → this loader (2 selects) + kit check
 * Hub Next remains display-only from attention chips (no extra reads).
 */
export type HubSupplierStatusFacts = {
  activeSampleStatus: string | null;
  supplierName: string | null;
  /** When supplierName is set — id for founder rename after sample. */
  supplierId: string | null;
  /** Founder-entered path contacts — never scraped. */
  contactEmail: string | null;
  contactWhatsapp: string | null;
  etaFounderSet: boolean;
  etaSummaryEn: string;
  etaSummaryAr: string;
};

/** Pure: same naming rules as Supplier panel for hub Status (no DB). */
export function resolveHubSupplierStatusFactsFromRows(args: {
  sampleRows: readonly {
    supplierId: string;
    status: string;
  }[];
  supplierRows: readonly {
    id: string;
    name: string;
    contactEmail: string | null;
    contactWhatsapp: string | null;
  }[];
  batchArrivalEtaJson: string | null;
  reorderPathSupplierId: string | null;
  reorderSupplierId: string | null;
}): HubSupplierStatusFacts {
  const byId = new Map(args.supplierRows.map((s) => [s.id, s] as const));
  const inFlight = findInFlightSample(args.sampleRows);

  let activeSampleStatus: string | null = null;
  let supplierId: string | null = null;
  let supplierName: string | null = null;
  let contactEmail: string | null = null;
  let contactWhatsapp: string | null = null;

  if (inFlight) {
    activeSampleStatus = inFlight.status;
    supplierId = inFlight.supplierId;
    const row = byId.get(inFlight.supplierId);
    supplierName = row?.name ?? null;
    contactEmail = row?.contactEmail?.trim() || null;
    contactWhatsapp = row?.contactWhatsapp?.trim() || null;
  } else {
    const firstApproved = findFirstApprovedSample(args.sampleRows);
    const pathId = resolveWorkingPathSupplierId({
      reorderPathSupplierId: args.reorderPathSupplierId,
      reorderSupplierId: args.reorderSupplierId,
      firstApprovedSupplierId: firstApproved?.supplierId ?? null,
    });
    supplierId = pathId;
    const row = pathId ? byId.get(pathId) : undefined;
    supplierName = row?.name ?? null;
    contactEmail = row?.contactEmail?.trim() || null;
    contactWhatsapp = row?.contactWhatsapp?.trim() || null;
  }

  const eta = resolveBatchArrivalEta(args.batchArrivalEtaJson);
  const named = !!supplierName;
  return {
    activeSampleStatus,
    supplierName,
    supplierId: named ? supplierId : null,
    contactEmail: named ? contactEmail : null,
    contactWhatsapp: named ? contactWhatsapp : null,
    etaFounderSet: eta.founderSet,
    etaSummaryEn: eta.summaryEn,
    etaSummaryAr: eta.summaryAr,
  };
}

/**
 * Load only what mapSupplierStatusRow needs for one SKU’s hub Status card.
 */
export async function loadHubSupplierStatusFacts(args: {
  skuId: string;
  batchArrivalEtaJson: string | null;
  reorderPathSupplierId: string | null;
  reorderSupplierId: string | null;
}): Promise<HubSupplierStatusFacts> {
  await ensureMigrated();

  const [sampleRows, supplierRows] = await Promise.all([
    db
      .select({
        supplierId: schema.sampleRecords.supplierId,
        status: schema.sampleRecords.status,
        createdAt: schema.sampleRecords.createdAt,
      })
      .from(schema.sampleRecords)
      .where(eq(schema.sampleRecords.skuId, args.skuId))
      .orderBy(asc(schema.sampleRecords.createdAt)),
    db
      .select({
        id: schema.supplierOptions.id,
        name: schema.supplierOptions.name,
        contactEmail: schema.supplierOptions.contactEmail,
        contactWhatsapp: schema.supplierOptions.contactWhatsapp,
      })
      .from(schema.supplierOptions)
      .where(eq(schema.supplierOptions.skuId, args.skuId)),
  ]);

  return resolveHubSupplierStatusFactsFromRows({
    sampleRows,
    supplierRows,
    batchArrivalEtaJson: args.batchArrivalEtaJson,
    reorderPathSupplierId: args.reorderPathSupplierId,
    reorderSupplierId: args.reorderSupplierId,
  });
}
