import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { isPreviewMode, PREVIEW_EMAIL, PREVIEW_PASSWORD } from "@/lib/preview/config";
import { PreviewControls } from "@/components/preview/PreviewControls";

/**
 * REMOVABLE PREVIEW PAGE — local QA only.
 *
 * Only reachable when PREVIEW_MODE is on (otherwise 404). Lets you seed the
 * demo workspace to any stage and jump straight into the dashboard as the
 * preview founder. Delete this folder to remove.
 */

type Props = { params: Promise<{ locale: string }> };

export default async function PreviewPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  if (!isPreviewMode()) {
    notFound();
  }

  const t = await getTranslations("Preview");

  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-10">
      <div className="mb-6 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <span className="font-semibold">{t("bannerTitle")}</span>{" "}
        {t("bannerBody")}
      </div>

      <h1 className="font-display text-2xl text-ink">{t("pageTitle")}</h1>
      <p className="mt-1 text-sm text-stone-dark">{t("pageLead")}</p>

      <div className="surface-card mt-6 p-5">
        <h2 className="font-display text-base text-ink">{t("jumpTitle")}</h2>
        <p className="mt-1 text-sm text-stone-dark">{t("jumpLead")}</p>
        <div className="mt-4">
          <PreviewControls />
        </div>
      </div>

      <div className="surface-card mt-5 p-5 text-sm">
        <h2 className="font-display text-base text-ink">{t("credsTitle")}</h2>
        <p className="mt-2 text-stone-dark">
          {t("credsEmail")}:{" "}
          <code className="rounded bg-sand px-1.5 py-0.5 text-ink">
            {PREVIEW_EMAIL}
          </code>
        </p>
        <p className="mt-1 text-stone-dark">
          {t("credsPassword")}:{" "}
          <code className="rounded bg-sand px-1.5 py-0.5 text-ink">
            {PREVIEW_PASSWORD}
          </code>
        </p>
      </div>

      <div className="mt-6">
        <Link
          href="/dashboard"
          className="text-sm font-medium text-sea underline-offset-2 hover:underline"
        >
          {t("toDashboard")} →
        </Link>
      </div>
    </div>
  );
}
