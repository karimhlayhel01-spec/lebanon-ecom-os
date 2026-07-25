import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type {
  DashboardStatusView,
  MarketingStatusRow,
  SupplierStatusRow,
} from "@/lib/dashboard/status";

/**
 * Compact right-rail Status card: supplier facts + marketing phase focus.
 * Facts only — no coaching, hero CTAs, store %, or money.
 */
export async function StatusCard({ view }: { view: DashboardStatusView }) {
  const t = await getTranslations("Dashboard.status");

  const supplierTitle = view.supplier.supplierName
    ? view.supplier.supplierName
    : titleForSupplierKind(view.supplier.kind, t);
  const supplierHint = hintForSupplier(view.supplier, t);

  return (
    <div className="surface-card p-5">
      <h2 className="font-display text-base text-ink">{t("title")}</h2>
      <div className="mt-4">
        <StatusRow
          label={t("supplierLabel")}
          title={supplierTitle}
          titleDirAuto={Boolean(view.supplier.supplierName)}
          hint={supplierHint}
          href={view.supplier.href}
          openLabel={t("open")}
        />
        <div className="my-3 border-t border-stone" role="separator" />
        <StatusRow
          label={t("marketingLabel")}
          title={titleForMarketing(view.marketing, t)}
          hint={hintForMarketing(view.marketing, t)}
          href={view.marketing.href}
          openLabel={t("open")}
        />
      </div>
    </div>
  );
}

function StatusRow({
  label,
  title,
  titleDirAuto,
  hint,
  href,
  openLabel,
}: {
  label: string;
  title: string;
  titleDirAuto?: boolean;
  hint: string;
  href: string;
  openLabel: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-dark">
          {label}
        </p>
        <p
          className="mt-0.5 truncate text-sm font-semibold text-ink"
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

type TFn = Awaited<ReturnType<typeof getTranslations>>;

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
