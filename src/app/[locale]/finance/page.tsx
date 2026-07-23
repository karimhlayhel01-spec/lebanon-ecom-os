import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireOnboardedContext } from "@/lib/workspace";
import { getSupplierPanel } from "@/lib/supplier/service";
import { getFinancePanel } from "@/lib/finance/service";
import { FinancePanel } from "@/components/finance/FinancePanel";
import { DeepPageLayout, EmptyState } from "@/components/dashboard/DeepPageLayout";

type Props = { params: Promise<{ locale: string }> };

export default async function FinancePage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const ctx = await requireOnboardedContext(locale);
  const t = await getTranslations("Dashboard");
  const primaryState = ctx.journey?.primaryState ?? "";
  const isPaused = primaryState === "paused";

  const supplier = ctx.side?.productAccepted
    ? await getSupplierPanel(ctx.workspace.id)
    : null;
  const showFinance =
    !!supplier?.batchArrivedReady || primaryState === "selling";
  const view = showFinance ? await getFinancePanel(ctx.workspace.id) : null;

  return (
    <DeepPageLayout isPaused={isPaused} title={t("pageFinance")}>
      {view ? (
        <FinancePanel view={view} />
      ) : (
        <EmptyState message={t("emptyFinance")} />
      )}
    </DeepPageLayout>
  );
}
