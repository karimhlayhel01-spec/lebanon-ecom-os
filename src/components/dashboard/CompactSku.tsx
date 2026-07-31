import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { MarginLegend } from "@/components/margins/MarginLegend";
import { MARGIN_BEFORE_ADS_MIN } from "@/lib/constants";
import type { SkuCardView } from "@/lib/sku/service";
import type { CurrentActualView } from "@/lib/finance/service";

/**
 * TODO(wave1): unused after hub Status/Journey rewire — keep for possible
 * compact SKU mirror; hub uses Supplier/Marketing status blocks + JourneyStrip
 * via ShopHub children.
 *
 * Compact SKU summary for the hub. The full card lives on /sku. `quiet` renders
 * a smaller, secondary version for the cockpit stages where the hero leads.
 */
export async function CompactSku({
  sku,
  actual = null,
  quiet = false,
}: {
  sku: SkuCardView;
  actual?: CurrentActualView | null;
  quiet?: boolean;
}) {
  const t = await getTranslations("Dashboard");
  const skuT = await getTranslations("Sku");
  const ind = await getTranslations("Onboarding");

  return (
    <div className={`surface-card ${quiet ? "p-4" : "p-5"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-stone-dark">
            {skuT("kicker")}
          </p>
          <h2
            className={`mt-0.5 font-display text-ink ${quiet ? "text-base" : "text-lg"}`}
          >
            {sku.name}
          </h2>
          <p className="mt-0.5 text-xs text-stone-dark">
            {ind(`industries.${sku.basics.category}` as never)}
          </p>
        </div>
        <Link
          href="/sku"
          className="whitespace-nowrap text-sm font-medium text-sea underline-offset-2 hover:underline"
        >
          {t("openSku")} →
        </Link>
      </div>
      <dl
        className={`mt-3 grid gap-x-6 gap-y-2 text-sm ${quiet ? "grid-cols-2 sm:grid-cols-4" : "sm:grid-cols-2"}`}
      >
        <StatRow label={skuT("sellPrice")}>${sku.basics.sellPrice}</StatRow>
        <StatRow label={skuT("landedCost")}>${sku.basics.landedCost}</StatRow>
        <StatRow label={skuT("marginBefore")}>
          <span className="font-semibold text-cedar-deep">
            {Math.round(sku.moneySnapshot.marginBefore * 100)}%
          </span>
          <span className="ms-1 text-[10px] font-normal text-stone-dark">
            ({skuT("planningLabel")})
          </span>
        </StatRow>
        {sku.quotedCosts && (
          <StatRow label={skuT("expectedMarginBefore")}>
            <span
              className={`font-semibold ${
                sku.quotedCosts.expectedMarginBefore < MARGIN_BEFORE_ADS_MIN
                  ? "text-amber-800"
                  : "text-cedar-deep"
              }`}
            >
              {Math.round(sku.quotedCosts.expectedMarginBefore * 100)}%
            </span>
            <span className="ms-1 text-[10px] font-normal text-stone-dark">
              ({skuT("quotedLabel")})
            </span>
          </StatRow>
        )}
        <StatRow label={skuT("marginAfter")}>
          <span className="font-semibold text-cedar-deep">
            {Math.round(sku.moneySnapshot.marginAfter * 100)}%
          </span>
          <span className="ms-1 text-[10px] font-normal text-stone-dark">
            ({skuT("planningLabel")})
          </span>
        </StatRow>
        {actual?.after != null && (
          <StatRow label={skuT("actualMarginAfter")}>
            <span
              className={`font-semibold ${
                actual.belowAfter ? "text-amber-800" : "text-cedar-deep"
              }`}
            >
              {(actual.after * 100).toFixed(1)}%
            </span>
            <span className="ms-1 text-[10px] font-normal text-stone-dark">
              ({skuT("actualLabel")})
            </span>
          </StatRow>
        )}
      </dl>
      <MarginLegend compact />
      <p className="mt-3 text-[11px] leading-relaxed text-stone-dark">
        {skuT("estimateShort")}{" "}
        <Link
          href="/sku"
          className="font-medium text-sea underline-offset-2 hover:underline"
        >
          {skuT("estimateLearnMore")}
        </Link>
      </p>
    </div>
  );
}

function StatRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-stone-dark">{label}</dt>
      <dd className="font-medium text-ink">{children}</dd>
    </div>
  );
}
