import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { AppHeader } from "@/components/dashboard/AppHeader";
import type { ToolsSection } from "@/lib/sku/tools";
import { skuToolHref } from "@/lib/sku/tools";

/**
 * Frame for deep pages (/supplier, /store, /marketing, /finance).
 * SKU page sections are the primary work surface; deep pages stay valid as the
 * same work with an explicit link back to the full product page.
 */
export async function DeepPageLayout({
  isPaused,
  title,
  skuContext,
  children,
}: {
  isPaused: boolean;
  title: string;
  /** When set, clarify this deep page is the same work as the SKU spine. */
  skuContext?: {
    id: string;
    name: string;
    section?: ToolsSection;
  } | null;
  children: React.ReactNode;
}) {
  const t = await getTranslations("Dashboard");
  const productHref = skuContext
    ? skuContext.section
      ? skuToolHref(skuContext.id, skuContext.section)
      : `/sku/${skuContext.id}`
    : null;

  return (
    <div className="min-h-screen">
      <AppHeader isPaused={isPaused} />
      <main className="app-shell py-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-display text-2xl text-ink">{title}</h1>
        </div>
        {skuContext && productHref ? (
          <p className="mt-2 max-w-2xl text-sm text-stone-dark">
            <Link
              href={productHref}
              className="font-medium text-sea underline-offset-2 hover:underline"
              dir="auto"
            >
              {t("deepPageWorkingOn", { name: skuContext.name })}
            </Link>
          </p>
        ) : null}
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
        href="/dashboard?hub=1"
        className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-cedar px-4 py-2 text-sm font-semibold text-foam shadow-sm transition hover:bg-cedar-deep"
      >
        {t("backToDashboardCta")}
      </Link>
    </div>
  );
}
