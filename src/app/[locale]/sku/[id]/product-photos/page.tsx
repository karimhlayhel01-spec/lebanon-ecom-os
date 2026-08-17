import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { AppHeader } from "@/components/dashboard/AppHeader";
import { ProductPhotosClient } from "@/components/marketing/ProductPhotosClient";
import { listPhotoPackDetailsForSku } from "@/lib/marketing/visual-packs";
import { assertSkuOwned } from "@/lib/sku/ownership";
import { requireOnboardedContext } from "@/lib/workspace";

type Props = {
  params: Promise<{ locale: string; id: string }>;
};

export default async function ProductPhotosPage({ params }: Props) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const ctx = await requireOnboardedContext(locale);
  const owned = await assertSkuOwned(ctx.workspace.id, id);
  if (!owned.ok || owned.card.lifecycleStatus !== "live") notFound();

  const listed = await listPhotoPackDetailsForSku(ctx.workspace.id, id);
  if (!listed.ok) notFound();

  const t = await getTranslations("Marketing");
  const isAr = locale === "ar";
  const isPaused =
    !!ctx.workspace.shopPaused ||
    (ctx.journey?.primaryState ?? "") === "paused";

  return (
    <div className="min-h-screen">
      <AppHeader isPaused={isPaused} />
      <main className="app-shell py-8">
        <Link
          href={`/sku/${id}#marketing`}
          className="text-sm font-medium text-sea underline-offset-2 hover:underline"
        >
          {t("photoPacksBack")}
        </Link>
        <h1 className="mt-3 font-display text-2xl text-ink">
          {t("photoPacksTitle")}
        </h1>
        <p className="mt-1 text-sm text-stone-dark" dir="auto">
          {owned.card.name}
        </p>

        <section
          className="mt-6 rounded-lg border border-cedar/30 bg-cedar/5 p-4"
          dir={isAr ? "rtl" : undefined}
        >
          <h2 className="text-sm font-bold uppercase tracking-wide text-ink">
            {t("photoPacksHowToTitle")}
          </h2>
          <ul className="mt-3 list-disc space-y-2 ps-5 text-sm font-bold text-ink">
            <li>{t("photoPacksHowToLight")}</li>
            <li>{t("photoPacksHowToFrame")}</li>
            <li>{t("photoPacksHowToAngles")}</li>
            <li>{t("photoPacksHowToClutter")}</li>
            <li>{t("photoPacksHowToMotion")}</li>
            <li>{t("photoPacksHowToQuality")}</li>
          </ul>
        </section>

        <ProductPhotosClient skuId={id} packs={listed.value} />
      </main>
    </div>
  );
}
