import { useTranslations } from "next-intl";

/**
 * Shared 3-layer margin legend: Planning (Discovery estimate) → Expected
 * (founder cost quotes) → Actual (weekly Topic A). Labels only — it explains
 * the numbers already shown on SKU / Finance / dashboard surfaces so the three
 * layers don't look contradictory. No calculations here.
 *
 * Universal component (no "use client"): renders in both server components
 * (CompactSku) and client components (SkuCard, FinancePanel).
 */
export function MarginLegend({ compact = false }: { compact?: boolean }) {
  const t = useTranslations("Margins");

  if (compact) {
    return (
      <p className="mt-3 rounded-md border border-stone bg-surface-subtle px-3 py-2 text-[11px] leading-relaxed text-stone-dark">
        {t("legendCompact")}
      </p>
    );
  }

  return (
    <div className="mt-3 rounded-md border border-stone bg-surface-subtle px-3 py-2 text-[11px] leading-relaxed text-stone-dark">
      <p className="font-medium text-ink">{t("legendTitle")}</p>
      <ul className="mt-1 space-y-0.5">
        <li>
          <span className="font-medium text-ink">{t("planningTag")}</span> —{" "}
          {t("planningDesc")}
        </li>
        <li>
          <span className="font-medium text-ink">{t("expectedTag")}</span> —{" "}
          {t("expectedDesc")}
        </li>
        <li>
          <span className="font-medium text-ink">{t("actualTag")}</span> —{" "}
          {t("actualDesc")}
        </li>
      </ul>
    </div>
  );
}
