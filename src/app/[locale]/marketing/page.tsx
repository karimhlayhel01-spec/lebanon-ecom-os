import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireOnboardedContext } from "@/lib/workspace";
import { getMarketingPanel } from "@/lib/marketing/service";
import { resolveMarketingJourneyFlags } from "@/lib/marketing/focus";
import { MarketingPanel } from "@/components/marketing/MarketingPanel";
import { DeepPageLayout, EmptyState } from "@/components/dashboard/DeepPageLayout";
import { getSkuJourney, listLiveSkus } from "@/lib/sku/journey";
import { resolveHubToolSkuId } from "@/lib/sku/tools";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ stage?: string | string[]; sku?: string | string[] }>;
};

export default async function MarketingPage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const ctx = await requireOnboardedContext(locale);
  const t = await getTranslations("Dashboard");
  const isPaused =
    !!ctx.workspace.shopPaused ||
    (ctx.journey?.primaryState ?? "") === "paused";

  const sp = await searchParams;
  const requestedStage = Array.isArray(sp.stage) ? sp.stage[0] : sp.stage;
  const skuParam = Array.isArray(sp.sku) ? sp.sku[0] : sp.sku;

  const live = await listLiveSkus(ctx.workspace.id);
  const isShopKitRequest = skuParam === "shop" && live.length >= 3;
  const selectedSkuId = isShopKitRequest
    ? null
    : skuParam && live.some((s) => s.id === skuParam)
      ? skuParam
      : undefined;

  const fallbackSkuId = resolveHubToolSkuId(
    live.map((s) => s.id),
    ctx.workspace.activeSkuId,
  );

  let view = null;
  let contextSku: { id: string; name: string } | null = null;

  if (ctx.side?.productAccepted && live.length > 0) {
    if (isShopKitRequest) {
      view = await getMarketingPanel(ctx.workspace.id, null);
    } else {
      const targetId = selectedSkuId ?? fallbackSkuId;

      if (targetId) {
        const skuRow = live.find((s) => s.id === targetId) ?? null;
        if (skuRow) contextSku = { id: skuRow.id, name: skuRow.name };

        const skuJourney = await getSkuJourney(targetId);
        const flags = resolveMarketingJourneyFlags({
          skuJourney: skuJourney
            ? {
                primaryState: skuJourney.primaryState,
                pausedFromState: skuJourney.pausedFromState,
                sampleStatus: skuJourney.sampleStatus,
                batchOrdered: skuJourney.batchOrdered,
                batchArrivedReady: skuJourney.batchArrivedReady,
                marketingStage: skuJourney.marketingStage,
                batchArrivalEta: skuJourney.batchArrivalEta,
              }
            : null,
          legacy: skuJourney
            ? null
            : {
                primaryState: ctx.journey?.primaryState ?? "",
                sampleStatus: ctx.side.sampleStatus,
                batchOrdered: ctx.side.batchOrdered,
                batchArrivedReady: ctx.side.batchArrivedReady,
                marketingStage: ctx.side.marketingStage,
                batchArrivalEta: ctx.side.batchArrivalEta,
              },
        });
        if (flags.sampleApproved) {
          view = await getMarketingPanel(ctx.workspace.id, targetId);
        }
      }
    }
  }

  return (
    <DeepPageLayout
      isPaused={isPaused}
      title={t("pageMarketing")}
      skuContext={
        contextSku && !isShopKitRequest
          ? { id: contextSku.id, name: contextSku.name, section: "marketing" }
          : null
      }
    >
      {view ? (
        <MarketingPanel
          key={view.isShopKit ? "shop" : (view.selectedSkuId ?? "sku")}
          view={view}
          requestedStage={requestedStage}
          surface="deep"
        />
      ) : (
        <EmptyState message={t("emptyMarketing")} />
      )}
    </DeepPageLayout>
  );
}
