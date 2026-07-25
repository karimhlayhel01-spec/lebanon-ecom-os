import { and, eq, inArray } from "drizzle-orm";
import { db, ensureMigrated, schema } from "@/db";
import type { MarketingStage } from "@/lib/constants";
import {
  resolveDefaultFocusStage,
  resolveUnlockedStages,
} from "@/lib/marketing/focus";
import { getSupplierPanel } from "@/lib/supplier/service";
import type { AppLocale } from "@/i18n/routing";

/** Supplier status kinds for the dashboard Status card. */
export type SupplierStatusKind =
  | "no_product"
  | "no_sample"
  | "sample_in_flight"
  | "sample_received"
  | "sample_rejected"
  | "sample_approved"
  | "batch_ordered"
  | "batch_arrived";

export type SupplierStatusRow = {
  kind: SupplierStatusKind;
  /** Only when a sample is tied to a specific supplier. */
  supplierName: string | null;
  /** Founder-set ETA summary for the active locale; null when omitted. */
  etaSummary: string | null;
  href: "/supplier";
};

export type MarketingStatusRow = {
  stage: MarketingStage;
  href: string;
};

export type DashboardStatusView = {
  supplier: SupplierStatusRow;
  marketing: MarketingStatusRow;
};

export type MapSupplierStatusInput = {
  productAccepted: boolean;
  sampleStatus: string;
  /** Active sample record status (requested | received | approved), if any. */
  activeSampleStatus: string | null;
  supplierName: string | null;
  batchOrdered: boolean;
  batchArrivedReady: boolean;
  etaFounderSet: boolean;
  etaSummaryEn: string;
  etaSummaryAr: string;
  locale: AppLocale;
};

/**
 * Pure mapper: side/sample flags → supplier Status row.
 * No coaching, CTAs, money, or invented ETA.
 */
export function mapSupplierStatusRow(
  input: MapSupplierStatusInput,
): SupplierStatusRow {
  const href = "/supplier" as const;
  const name = input.supplierName?.trim() || null;

  if (!input.productAccepted) {
    return { kind: "no_product", supplierName: null, etaSummary: null, href };
  }

  if (input.sampleStatus === "rejected") {
    return {
      kind: "sample_rejected",
      supplierName: null,
      etaSummary: null,
      href,
    };
  }

  if (input.batchArrivedReady) {
    return {
      kind: "batch_arrived",
      supplierName: name,
      etaSummary: null,
      href,
    };
  }

  if (input.batchOrdered || input.sampleStatus === "approved") {
    if (input.batchOrdered) {
      const etaSummary =
        input.etaFounderSet
          ? input.locale === "ar"
            ? input.etaSummaryAr
            : input.etaSummaryEn
          : null;
      return {
        kind: "batch_ordered",
        supplierName: name,
        etaSummary,
        href,
      };
    }
    return {
      kind: "sample_approved",
      supplierName: name,
      etaSummary: null,
      href,
    };
  }

  if (
    input.activeSampleStatus === "received" ||
    (input.sampleStatus === "in_flight" &&
      input.activeSampleStatus === "received")
  ) {
    return {
      kind: "sample_received",
      supplierName: name,
      etaSummary: null,
      href,
    };
  }

  if (
    input.activeSampleStatus === "requested" ||
    input.sampleStatus === "in_flight"
  ) {
    return {
      kind: "sample_in_flight",
      supplierName: name,
      etaSummary: null,
      href,
    };
  }

  // sampleStatus "none" after replace, or product accepted with no sample yet.
  return { kind: "no_sample", supplierName: null, etaSummary: null, href };
}

export type MapMarketingStatusInput = {
  primaryState: string;
  sampleApproved: boolean;
  batchOrdered: boolean;
  batchArrivedReady: boolean;
  hasLaunchKit: boolean;
  sideStage: MarketingStage;
};

