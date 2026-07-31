/**
 * Sample in-flight vs approved — insurance sampling may run after approve.
 * In-flight = requested | received only. Approved is NOT in flight.
 *
 * Primary (before path approve): one sample in flight globally.
 * Spares (Mode B, after path approve): up to MAX_SPARE_SAMPLES_IN_FLIGHT
 * parallel in-flight samples (same checklist/decide as primary).
 */

export const SAMPLE_IN_FLIGHT_STATUSES = ["requested", "received"] as const;

export type SampleInFlightStatus = (typeof SAMPLE_IN_FLIGHT_STATUSES)[number];

/** Max spare samples in requested|received at once per skuId (after path approve). */
export const MAX_SPARE_SAMPLES_IN_FLIGHT = 3;

export function isSampleInFlight(status: string): boolean {
  return status === "requested" || status === "received";
}

/** All in-flight rows in given order (caller usually oldest→newest). */
export function listInFlightSamples<T extends { status: string }>(
  rows: readonly T[],
): T[] {
  return rows.filter((r) => isSampleInFlight(r.status));
}

/** Latest chronologically (rows oldest→newest) that is still in flight. */
export function findInFlightSample<T extends { status: string }>(
  rows: readonly T[],
): T | undefined {
  return [...rows].reverse().find((r) => isSampleInFlight(r.status));
}

export function hasSampleInFlight(
  rows: readonly { status: string }[],
): boolean {
  return rows.some((r) => isSampleInFlight(r.status));
}

/**
 * In-flight samples that are not the working/path supplier (spares).
 * Before path is known, every in-flight row counts as a spare slot.
 */
export function listInFlightSpareSamples<
  T extends { status: string; supplierId: string },
>(rows: readonly T[], pathSupplierId: string | null): T[] {
  return rows.filter(
    (r) =>
      isSampleInFlight(r.status) &&
      (pathSupplierId == null || r.supplierId !== pathSupplierId),
  );
}

export function countInFlightSpareSamples(
  rows: readonly { status: string; supplierId: string }[],
  pathSupplierId: string | null,
): number {
  return listInFlightSpareSamples(rows, pathSupplierId).length;
}

export type SampleFlightGateResult = "ok" | "sample_in_flight" | "spare_cap";

/**
 * Flight-slot gate for requestSample (before source/warm/path eligibility).
 * - Before path approve: at most one sample in flight (any supplier).
 * - After path approve: up to MAX_SPARE_SAMPLES_IN_FLIGHT spare slots;
 *   never a second in-flight for the same supplier.
 */
export function sampleFlightGate(args: {
  sampleApproved: boolean;
  sampleRows: readonly { status: string; supplierId: string }[];
  pathSupplierId: string | null;
  targetSupplierId: string;
}): SampleFlightGateResult {
  const { sampleApproved, sampleRows, pathSupplierId, targetSupplierId } =
    args;

  if (
    sampleRows.some(
      (r) =>
        r.supplierId === targetSupplierId && isSampleInFlight(r.status),
    )
  ) {
    return "sample_in_flight";
  }

  if (!sampleApproved) {
    return hasSampleInFlight(sampleRows) ? "sample_in_flight" : "ok";
  }

  if (
    countInFlightSpareSamples(sampleRows, pathSupplierId) >=
    MAX_SPARE_SAMPLES_IN_FLIGHT
  ) {
    return "spare_cap";
  }
  return "ok";
}

/**
 * Journey sampleStatus / sampleApproved must stay stable once the path sample
 * is approved — spare request/reject must not rewrite it to in_flight/rejected.
 */
export function shouldPatchJourneySampleStatus(sampleApproved: boolean): boolean {
  return !sampleApproved;
}

/**
 * Working / first-path approved sample (oldest approved).
 * Insurance approvals of backups must not steal this fallback.
 */
export function findFirstApprovedSample<T extends { status: string }>(
  rows: readonly T[],
): T | undefined {
  return rows.find((r) => r.status === "approved");
}

/**
 * Working/path supplier id — same order as Supplier panel path display:
 * reorderPathSupplierId → reorderSupplierId → first approved sample.
 */
export function resolveWorkingPathSupplierId(args: {
  reorderPathSupplierId?: string | null;
  reorderSupplierId?: string | null;
  firstApprovedSupplierId?: string | null;
}): string | null {
  return (
    args.reorderPathSupplierId ??
    args.reorderSupplierId ??
    args.firstApprovedSupplierId ??
    null
  );
}

/** Soft coach may highlight; insurance UI stays available after first approve. */
export function canShowBackupInsurance(args: {
  sampleApproved: boolean;
  primaryState: string;
}): boolean {
  if (!args.sampleApproved) return false;
  return (
    args.primaryState === "selling" ||
    args.primaryState === "sample_approved" ||
    args.primaryState === "store_setup" ||
    args.primaryState === "batch_ordered" ||
    args.primaryState === "batch_arrived_ready"
  );
}

// ---------------------------------------------------------------------------
// Supplier card sample CTAs — Mode A (first pick) vs Mode B (insurance spare)
// ---------------------------------------------------------------------------

export type SupplierCardSampleMode = "first_sample" | "insurance";

export type SupplierCardSampleCta =
  | { kind: "none" }
  | { kind: "request_sample" }
  | { kind: "request_backup_sample" };

/**
 * Mode A: interactive first-pick shortlist / before first approve.
 * Mode B: path locked (sample approved) — insurance spares on cards only.
 */
export function resolveSupplierCardSampleMode(args: {
  sampleApproved: boolean;
  showShortlist: boolean;
}): SupplierCardSampleMode {
  if (args.showShortlist || !args.sampleApproved) return "first_sample";
  return "insurance";
}

/**
 * Which sample CTA (if any) a supplier card may show.
 * Never returns both kinds.
 * Mode A: any in-flight blanks all cards (primary single-flight).
 * Mode B: blank only this supplier if in-flight or warm; blank all when spare cap hit.
 */
export function supplierCardSampleCta(args: {
  mode: SupplierCardSampleMode;
  /** Mode A: any sample in flight blanks every card. Ignored in Mode B. */
  sampleInFlight: boolean;
  /** This supplier already has requested|received (Mode B per-card blank). */
  supplierSampleInFlight?: boolean;
  /** Mode B: already at MAX_SPARE_SAMPLES_IN_FLIGHT — no more spare CTAs. */
  spareCapReached?: boolean;
  supplierId: string;
  /** Ranking label only — not used to gate Mode B spares. */
  role?: string;
  pathSupplierId: string | null;
  sameSourceAsPath: boolean;
  /** Already has an approved sample for this SKU. */
  alreadyWarm?: boolean;
  unavailable?: boolean;
}): SupplierCardSampleCta {
  if (args.mode === "first_sample") {
    if (args.sampleInFlight) return { kind: "none" };
    return { kind: "request_sample" };
  }

  // Mode B — spare sample on any eligible same-source non-working card.
  if (args.pathSupplierId && args.supplierId === args.pathSupplierId) {
    return { kind: "none" };
  }
  if (!args.sameSourceAsPath) return { kind: "none" };
  if (args.unavailable) return { kind: "none" };
  if (args.alreadyWarm) return { kind: "none" };
  if (args.supplierSampleInFlight) return { kind: "none" };
  if (args.spareCapReached) return { kind: "none" };
  return { kind: "request_backup_sample" };
}

/** Yellow can’t-fulfill pick list: warmed spares only (default). */
export function listWarmSparesForSwitch<T extends { warm: boolean }>(
  backups: readonly T[],
): T[] {
  return backups.filter((b) => b.warm);
}
