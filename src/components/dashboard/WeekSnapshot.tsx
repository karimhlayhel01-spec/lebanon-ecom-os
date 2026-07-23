import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { FinancePanelView } from "@/lib/finance/service";

/**
 * This-week snapshot for the selling stage: 3–4 headline numbers pulled from the
 * latest Topic A entry (honest zeros when no week is logged yet), plus a link
 * into the full finance page and an optional invest-next nudge.
 */
export async function WeekSnapshot({ view }: { view: FinancePanelView }) {
  const t = await getTranslations("Dashboard");
  const latest = view.entries[view.entries.length - 1] ?? null;

  const stats = [
    { label: t("snapSales"), value: `$${(latest?.sales ?? 0).toLocaleString()}` },
    { label: t("snapOrders"), value: `${latest?.orders ?? 0}` },
    {
      label: t("snapAdSpend"),
      value: `$${(latest?.health.adSpend ?? 0).toLocaleString()}`,
    },
    {
      label: t("snapCod"),
      value: `$${(latest?.codOutstanding ?? 0).toLocaleString()}`,
    },
  ];

  return (
    <div className="surface-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-base text-ink">{t("snapTitle")}</h2>
          <p className="mt-0.5 text-xs text-stone-dark">
            {latest ? t("snapWeeks", { n: view.weekCount }) : t("snapNone")}
          </p>
        </div>
        <Link
          href="/finance"
          className="whitespace-nowrap text-sm font-medium text-sea underline-offset-2 hover:underline"
        >
          {t("openTopicA")} →
        </Link>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((s) => (
          <div
            key={s.label}
            className="rounded-lg border border-stone bg-surface-subtle p-3"
          >
            <dt className="text-[11px] text-stone-dark">{s.label}</dt>
            <dd className="mt-1 text-lg font-semibold text-ink">{s.value}</dd>
          </div>
        ))}
      </dl>

      {view.investNext && (
        <Link
          href="/finance"
          className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-cedar-deep underline-offset-2 hover:underline"
        >
          {t(`investNext.${view.investNext.recommendation}` as never)} →
        </Link>
      )}
    </div>
  );
}
