import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

/**
 * REMOVABLE PREVIEW COMPONENT — local QA only.
 *
 * Rendered on the dashboard only when PREVIEW_MODE is on. Makes it obvious the
 * data is seeded and links to the /preview stage-jump page. Delete this file
 * (and its use in the dashboard page) to remove.
 */
export async function PreviewBanner() {
  const t = await getTranslations("Preview");
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-3">
      <div className="flex items-center gap-2 text-sm text-amber-900">
        <span
          className="inline-flex size-2 rounded-full bg-amber-500"
          aria-hidden
        />
        <span className="font-semibold">{t("bannerTitle")}</span>
        <span className="text-amber-800">{t("bannerBody")}</span>
      </div>
      <div className="flex items-center gap-2">
        <Link
          href="/preview"
          className="rounded-md border border-amber-400 bg-white/60 px-3 py-1.5 text-sm font-medium text-amber-900 transition hover:bg-white"
        >
          {t("bannerCta")}
        </Link>
        <Link
          href="/preview"
          className="rounded-md px-3 py-1.5 text-sm font-medium text-amber-900 underline-offset-2 transition hover:underline"
        >
          {t("bannerReset")}
        </Link>
      </div>
    </div>
  );
}
