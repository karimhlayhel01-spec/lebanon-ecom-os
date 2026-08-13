import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireOnboardedContext } from "@/lib/workspace";
import { getSupplierPanel } from "@/lib/supplier/service";
import { getStorePanel } from "@/lib/store/service";
import { StorePanel } from "@/components/store/StorePanel";
import { DeepPageLayout, EmptyState } from "@/components/dashboard/DeepPageLayout";
import { listLiveSkus } from "@/lib/sku/journey";
import {
  isStoreShopPackRequest,
  resolveStorePanelSkuId,
  skuParamForStoreResolve,
} from "@/lib/store/page-pack-scope";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ sku?: string | string[] }>;
};

export default async function StorePage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const ctx = await requireOnboardedContext(locale);
  const t = await getTranslations("Dashboard");
  const isPaused = (ctx.journey?.primaryState ?? "") === "paused";

  const sp = await searchParams;
  const skuParam = Array.isArray(sp.sku) ? sp.sku[0] : sp.sku;

  const supplier = ctx.side?.productAccepted
    ? await getSupplierPanel(ctx.workspace.id)
    : null;

  let view = null;
  if (supplier?.sampleApproved) {
    const live = await listLiveSkus(ctx.workspace.id);
    const liveIds = [...live]
      .sort(
        (a, b) =>
          a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
      )
      .map((s) => s.id);
    const isShopPackRequest = isStoreShopPackRequest(skuParam, live.length);
    view = isShopPackRequest
      ? await getStorePanel(ctx.workspace.id, null)
      : await getStorePanel(
          ctx.workspace.id,
          resolveStorePanelSkuId(liveIds, skuParamForStoreResolve(skuParam)),
        );
  }

  return (
    <DeepPageLayout isPaused={isPaused} title={t("pageStore")}>
      {view ? (
        <StorePanel
          key={view.isShopPack ? "shop" : (view.selectedSkuId ?? "store")}
          view={view}
        />
      ) : (
        <EmptyState message={t("emptyStore")} />
      )}
    </DeepPageLayout>
  );
}
