"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import type { UnitsLeftGlance } from "@/lib/finance/sku-runway";

/**
 * Read-only units-left from inventory ledger (received − sold).
 * Never shows fake 0 when unknown.
 * Unknown = units received not known yet (not “log a Topic A week”).
 */
export function UnitsLeftGlanceBlock({
  glance,
  compact = false,
  /**
   * Optional link when left is unknown — typically Supplier / mark batch
   * arrived. Do not point at Finance Topic A (received is the gap).
   */
  inventoryHref,
}: {
  glance: UnitsLeftGlance;
  compact?: boolean;
  inventoryHref?: string;
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
        {inventoryHref ? (
          <Link
            href={inventoryHref}
            className="mt-1 inline-block font-medium text-sea underline-offset-2 hover:underline"
          >
            {t("unitsLeftMarkArrived")}
          </Link>
        ) : (
          <p className="mt-1 text-[11px] leading-snug text-stone-dark/90">
            {t("unitsLeftUnknownHint")}
          </p>
        )}
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
