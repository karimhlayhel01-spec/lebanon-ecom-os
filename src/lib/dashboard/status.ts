import { and, eq, inArray } from "drizzle-orm";
import { db, ensureMigrated, schema } from "@/db";
import type { MarketingStage } from "@/lib/constants";
import {
  resolveDefaultFocusStage,
  resolveUnlockedStages,
} from "@/lib/marketing/focus";
import { getSupplierPanel } from "@/lib/supplier/service";
import { skuToolHref } from "@/lib/sku/tools";
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
  /** Deep link — Wave 1 hub uses `/sku/[id]#supplier`. */
  href: string;
};

export type MarketingStatusRow = {
  stage: MarketingStage;
  /** Deep link — Wave 1 hub uses `/sku/[id]#marketing`. */
  href: string;
};

export type DashboardStatusView = {
  skuId: string;
  skuName: string;
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
  /** Override Open href (defaults to `/supplier` when omitted). */
  href?: string;
};

/**
 * Pure mapper: side/sample flags → supplier Status row.
 * No coaching, CTAs, money, or invented ETA.
 */
export function mapSupplierStatusRow(
  input: MapSupplierStatusInput,
): SupplierStatusRow {
  const href = input.href ?? "/supplier";
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
  /** Override Open href (defaults to `/marketing` when omitted). */
  href?: string;
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
    input.href ??
    (stage === "none" ? "/marketing" : `/marketing?stage=${stage}`);
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
 * Compact hub Status read model for one SKU — supplier facts + marketing focus.
 * Uses that SKU’s journey flags + supplier panel (no workspace bleed).
 */
export async function getDashboardStatus(args: {
  workspaceId: string;
  skuId: string;
  skuName: string;
  locale: AppLocale;
  /** Effective journey state (paused → pausedFromState). */
  primaryState: string;
  productAccepted: boolean;
  sampleStatus: string;
  batchOrdered: boolean;
  batchArrivedReady: boolean;
  /** Per-SKU marketing stage from sku_journeys (not shop side_statuses). */
  sideMarketingStage: string;
}): Promise<DashboardStatusView> {
  ensureMigrated();

  const panel = args.productAccepted
    ? await getSupplierPanel(args.workspaceId, args.skuId)
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

  const supplierHref = skuToolHref(args.skuId, "supplier");
  const marketingHref = skuToolHref(args.skuId, "marketing");

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
    href: supplierHref,
  });

  const hasLaunchKit = await workspaceHasLaunchKit(
    args.workspaceId,
    args.skuId,
  );

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
    href: marketingHref,
  });

  return {
    skuId: args.skuId,
    skuName: args.skuName,
    supplier,
    marketing,
  };
}
