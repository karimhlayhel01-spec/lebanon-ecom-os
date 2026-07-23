import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { AppHeader } from "@/components/dashboard/AppHeader";
import { isPreviewMode } from "@/lib/preview/config"; // PREVIEW (removable)
import { PreviewBanner } from "@/components/preview/PreviewBanner"; // PREVIEW (removable)

/**
 * Frame for the deep pages (/sku, /supplier, /store, /marketing, /finance).
 * Shares the app header + preview banner with the dashboard, adds a page title
 * and a "← Dashboard" link, and hosts one heavy panel (or an empty state).
 */
export async function DeepPageLayout({
  isPaused,
  title,
  children,
}: {
  isPaused: boolean;
  title: string;
  children: React.ReactNode;
}) {
  const t = await getTranslations("Dashboard");

  return (
    <div className="min-h-screen">
      <AppHeader isPaused={isPaused} showBack />
      <main className="mx-auto w-full max-w-6xl px-6 py-8">
        {isPreviewMode() && <PreviewBanner />}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-display text-2xl text-ink">{title}</h1>
          <Link
            href="/dashboard"
            className="text-sm font-medium text-sea underline-offset-2 hover:underline"
          >
            {t("backToDashboard")}
          </Link>
        </div>
        <div className="mt-6 animate-rise">{children}</div>
      </main>
    </div>
  );
}

/** Clear empty state shown when a deep page is not yet reachable in the journey. */
export async function EmptyState({ message }: { message: string }) {
  const t = await getTranslations("Dashboard");

  return (
    <div className="surface-card p-8 text-center">
      <p className="mx-auto max-w-md text-sm text-stone-dark">{message}</p>
      <Link
        href="/dashboard"
        className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-cedar px-4 py-2 text-sm font-semibold text-foam shadow-sm transition hover:bg-cedar-deep"
      >
        {t("backToDashboardCta")}
      </Link>
    </div>
  );
}
