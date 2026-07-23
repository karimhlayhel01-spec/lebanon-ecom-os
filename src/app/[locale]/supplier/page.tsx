import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireOnboardedContext } from "@/lib/workspace";
import { getSkuView } from "@/lib/sku/service";
import { getSupplierPanel } from "@/lib/supplier/service";
import { SupplierPanel } from "@/components/supplier/SupplierPanel";
import { DeepPageLayout, EmptyState } from "@/components/dashboard/DeepPageLayout";

type Props = { params: Promise<{ locale: string }> };

export default async function SupplierPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const ctx = await requireOnboardedContext(locale);
  const t = await getTranslations("Dashboard");
  const isPaused = (ctx.journey?.primaryState ?? "") === "paused";

  const sku = ctx.side?.productAccepted
    ? await getSkuView(ctx.workspace.id)
    : null;
  const view = sku ? await getSupplierPanel(ctx.workspace.id) : null;

  return (
    <DeepPageLayout isPaused={isPaused} title={t("pageSupplier")}>
      {view ? (
        <SupplierPanel view={view} />
      ) : (
        <EmptyState message={t("emptySupplier")} />
      )}
    </DeepPageLayout>
  );
}
