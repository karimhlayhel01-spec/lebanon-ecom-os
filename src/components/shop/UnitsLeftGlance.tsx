"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import type { UnitsLeftGlance } from "@/lib/finance/sku-runway";

/**
 * Read-only units-left from Topic A runway helper.
 * Never shows fake 0 when unknown.
 */
export function UnitsLeftGlanceBlock({
  glance,
  compact = false,
  financeHref = "/finance",
}: {
  glance: UnitsLeftGlance;
  compact?: boolean;
  financeHref?: string;
}) {
  const t = useTranslations("Shop");

  if (glance.kind === "unknown") {
    return (
      <div
        className={
          compact
            ? "text-[11px] text-stone-dark"
            : "mt-2 rounded-md border border-stone/60 bg-surface-subtle px-3 py-2 text-xs text-stone-dark"
        }
      >
        <p>{t("unitsLeftUnknown")}</p>
        <Link
          href={financeHref}
          className="mt-1 inline-block font-medium text-sea underline-offset-2 hover:underline"
        >
          {t("unitsLeftLogWeek")}
        </Link>
      </div>
    );
  }

  return (
    <div
      className={
        compact
          ? "text-[11px] text-stone-dark"
          : "mt-2 rounded-md border border-sea/25 bg-sea/5 px-3 py-2 text-xs text-ink"
      }
    >
      <p className="font-semibold">
        {t("unitsLeftLabel", { n: glance.unitsLeft })}
      </p>
      <p className="mt-0.5 text-stone-dark">{t("unitsLeftSub")}</p>
      {glance.weeks != null && (
        <p className="mt-0.5 text-stone-dark">
          {t("unitsLeftWeeks", {
            weeks: Math.max(0.1, Math.round(glance.weeks * 10) / 10),
          })}
        </p>
      )}
    </div>
  );
}
