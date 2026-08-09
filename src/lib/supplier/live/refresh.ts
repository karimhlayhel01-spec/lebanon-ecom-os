/**
 * Wave 3 — explicit “Refresh Import leads” planning helpers.
 * Page load still does not re-query (Approach A); only this path may replace invent Import.
 */

export type RefreshImportLeadsFallback = "none" | "partial" | "heuristic";

export type RefreshImportLeadsError =
  | "not_found"
  | "live_disabled"
  | "missing_key"
  | "needs_confirm"
  | "quota"
  | "api_error";

/**
 * Block silent wipe when Import is commercially in play (chosen batch path
 * or any sample row tied to an Import supplier).
 */
export function importRefreshNeedsConfirm(input: {
  importSuppliers: { id: string; status: string }[];
  sampleSupplierIds: string[];
}): boolean {
  const importIds = new Set(input.importSuppliers.map((s) => s.id));
  if (input.importSuppliers.some((s) => s.status === "chosen")) return true;
  return input.sampleSupplierIds.some((id) => importIds.has(id));
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

export function classifyRefreshFallback(
  liveCount: number,
  seatCount: number,
): RefreshImportLeadsFallback {
  if (liveCount <= 0) return "heuristic";
  if (liveCount >= seatCount) return "none";
  return "partial";
}
