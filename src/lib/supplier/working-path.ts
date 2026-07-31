import { asc, inArray } from "drizzle-orm";
import { db, ensureMigrated, schema } from "@/db";
import { effectiveJourneyState } from "@/lib/sku/page-sections";
import {
  listReorderBackupCandidates,
  parseUnavailableSuppliers,
} from "@/lib/supplier/reorder-escape";
import {
  canShowBackupInsurance,
  findFirstApprovedSample,
  listWarmSparesForSwitch,
  resolveWorkingPathSupplierId,
} from "@/lib/supplier/sample-flight";
import {
  normalizeSupplierSource,
  type SupplierSource,
} from "@/lib/supplier/source";

/**
 * Working supplier display name per SKU for Shop hub chips.
 * Same path id order as Supplier panel (`approvedSampleSupplierName`).
 * Spare / insurance-only approvals never appear unless they become the path.
 */
export async function resolveWorkingSupplierNamesBySku(
  skuIds: readonly string[],
  journeys: ReadonlyMap<
    string,
    {
      reorderPathSupplierId: string | null;
      reorderSupplierId: string | null;
    }
  >,
): Promise<Map<string, string | null>> {
  ensureMigrated();
  const out = new Map<string, string | null>();
  for (const id of skuIds) out.set(id, null);
  if (skuIds.length === 0) return out;

  const ids = [...skuIds];
  const [sampleRows, supplierRows] = await Promise.all([
    db
      .select({
        skuId: schema.sampleRecords.skuId,
        supplierId: schema.sampleRecords.supplierId,
        status: schema.sampleRecords.status,
        createdAt: schema.sampleRecords.createdAt,
      })
      .from(schema.sampleRecords)
      .where(inArray(schema.sampleRecords.skuId, ids))
      .orderBy(asc(schema.sampleRecords.createdAt))
      .all(),
    db
      .select({
        id: schema.supplierOptions.id,
        skuId: schema.supplierOptions.skuId,
        name: schema.supplierOptions.name,
      })
      .from(schema.supplierOptions)
      .where(inArray(schema.supplierOptions.skuId, ids))
      .all(),
  ]);

  const samplesBySku = new Map<string, typeof sampleRows>();
  for (const row of sampleRows) {
    const list = samplesBySku.get(row.skuId) ?? [];
    list.push(row);
    samplesBySku.set(row.skuId, list);
  }

  const nameBySupplierId = new Map(
    supplierRows.map((s) => [s.id, s.name] as const),
  );

  for (const skuId of ids) {
    const journey = journeys.get(skuId);
    const firstApproved = findFirstApprovedSample(
      samplesBySku.get(skuId) ?? [],
    );
    const pathId = resolveWorkingPathSupplierId({
      reorderPathSupplierId: journey?.reorderPathSupplierId,
      reorderSupplierId: journey?.reorderSupplierId,
      firstApprovedSupplierId: firstApproved?.supplierId ?? null,
    });
    out.set(skuId, pathId ? (nameBySupplierId.get(pathId) ?? null) : null);
  }

  return out;
}

export type HubWarmedSpares = {
  insuranceAvailable: boolean;
  /** Approved same-source non-path suppliers (warm spares only). */
  warmedSpareNames: string[];
};

/**
 * Pure: hub warmed-spare line from one SKU’s samples/suppliers.
 * Never lists the working/path supplier or cold (non-approved) backups.
 */
export function resolveHubWarmedSpares(args: {
  sampleApproved: boolean;
  primaryState: string;
  pathSupplierId: string | null;
  pathSource: SupplierSource;
  suppliers: readonly {
    id: string;
    name: string;
    role: string;
    source: SupplierSource;
    moq: number;
    unitPrice: number;
  }[];
  approvedSampleSupplierIds: ReadonlySet<string>;
  unavailable: ReturnType<typeof parseUnavailableSuppliers>;
}): HubWarmedSpares {
  const insuranceAvailable = canShowBackupInsurance({
    sampleApproved: args.sampleApproved,
    primaryState: args.primaryState,
  });
  if (!insuranceAvailable) {
    return { insuranceAvailable: false, warmedSpareNames: [] };
  }

  const backups = listReorderBackupCandidates({
    suppliers: args.suppliers,
    pathSource: args.pathSource,
    pathSupplierId: args.pathSupplierId,
    approvedSampleSupplierIds: args.approvedSampleSupplierIds,
    unavailable: args.unavailable,
  });
  const warm = listWarmSparesForSwitch(backups);
  return {
    insuranceAvailable: true,
    warmedSpareNames: warm.map((b) => b.name),
  };
}

