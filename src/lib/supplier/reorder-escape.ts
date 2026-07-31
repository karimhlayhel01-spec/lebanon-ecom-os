/**
 * Slice 2 — warm backup + can’t-fulfill escape (pure helpers).
 * Builds on slice-1 reorder; never advances primary out of selling.
 */

import type { ExperienceLevel } from "@/lib/sku/add-sku-gate";
import type { SupplierSource } from "@/lib/supplier/source";

export const CANT_FULFILL_REASONS = [
  "no_stock",
  "moq",
  "price",
  "no_reply",
  "other",
] as const;
export type CantFulfillReason = (typeof CANT_FULFILL_REASONS)[number];

export type UnavailableSupplierEntry = {
  reason: CantFulfillReason | string;
  at: string;
};

export type UnavailableSuppliersMap = Record<string, UnavailableSupplierEntry>;

export function parseUnavailableSuppliers(
  raw: string | null | undefined,
): UnavailableSuppliersMap {
  if (!raw?.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return {};
    const out: UnavailableSuppliersMap = {};
    for (const [id, v] of Object.entries(parsed)) {
      if (!v || typeof v !== "object") continue;
      const row = v as { reason?: string; at?: string };
      out[id] = {
        reason: String(row.reason ?? "other"),
        at: String(row.at ?? ""),
      };
    }
    return out;
  } catch {
    return {};
  }
}

export function serializeUnavailableSuppliers(
  map: UnavailableSuppliersMap,
): string {
  return JSON.stringify(map);
}

export function parseCrisisSkipIds(raw: string | null | undefined): Set<string> {
  if (!raw?.trim()) return new Set();
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return new Set(parsed.map(String));
    }
    if (parsed && typeof parsed === "object") {
      return new Set(Object.keys(parsed as Record<string, unknown>));
    }
    return new Set();
  } catch {
    return new Set();
  }
}

export function serializeCrisisSkipIds(ids: Iterable<string>): string {
  return JSON.stringify([...ids]);
}

export type BackupCandidate = {
  id: string;
  name: string;
  role: "primary" | "backup";
  source: SupplierSource;
  moq: number;
  unitPrice: number;
  /** Has an approved sample for this SKU. */
  warm: boolean;
  unavailable: boolean;
};

/**
 * Spare candidates for insurance / can’t-fulfill re-pick.
 * Primary/backup labels are ranking only — any same-source supplier except the
 * working/path id (and unavailable) can be a spare. Warm = approved sample.
 */
export function listReorderBackupCandidates(args: {
  suppliers: readonly {
    id: string;
    name: string;
    role: string;
    source: SupplierSource;
    moq: number;
    unitPrice: number;
  }[];
  pathSource: SupplierSource;
  /** Working/path supplier — never listed as a spare. */
  pathSupplierId?: string | null;
  approvedSampleSupplierIds: ReadonlySet<string>;
  unavailable: UnavailableSuppliersMap;
}): BackupCandidate[] {
  return args.suppliers
    .filter(
      (s) =>
        s.id !== args.pathSupplierId &&
        s.source === args.pathSource &&
        !args.unavailable[s.id],
    )
    .map((s) => ({
      id: s.id,
      name: s.name,
      role: (s.role === "primary" ? "primary" : "backup") as
        | "primary"
        | "backup",
      source: s.source,
      moq: s.moq,
      unitPrice: s.unitPrice,
      warm: args.approvedSampleSupplierIds.has(s.id),
      unavailable: false,
    }));
}

/** Soft-coach warm backup when sample approved / selling and no warm backup yet. */
export function shouldCoachWarmBackup(args: {
  primaryState: string;
  sampleApproved: boolean;
  hasWarmBackup: boolean;
}): boolean {
  if (args.hasWarmBackup) return false;
  if (!args.sampleApproved) return false;
  return (
    args.primaryState === "selling" ||
    args.primaryState === "sample_approved" ||
    args.primaryState === "store_setup" ||
    args.primaryState === "batch_ordered" ||
    args.primaryState === "batch_arrived_ready"
  );
}

export function hasWarmBackup(
  candidates: readonly { warm: boolean }[],
): boolean {
  return candidates.some((c) => c.warm);
}

/**
 * Crisis sample skip on cold backup (reorder switch only).
 * beginner: never. some/experienced: WARN + required ack.
 */
export type CrisisSkipGateResult =
  | { ok: true; requiresAck: boolean }
  | { ok: false; error: "beginner_no_skip" | "not_cold" };

export function evaluateCrisisSampleSkip(args: {
  experience: ExperienceLevel;
  /** Chosen backup already has approved sample. */
  warm: boolean;
}): CrisisSkipGateResult {
  if (args.warm) {
    return { ok: false, error: "not_cold" };
  }
  if (args.experience === "beginner") {
    return { ok: false, error: "beginner_no_skip" };
  }
  return { ok: true, requiresAck: true };
}

/** Cancel ordered → idle while staying selling. */
export function planCancelReorderOrdered(args: {
  primaryState: string;
  reorderStatus: "idle" | "ordered";
}):
  | { ok: true; nextStatus: "idle" }
  | { ok: false; error: "not_selling" | "not_ordered" } {
  if (args.primaryState !== "selling") {
    return { ok: false, error: "not_selling" };
  }
  if (args.reorderStatus !== "ordered") {
    return { ok: false, error: "not_ordered" };
  }
  return { ok: true, nextStatus: "idle" };
}

/**
 * Whether a supplier may be used for next-batch ordered (same path or switch).
 * Warm / path: needs approved sample. Cold crisis skip: needs skip id recorded.
 */
export function canReorderWithSupplier(args: {
  supplierId: string;
  approvedSampleSupplierIds: ReadonlySet<string>;
  crisisSkipSupplierIds: ReadonlySet<string>;
  unavailable: UnavailableSuppliersMap;
}): boolean {
  if (args.unavailable[args.supplierId]) return false;
  if (args.approvedSampleSupplierIds.has(args.supplierId)) return true;
  if (args.crisisSkipSupplierIds.has(args.supplierId)) return true;
  return false;
}

export function markSupplierUnavailable(
  map: UnavailableSuppliersMap,
  supplierId: string,
  reason: CantFulfillReason | string,
  at: string,
): UnavailableSuppliersMap {
  return {
    ...map,
    [supplierId]: { reason, at },
  };
}

/** Bridge coaching flags while cold-sampling after can’t-fulfill. */
export function bridgeCoachingForSource(source: SupplierSource | "both"): {
  holdAds: boolean;
  stretchStock: boolean;
  localBridge: boolean;
} {
  return {
    holdAds: true,
    stretchStock: true,
    localBridge: source === "local" || source === "both",
  };
}
