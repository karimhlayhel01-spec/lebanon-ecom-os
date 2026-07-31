import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { requireOnboardedContext } from "@/lib/workspace";
import { getTopicAHistoryEntries } from "@/lib/finance/service";
import { TopicAEntryRow } from "@/components/finance/FinancePanel";
import { DeepPageLayout, EmptyState } from "@/components/dashboard/DeepPageLayout";
import { getSkuJourney, listLiveSkus } from "@/lib/sku/journey";
import { isSkuFinanceSectionUnlocked } from "@/lib/sku/page-sections";

type Props = { params: Promise<{ locale: string }> };

export default async function FinanceHistoryPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const ctx = await requireOnboardedContext(locale);
  const tDash = await getTranslations("Dashboard");
  const t = await getTranslations("Finance");
  const isPaused =
    !!ctx.workspace.shopPaused ||
    (ctx.journey?.primaryState ?? "") === "paused";

  const live = await listLiveSkus(ctx.workspace.id);
  let showFinance = false;
  for (const s of live) {
    const j = await getSkuJourney(s.id);
    if (
      j &&
      isSkuFinanceSectionUnlocked({
        batchArrivedReady: !!j.batchArrivedReady,
        primaryState: j.primaryState,
        pausedFromState: j.pausedFromState,
      })
    ) {
      showFinance = true;
      break;
    }
  }

  const history = showFinance
    ? await getTopicAHistoryEntries(ctx.workspace.id)
    : null;

  return (
    <DeepPageLayout isPaused={isPaused} title={t("historyTitle")}>
      {!showFinance || !history ? (
        <EmptyState message={tDash("emptyFinance")} />
      ) : (
        <div className="surface-card p-5">
          <p className="max-w-2xl text-sm text-stone-dark">{t("historyIntro")}</p>
          <p className="mt-2 text-xs text-stone-dark">
            <Link
              href="/finance"
              className="font-medium text-sea underline-offset-2 hover:underline"
            >
              {t("historyBackToFinance")}
            </Link>
          </p>

          {history.entries.length === 0 ? (
            <div className="mt-6 rounded-lg border border-dashed border-stone bg-surface-subtle px-3 py-6 text-center text-sm text-stone-dark">
              {t("historyEmpty")}
            </div>
          ) : (
            <div className="mt-4 space-y-2">
              <p className="text-xs text-stone-dark">
                {t("historyCount", {
                  older: history.olderWeekCount,
                  total: history.totalWeekCount,
                  recent: history.recentLimit,
                })}
              </p>
              {history.entries
                .slice()
                .reverse()
                .map((e) => (
                  <TopicAEntryRow key={e.id} entry={e} />
                ))}
            </div>
          )}
        </div>
      )}
    </DeepPageLayout>
  );
}
