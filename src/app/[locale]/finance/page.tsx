import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireOnboardedContext } from "@/lib/workspace";
import { getFinancePanel } from "@/lib/finance/service";
import { FinancePanel } from "@/components/finance/FinancePanel";
import { DeepPageLayout, EmptyState } from "@/components/dashboard/DeepPageLayout";
import { getSkuJourney, listLiveSkus } from "@/lib/sku/journey";
import { isSkuFinanceSectionUnlocked } from "@/lib/sku/page-sections";
import { resolveHubToolSkuId } from "@/lib/sku/tools";

type Props = { params: Promise<{ locale: string }> };

export default async function FinancePage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const ctx = await requireOnboardedContext(locale);
  const t = await getTranslations("Dashboard");
  const isPaused =
    !!ctx.workspace.shopPaused ||
    (ctx.journey?.primaryState ?? "") === "paused";

  const live = await listLiveSkus(ctx.workspace.id);
  const skuId = resolveHubToolSkuId(
    live.map((s) => s.id),
    ctx.workspace.activeSkuId,
  );
  const sku = skuId ? live.find((s) => s.id === skuId) : null;

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

  const view = showFinance ? await getFinancePanel(ctx.workspace.id) : null;

  return (
    <DeepPageLayout
      isPaused={isPaused}
      title={t("pageFinance")}
      skuContext={
        sku ? { id: sku.id, name: sku.name, section: "finance" } : null
      }
    >
      {view ? (
        <FinancePanel view={view} />
      ) : (
        <EmptyState message={t("emptyFinance")} />
      )}
    </DeepPageLayout>
  );
}
