/**
 * Wave 3 — explicit Refresh Import / Refresh Local planning helpers.
 * Page load still does not re-query (Approach A); only these paths may replace seats.
 *
 * Conflict policy (warm spare / sample safety):
 * - In-flight sample on that source → hard block (no wipe even with confirm).
 * - Chosen path or approved/warm samples on that source → needs explicit confirm.
 */

import { isSampleInFlight } from "@/lib/supplier/sample-flight";

export type RefreshImportLeadsFallback =
  | "none"
  | "partial"
  | "heuristic"
  | "empty";

export type RefreshLocalLeadsFallback = "none" | "partial" | "empty";

export type RefreshLeadsError =
  | "not_found"
  | "live_disabled"
  | "missing_key"
  | "needs_confirm"
  | "sample_in_flight"
  | "quota"
  | "api_error";

export type RefreshConflict =
  | { kind: "ok" }
  | { kind: "sample_in_flight" }
  | { kind: "needs_confirm" };

/**
 * Import refresh conflict for an owned SKU.
 * Stricter: any in-flight sample tied to Import → block.
 * Post-approve warm / chosen → confirm before wipe.
 */
export function classifyImportRefreshConflict(input: {
  importSuppliers: { id: string; status: string }[];
  samples: { supplierId: string; status: string }[];
}): RefreshConflict {
  const importIds = new Set(input.importSuppliers.map((s) => s.id));
  const tied = input.samples.filter((s) => importIds.has(s.supplierId));
  if (tied.some((s) => isSampleInFlight(s.status))) {
    return { kind: "sample_in_flight" };
  }
  if (input.importSuppliers.some((s) => s.status === "chosen")) {
    return { kind: "needs_confirm" };
  }
  if (tied.some((s) => s.status === "approved")) {
    return { kind: "needs_confirm" };
  }
  return { kind: "ok" };
}

/**
 * Local refresh conflict — same rules scoped to Local suppliers.
 */
export function classifyLocalRefreshConflict(input: {
  localSuppliers: { id: string; status: string }[];
  samples: { supplierId: string; status: string }[];
}): RefreshConflict {
  const localIds = new Set(input.localSuppliers.map((s) => s.id));
  const tied = input.samples.filter((s) => localIds.has(s.supplierId));
  if (tied.some((s) => isSampleInFlight(s.status))) {
    return { kind: "sample_in_flight" };
  }
  if (input.localSuppliers.some((s) => s.status === "chosen")) {
    return { kind: "needs_confirm" };
  }
  if (tied.some((s) => s.status === "approved")) {
    return { kind: "needs_confirm" };
  }
  return { kind: "ok" };
}

/** @deprecated Prefer classifyImportRefreshConflict — kept for call-site clarity. */
export function importRefreshNeedsConfirm(input: {
  importSuppliers: { id: string; status: string }[];
  sampleSupplierIds: string[];
}): boolean {
  // Legacy: treat any sample id as progress (cannot distinguish in-flight).
  // New code paths should use classifyImportRefreshConflict with statuses.
  if (input.importSuppliers.some((s) => s.status === "chosen")) return true;
  const importIds = new Set(input.importSuppliers.map((s) => s.id));
  return input.sampleSupplierIds.some((id) => importIds.has(id));
}

/** @deprecated Prefer classifyLocalRefreshConflict. */
export function localRefreshNeedsConfirm(input: {
  localSuppliers: { id: string; status: string }[];
  sampleSupplierIds: string[];
}): boolean {
  if (input.localSuppliers.some((s) => s.status === "chosen")) return true;
  const localIds = new Set(input.localSuppliers.map((s) => s.id));
  return input.sampleSupplierIds.some((id) => localIds.has(id));
}

/** Split delete targets — Local rows must never appear in importSupplierIds. */
export function planImportRefreshDeletes(input: {
  suppliers: { id: string; source: string }[];
  samples: { id: string; supplierId: string }[];
}): {
  importSupplierIds: string[];
  localSupplierIds: string[];
  sampleIdsToDelete: string[];
} {
  const importSupplierIds = input.suppliers
    .filter((s) => s.source === "import")
    .map((s) => s.id);
  const localSupplierIds = input.suppliers
    .filter((s) => s.source === "local")
    .map((s) => s.id);
  const importSet = new Set(importSupplierIds);
  const sampleIdsToDelete = input.samples
    .filter((s) => importSet.has(s.supplierId))
    .map((s) => s.id);
  return { importSupplierIds, localSupplierIds, sampleIdsToDelete };
}

/** Split delete targets — Import rows must never appear in localSupplierIds. */
export function planLocalRefreshDeletes(input: {
  suppliers: { id: string; source: string }[];
  samples: { id: string; supplierId: string }[];
}): {
  importSupplierIds: string[];
  localSupplierIds: string[];
  sampleIdsToDelete: string[];
} {
  const importSupplierIds = input.suppliers
    .filter((s) => s.source === "import")
    .map((s) => s.id);
  const localSupplierIds = input.suppliers
    .filter((s) => s.source === "local")
    .map((s) => s.id);
  const localSet = new Set(localSupplierIds);
  const sampleIdsToDelete = input.samples
    .filter((s) => localSet.has(s.supplierId))
    .map((s) => s.id);
  return { importSupplierIds, localSupplierIds, sampleIdsToDelete };
}

export function classifyRefreshFallback(
  liveCount: number,
  seatCount: number,
): RefreshImportLeadsFallback {
  if (liveCount <= 0) return "empty";
  if (liveCount >= seatCount) return "none";
  return "partial";
}

/** Local never invent-pads — zero live → empty; some live → partial or none. */
export function classifyLocalRefreshFallback(
  liveCount: number,
  seatCount: number,
): RefreshLocalLeadsFallback {
  if (liveCount <= 0) return "empty";
  if (liveCount >= seatCount) return "none";
  return "partial";
}
