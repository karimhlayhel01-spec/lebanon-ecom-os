import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireOnboardedContext } from "@/lib/workspace";
import { getSupplierPanel } from "@/lib/supplier/service";
import { SupplierPanel } from "@/components/supplier/SupplierPanel";
import { DeepPageLayout, EmptyState } from "@/components/dashboard/DeepPageLayout";
import { listLiveSkus } from "@/lib/sku/journey";
import { resolveHubToolSkuId } from "@/lib/sku/tools";

type Props = { params: Promise<{ locale: string }> };

export default async function SupplierPage({ params }: Props) {
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

  const view = sku
    ? await getSupplierPanel(ctx.workspace.id, sku.id)
    : null;

  return (
    <DeepPageLayout
      isPaused={isPaused}
      title={t("pageSupplier")}
      skuContext={
        sku
          ? { id: sku.id, name: sku.name, section: "supplier" }
          : null
      }
    >
      {view ? (
        <SupplierPanel view={view} />
      ) : (
        <EmptyState message={t("emptySupplier")} />
      )}
    </DeepPageLayout>
  );
}