/** Pure mapper: journey flags → marketing Status focus stage. */
export function mapMarketingStatusRow(
  input: MapMarketingStatusInput,
): MarketingStatusRow {
  const stages = resolveUnlockedStages({
    sampleApproved: input.sampleApproved,
    batchOrdered: input.batchOrdered,
    batchArrivedReady: input.batchArrivedReady,
    hasLaunchKit: input.hasLaunchKit,
  });
  const stage = resolveDefaultFocusStage({
    primaryState: input.primaryState,
    sampleApproved: input.sampleApproved,
    batchOrdered: input.batchOrdered,
    batchArrivedReady: input.batchArrivedReady,
    stages,
    sideStage: input.sideStage,
  });
  const href =
    stage === "none" ? "/marketing" : `/marketing?stage=${stage}`;
  return { stage, href };
}

async function workspaceHasLaunchKit(
  workspaceId: string,
  skuId: string,
): Promise<boolean> {
  const row = await db
    .select({ id: schema.marketingKits.id })
    .from(schema.marketingKits)
    .where(
      and(
        eq(schema.marketingKits.workspaceId, workspaceId),
        eq(schema.marketingKits.skuId, skuId),
        inArray(schema.marketingKits.stage, ["launch", "monthly_refresh"]),
      ),
    )
    .get();
  return Boolean(row);
}

/**
 * Compact dashboard Status read model — supplier facts + marketing focus.
 */
export async function getDashboardStatus(args: {
  workspaceId: string;
  locale: AppLocale;
  /** Effective journey state (paused → pausedFromState). */
  primaryState: string;
  productAccepted: boolean;
  sampleStatus: string;
  batchOrdered: boolean;
  batchArrivedReady: boolean;
  sideMarketingStage: string;
}): Promise<DashboardStatusView> {
  ensureMigrated();

  const panel = args.productAccepted
    ? await getSupplierPanel(args.workspaceId)
    : null;

  const sampleApproved =
    args.sampleStatus === "approved" ||
    [
      "sample_approved",
      "store_setup",
      "batch_ordered",
      "batch_arrived_ready",
      "selling",
    ].includes(args.primaryState);

  const batchOrdered =
    args.batchOrdered ||
    ["batch_ordered", "batch_arrived_ready", "selling"].includes(
      args.primaryState,
    );
  const batchArrivedReady =
    args.batchArrivedReady ||
    ["batch_arrived_ready", "selling"].includes(args.primaryState);

  let supplierName: string | null = null;
  let activeSampleStatus: string | null = null;
  if (panel?.sample) {
    activeSampleStatus = panel.sample.status;
    supplierName = panel.sample.supplierName || null;
  } else if (panel?.approvedSampleSupplierName) {
    supplierName = panel.approvedSampleSupplierName;
  }

  const eta = panel?.batchArrivalEta;
  const supplier = mapSupplierStatusRow({
    productAccepted: args.productAccepted,
    sampleStatus: args.sampleStatus,
    activeSampleStatus,
    supplierName,
    batchOrdered,
    batchArrivedReady,
    etaFounderSet: eta?.founderSet ?? false,
    etaSummaryEn: eta?.summaryEn ?? "",
    etaSummaryAr: eta?.summaryAr ?? "",
    locale: args.locale,
  });

  const hasLaunchKit =
    panel?.skuId != null
      ? await workspaceHasLaunchKit(args.workspaceId, panel.skuId)
      : false;

  const sideStage = (
    ["none", "intro_pdf", "pre_launch", "launch", "monthly_refresh"].includes(
      args.sideMarketingStage,
    )
      ? args.sideMarketingStage
      : "none"
  ) as MarketingStage;

  const marketing = mapMarketingStatusRow({
    primaryState: args.primaryState,
    sampleApproved,
    batchOrdered,
    batchArrivedReady,
    hasLaunchKit,
    sideStage,
  });

  return { supplier, marketing };
}
