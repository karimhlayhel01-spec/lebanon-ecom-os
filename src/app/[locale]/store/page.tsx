import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireOnboardedContext } from "@/lib/workspace";
import { getSupplierPanel } from "@/lib/supplier/service";
import { getStorePanel } from "@/lib/store/service";
import { StorePanel } from "@/components/store/StorePanel";
import { DeepPageLayout, EmptyState } from "@/components/dashboard/DeepPageLayout";

type Props = { params: Promise<{ locale: string }> };

export default async function StorePage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const ctx = await requireOnboardedContext(locale);
  const t = await getTranslations("Dashboard");
  const isPaused = (ctx.journey?.primaryState ?? "") === "paused";

  const supplier = ctx.side?.productAccepted
    ? await getSupplierPanel(ctx.workspace.id)
    : null;
  const view = supplier?.sampleApproved
    ? await getStorePanel(ctx.workspace.id)
    : null;

  return (
    <DeepPageLayout isPaused={isPaused} title={t("pageStore")}>
      {view ? <StorePanel view={view} /> : <EmptyState message={t("emptyStore")} />}
    </DeepPageLayout>
  );
}
