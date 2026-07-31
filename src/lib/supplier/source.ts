/**
 * Wave 2 — Import | Local | Both sourcing on the same sample→batch path.
 */

export const SUPPLIER_SOURCES = ["import", "local"] as const;
export type SupplierSource = (typeof SUPPLIER_SOURCES)[number];

export const SUPPLIER_TAB_FILTERS = ["both", "import", "local"] as const;
export type SupplierTabFilter = (typeof SUPPLIER_TAB_FILTERS)[number];

export const DEFAULT_SUPPLIER_TAB: SupplierTabFilter = "both";

export function isSupplierSource(value: unknown): value is SupplierSource {
  return value === "import" || value === "local";
}

export function normalizeSupplierSource(
  value: string | null | undefined,
): SupplierSource {
  return value === "local" ? "local" : "import";
}

/**
 * Interactive first-pick shortlist (and source tabs) stay visible until a
 * sample is in flight (requested|received), a sample is approved, or batch
 * has started. After approve, founders browse via “View full shortlist” and
 * request insurance backups via the warm-backup control — not this gate.
 *
 * `hasActiveSample` must mean **in-flight only** (not approved).
 */
export function canShowSupplierShortlist(args: {
  hasActiveSample: boolean;
  sampleApproved: boolean;
  batchOrdered: boolean;
}): boolean {
  return (
    !args.hasActiveSample && !args.sampleApproved && !args.batchOrdered
  );
}

/** Source tabs freeze while the interactive shortlist is hidden. */
export function isSourceTabFrozen(args: {
  hasActiveSample: boolean;
  sampleApproved: boolean;
  batchOrdered: boolean;
}): boolean {
  return !canShowSupplierShortlist(args);
}

export function filterGroupsByTab<T extends { source: SupplierSource }>(
  groups: T[],
  tab: SupplierTabFilter,
): T[] {
  if (tab === "both") return groups;
  return groups.filter((g) => g.source === tab);
}

/**
 * Group supplier rows by source + rank (fixes flat 0/1/2 grouping when 18 rows).
 * Order: import ranks 0–2, then local ranks 0–2.
 */
export function groupSuppliersBySourceAndRank<
  T extends { source: SupplierSource; rank: number; role: string },
>(
  views: T[],
): Array<{
  source: SupplierSource;
  rank: number;
  primary: T | null;
  backups: T[];
}> {
  const groups: Array<{
    source: SupplierSource;
    rank: number;
    primary: T | null;
    backups: T[];
  }> = [];

  for (const source of SUPPLIER_SOURCES) {
    for (const rank of [0, 1, 2]) {
      const inGroup = views.filter(
        (v) => v.source === source && v.rank === rank,
      );
      if (inGroup.length === 0) continue;
      groups.push({
        source,
        rank,
        primary: inGroup.find((v) => v.role === "primary") ?? null,
        backups: inGroup.filter((v) => v.role === "backup"),
      });
    }
  }

  return groups;
}

/** What to generate when ensuring suppliers for a SKU. */
export function supplierGenerationPlan(existingSources: SupplierSource[]): {
  generateImport: boolean;
  generateLocal: boolean;
} {
  const hasImport = existingSources.includes("import");
  const hasLocal = existingSources.includes("local");
  if (existingSources.length === 0) {
    return { generateImport: true, generateLocal: true };
  }
  return {
    generateImport: !hasImport,
    generateLocal: !hasLocal,
  };
}
