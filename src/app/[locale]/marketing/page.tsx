import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireOnboardedContext } from "@/lib/workspace";
import { getSupplierPanel } from "@/lib/supplier/service";
import { getMarketingPanel } from "@/lib/marketing/service";
import { MarketingPanel } from "@/components/marketing/MarketingPanel";
import { DeepPageLayout, EmptyState } from "@/components/dashboard/DeepPageLayout";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ stage?: string | string[] }>;
};

export default async function MarketingPage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const ctx = await requireOnboardedContext(locale);
  const t = await getTranslations("Dashboard");
  const isPaused = (ctx.journey?.primaryState ?? "") === "paused";

  const { stage } = await searchParams;
  const requestedStage = Array.isArray(stage) ? stage[0] : stage;

  const supplier = ctx.side?.productAccepted
    ? await getSupplierPanel(ctx.workspace.id)
    : null;
  const view = supplier?.sampleApproved
    ? await getMarketingPanel(ctx.workspace.id)
    : null;

  return (
    <DeepPageLayout isPaused={isPaused} title={t("pageMarketing")}>
      {view ? (
        <MarketingPanel view={view} requestedStage={requestedStage} />
      ) : (
        <EmptyState message={t("emptyMarketing")} />
      )}
    </DeepPageLayout>
  );
}
