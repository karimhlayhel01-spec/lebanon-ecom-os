import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireOnboardedContext } from "@/lib/workspace";
import { getSkuView } from "@/lib/sku/service";
import { getCurrentActual } from "@/lib/finance/service";
import { SkuCard } from "@/components/sku/SkuCard";
import { DeepPageLayout, EmptyState } from "@/components/dashboard/DeepPageLayout";

type Props = { params: Promise<{ locale: string }> };

export default async function SkuPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const ctx = await requireOnboardedContext(locale);
  const t = await getTranslations("Dashboard");
  const isPaused = (ctx.journey?.primaryState ?? "") === "paused";

  const sku = ctx.side?.productAccepted
    ? await getSkuView(ctx.workspace.id)
    : null;
  const actual = sku ? await getCurrentActual(ctx.workspace.id) : null;

  return (
    <DeepPageLayout isPaused={isPaused} title={t("pageSku")}>
      {sku ? (
        <SkuCard sku={sku} actual={actual} />
      ) : (
        <EmptyState message={t("emptySku")} />
      )}
    </DeepPageLayout>
  );
}
