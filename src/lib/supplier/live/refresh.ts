/**
 * Wave 3 — explicit Refresh Import / Refresh Local planning helpers.
 * Page load still does not re-query (Approach A); only these paths may replace seats.
 *
 * Conflict policy (warm spare / sample safety):
 * - In-flight sample on that source → hard block (no wipe even with confirm).
 * - Chosen path or approved/warm samples on that source → needs explicit confirm.
 */

import { aliexpressFirst } from "@/lib/supplier/live/fill-import-price";
import {
  isAliExpressLead,
  keepImportLiveLead,
  type MaxLandedGate,
} from "@/lib/supplier/live/max-landed";
import type { SupplierLead } from "@/lib/supplier/live/types";
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

/** Snapshot a persisted Import row into a lead, or null if not a live listing. */
export function priorRowToImportLead(row: {
  leadSource?: string | null;
  platform?: string | null;
  sourceUrl?: string | null;
  name: string;
  externalTitle?: string | null;
  unitPrice: number;
}): SupplierLead | null {
  if (row.leadSource !== "live_search") return null;
  const url = row.sourceUrl?.trim() ?? "";
  if (!url) return null;
  const lower = url.toLowerCase();
  const platform =
    row.platform === "aliexpress" || row.platform === "alibaba"
      ? row.platform
      : lower.includes("aliexpress.com")
        ? "aliexpress"
        : lower.includes("alibaba.com")
          ? "alibaba"
          : "other";
  return {
    name: row.name,
    platform,
    sourceUrl: url,
    externalTitle: (row.externalTitle ?? "").slice(0, 240),
    unitPriceHint: row.unitPrice > 0 ? row.unitPrice : null,
    leadSource: "live_search",
  };
}

/**
 * Persisted Alibaba unit is untrusted (invent leftover / coupon). Force re-extract.
 * AliExpress stored units stay — AE-first keep.
 */
export function distrustPersistedAlibabaUnit(lead: SupplierLead): SupplierLead {
  if (isAliExpressLead(lead)) return lead;
  return { ...lead, unitPriceHint: null };
}

/**
 * Re-gate a persisted Import row. Alibaba invent leftover / unknown / over-cap
 * must not stay on the board. AliExpress unknown keep is unchanged.
 */
export type ImportRefreshSeatRow = {
  source?: string | null;
  status?: string | null;
  leadSource?: string | null;
  platform?: string | null;
  sourceUrl?: string | null;
  name: string;
  externalTitle?: string | null;
  unitPrice: number;
};

export function shouldKeepPersistedImportLiveSeat(
  row: ImportRefreshSeatRow,
  gate: MaxLandedGate | null,
  hasSample = false,
): boolean {
  if (hasSample) return true;
  if (row.status != null && row.status !== "available") return true;
  if (row.source === "local") return true;
  const lead = priorRowToImportLead(row);
  if (!lead) return true;
  return keepImportLiveLead(distrustPersistedAlibabaUnit(lead), gate);
}

/** Same keep rule as getSupplierPanel — toast/liveCount must use this, not merge length. */
export function visibleImportRefreshSeats<T extends ImportRefreshSeatRow>(
  rows: readonly T[],
  gate: MaxLandedGate | null,
): T[] {
  return rows.filter((row) =>
    shouldKeepPersistedImportLiveSeat(row, gate, false),
  );
}

export function countVisibleImportLiveSeats(
  rows: readonly ImportRefreshSeatRow[],
  gate: MaxLandedGate | null,
): number {
  return visibleImportRefreshSeats(rows, gate).filter(
    (row) => row.leadSource === "live_search",
  ).length;
}

export function refreshImportToastKey(input: {
  visibleLiveCount: number;
  seatCount: number;
}): "refreshImportEmpty" | "refreshImportPartial" | "refreshImportLive" {
  const fallback = classifyRefreshFallback(
    input.visibleLiveCount,
    input.seatCount,
  );
  if (fallback === "empty" || input.visibleLiveCount <= 0) {
    return "refreshImportEmpty";
  }
  if (fallback === "partial" || fallback === "heuristic") {
    return "refreshImportPartial";
  }
  return "refreshImportLive";
}

/**
 * Refresh must keep prior cheap/unknown AliExpress (and known-fit Alibaba)
 * instead of replacing the board with one new survivor.
 */
export function unionImportRefreshLeads(input: {
  incoming: readonly SupplierLead[];
  prior: readonly SupplierLead[];
  gate: MaxLandedGate | null;
  maxSeats: number;
}): SupplierLead[] {
  const byUrl = new Map<string, SupplierLead>();
  for (const lead of input.prior) {
    const trusted = distrustPersistedAlibabaUnit(lead);
    if (!keepImportLiveLead(trusted, input.gate)) continue;
    byUrl.set(trusted.sourceUrl.toLowerCase(), trusted);
  }
  for (const lead of input.incoming) {
    if (!keepImportLiveLead(lead, input.gate)) continue;
    const key = lead.sourceUrl.toLowerCase();
    const prev = byUrl.get(key);
    const incomingHasUnit =
      lead.unitPriceHint != null && lead.unitPriceHint > 0;
    const priorHasUnit =
      prev != null && prev.unitPriceHint != null && prev.unitPriceHint > 0;
    if (prev && !incomingHasUnit && priorHasUnit) {
      continue;
    }
    byUrl.set(key, lead);
  }
  return aliexpressFirst([...byUrl.values()]).slice(
    0,
    Math.max(0, input.maxSeats),
  );
}
