import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { SupplierContactsEditor } from "@/components/supplier/SupplierContactsEditor";
import { SupplierDisplayNameEditor } from "@/components/supplier/SupplierDisplayNameEditor";
import type {
  DashboardStatusView,
  MarketingStatusRow,
  SupplierStatusRow,
} from "@/lib/dashboard/status";

type TFn = Awaited<ReturnType<typeof getTranslations>>;

/**
 * Hub Status: supplier facts + Open. Stacked separately from Marketing.
 * Facts only — no coaching, hero CTAs, store %, or money.
 */
export async function SupplierStatusBlock({
  view,
}: {
  view: DashboardStatusView;
}) {
  const t = await getTranslations("Dashboard.status");
  const supplierTitle = view.supplier.supplierName
    ? view.supplier.supplierName
    : titleForSupplierKind(view.supplier.kind, t);
  const supplierHint = hintForSupplier(view.supplier, t);
  const canRename =
    !!view.supplier.supplierName && !!view.supplier.supplierId;

  return (
    <div className="surface-card p-5">
      <StatusBlockHeader
        label={t("supplierLabel")}
        skuName={view.skuName}
        forSku={t("forSku", { name: view.skuName })}
      />
      <div className="mt-4">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            {canRename ? (
              <SupplierDisplayNameEditor
                supplierId={view.supplier.supplierId!}
                skuId={view.skuId}
                name={view.supplier.supplierName!}
                nameClassName="text-sm font-semibold text-ink"
              />
            ) : (
              <p
                className="truncate text-sm font-semibold text-ink"
                dir={view.supplier.supplierName ? "auto" : undefined}
                title={supplierTitle}
              >
                {supplierTitle}
              </p>
            )}
            <p className="mt-0.5 text-xs leading-relaxed text-stone-dark">
              {supplierHint}
            </p>
            {canRename ? (
              <SupplierContactsEditor
                supplierId={view.supplier.supplierId!}
                skuId={view.skuId}
                contactEmail={view.supplier.contactEmail}
                contactWhatsapp={view.supplier.contactWhatsapp}
                compact
              />
            ) : null}
          </div>
          <Link
            href={view.supplier.href}
            className="mt-0.5 shrink-0 text-xs font-medium text-sea underline-offset-2 hover:underline"
          >
            {t("open")}
          </Link>
        </div>
      </div>
    </div>
  );
}

/**
 * Hub Status: marketing focus + Open. Stacked after Supplier, before Journey.
 */
export async function MarketingStatusBlock({
  view,
}: {
  view: DashboardStatusView;
}) {
  const t = await getTranslations("Dashboard.status");

  return (
    <div className="surface-card p-5">
      <StatusBlockHeader
        label={t("marketingLabel")}
        skuName={view.skuName}
        forSku={t("forSku", { name: view.skuName })}
      />
      <div className="mt-4">
        <StatusFacts
          title={titleForMarketing(view.marketing, t)}
          hint={hintForMarketing(view.marketing, t)}
          href={view.marketing.href}
          openLabel={t("open")}
        />
      </div>
    </div>
  );
}

/** @deprecated Prefer SupplierStatusBlock + MarketingStatusBlock stacked. */
export async function StatusCard({ view }: { view: DashboardStatusView }) {
  return (
    <>
      <SupplierStatusBlock view={view} />
      <MarketingStatusBlock view={view} />
    </>
  );
}

function StatusBlockHeader({
  label,
  skuName,
  forSku,
}: {
  label: string;
  skuName?: string | null;
  forSku: string;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="font-display text-base text-ink">{label}</h2>
      {skuName ? (
        <p
          className="truncate text-xs font-medium text-stone-dark"
          dir="auto"
          title={skuName}
        >
          {forSku}
        </p>
      ) : null}
    </div>
  );
}

function StatusFacts({
  title,
  titleDirAuto,
  hint,
  href,
  openLabel,
}: {
  title: string;
  titleDirAuto?: boolean;
  hint: string;
  href: string;
  openLabel: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <p
          className="truncate text-sm font-semibold text-ink"
          dir={titleDirAuto ? "auto" : undefined}
          title={title}
        >
          {title}
        </p>
        <p className="mt-0.5 text-xs leading-relaxed text-stone-dark">{hint}</p>
      </div>
      <Link
        href={href}
        className="mt-0.5 shrink-0 text-xs font-medium text-sea underline-offset-2 hover:underline"
      >
        {openLabel}
      </Link>
    </div>
  );
}

function titleForSupplierKind(
  kind: SupplierStatusRow["kind"],
  t: TFn,
): string {
  switch (kind) {
    case "no_product":
      return t("supplier.noProductTitle");
    case "no_sample":
      return t("supplier.noSampleTitle");
    case "sample_rejected":
      return t("supplier.rejectedTitle");
    case "sample_in_flight":
      return t("supplier.inFlightTitle");
    case "sample_received":
      return t("supplier.receivedTitle");
    case "sample_approved":
      return t("supplier.approvedTitle");
    case "batch_ordered":
      return t("supplier.batchOrderedTitle");
    case "batch_arrived":
      return t("supplier.batchArrivedTitle");
  }
}

function hintForSupplier(row: SupplierStatusRow, t: TFn): string {
  switch (row.kind) {
    case "no_product":
      return t("supplier.noProductHint");
    case "no_sample":
      return t("supplier.noSampleHint");
    case "sample_rejected":
      return t("supplier.rejectedHint");
    case "sample_in_flight":
      return t("supplier.inFlightHint");
    case "sample_received":
      return t("supplier.receivedHint");
    case "sample_approved":
      return t("supplier.approvedHint");
    case "batch_ordered":
      return row.etaSummary
        ? t("supplier.batchOrderedHintEta", { eta: row.etaSummary })
        : t("supplier.batchOrderedHint");
    case "batch_arrived":
      return t("supplier.batchArrivedHint");
  }
}

function titleForMarketing(row: MarketingStatusRow, t: TFn): string {
  switch (row.stage) {
    case "intro_pdf":
      return t("marketing.introTitle");
    case "pre_launch":
      return t("marketing.preLaunchTitle");
    case "launch":
      return t("marketing.launchTitle");
    case "monthly_refresh":
      return t("marketing.refreshTitle");
    case "none":
    default:
      return t("marketing.noneTitle");
  }
}

function hintForMarketing(row: MarketingStatusRow, t: TFn): string {
  switch (row.stage) {
    case "intro_pdf":
      return t("marketing.introHint");
    case "pre_launch":
      return t("marketing.preLaunchHint");
    case "launch":
      return t("marketing.launchHint");
    case "monthly_refresh":
      return t("marketing.refreshHint");
    case "none":
    default:
      return t("marketing.noneHint");
  }
}