/**
 * Warmed spare names per live SKU for Shop hub rows.
 * Isolated by skuId — no workspace-side bleed across products.
 */
export async function resolveWarmedSparesBySku(
  skuIds: readonly string[],
  journeys: ReadonlyMap<
    string,
    {
      primaryState: string;
      pausedFromState: string | null;
      sampleStatus: string;
      reorderPathSupplierId: string | null;
      reorderSupplierId: string | null;
      reorderUnavailableJson: string | null;
    }
  >,
): Promise<Map<string, HubWarmedSpares>> {
  ensureMigrated();
  const empty: HubWarmedSpares = {
    insuranceAvailable: false,
    warmedSpareNames: [],
  };
  const out = new Map<string, HubWarmedSpares>();
  for (const id of skuIds) out.set(id, empty);
  if (skuIds.length === 0) return out;

  const ids = [...skuIds];
  const [sampleRows, supplierRows] = await Promise.all([
    db
      .select({
        skuId: schema.sampleRecords.skuId,
        supplierId: schema.sampleRecords.supplierId,
        status: schema.sampleRecords.status,
        createdAt: schema.sampleRecords.createdAt,
      })
      .from(schema.sampleRecords)
      .where(inArray(schema.sampleRecords.skuId, ids))
      .orderBy(asc(schema.sampleRecords.createdAt))
      .all(),
    db
      .select({
        id: schema.supplierOptions.id,
        skuId: schema.supplierOptions.skuId,
        name: schema.supplierOptions.name,
        role: schema.supplierOptions.role,
        source: schema.supplierOptions.source,
        moq: schema.supplierOptions.moq,
        unitPrice: schema.supplierOptions.unitPrice,
      })
      .from(schema.supplierOptions)
      .where(inArray(schema.supplierOptions.skuId, ids))
      .all(),
  ]);

  const samplesBySku = new Map<string, typeof sampleRows>();
  for (const row of sampleRows) {
    const list = samplesBySku.get(row.skuId) ?? [];
    list.push(row);
    samplesBySku.set(row.skuId, list);
  }

  const suppliersBySku = new Map<string, typeof supplierRows>();
  for (const row of supplierRows) {
    const list = suppliersBySku.get(row.skuId) ?? [];
    list.push(row);
    suppliersBySku.set(row.skuId, list);
  }

  for (const skuId of ids) {
    const journey = journeys.get(skuId);
    if (!journey) {
      out.set(skuId, empty);
      continue;
    }

    const samples = samplesBySku.get(skuId) ?? [];
    const suppliers = (suppliersBySku.get(skuId) ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      role: s.role,
      source: normalizeSupplierSource(s.source),
      moq: s.moq,
      unitPrice: s.unitPrice,
    }));

    const approvedSampleSupplierIds = new Set(
      samples.filter((s) => s.status === "approved").map((s) => s.supplierId),
    );
    const firstApproved = findFirstApprovedSample(samples);
    const lockedPathId = resolveWorkingPathSupplierId({
      reorderPathSupplierId: journey.reorderPathSupplierId,
      reorderSupplierId: journey.reorderSupplierId,
      firstApprovedSupplierId: firstApproved?.supplierId ?? null,
    });
    const unavailable = parseUnavailableSuppliers(
      journey.reorderUnavailableJson,
    );
    // Match Supplier panel: spare list uses locked path even if unavailable.
    const pathSupplierId = lockedPathId;
    const pathRow = pathSupplierId
      ? suppliers.find((s) => s.id === pathSupplierId)
      : undefined;
    const pathSource = pathRow?.source ?? "import";

    const primaryState = effectiveJourneyState({
      primaryState: journey.primaryState,
      pausedFromState: journey.pausedFromState,
    });
    const sampleApproved =
      journey.sampleStatus === "approved" || approvedSampleSupplierIds.size > 0;

    out.set(
      skuId,
      resolveHubWarmedSpares({
        sampleApproved,
        primaryState,
        pathSupplierId,
        pathSource,
        suppliers,
        approvedSampleSupplierIds,
        unavailable,
      }),
    );
  }

  return out;
}
