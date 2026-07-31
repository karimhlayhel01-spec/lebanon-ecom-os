import { setRequestLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { requireOnboardedContext } from "@/lib/workspace";
import { listLiveSkus, resolveActiveSkuId } from "@/lib/sku/journey";

type Props = { params: Promise<{ locale: string }> };

/** Legacy /sku → active or sole live SKU page, else shop hub. */
export default async function SkuIndexPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const ctx = await requireOnboardedContext(locale);
  const active = await resolveActiveSkuId(ctx.workspace.id);
  if (active) {
    redirect({ href: `/sku/${active}`, locale });
  }
  const live = await listLiveSkus(ctx.workspace.id);
  if (live[0]) {
    redirect({ href: `/sku/${live[0].id}`, locale });
  }
  redirect({ href: "/dashboard", locale });
}
