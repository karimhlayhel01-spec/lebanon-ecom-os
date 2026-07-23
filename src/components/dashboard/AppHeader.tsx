import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { logoutAction } from "@/actions/auth";
import { LanguageSwitch } from "@/components/dashboard/LanguageSwitch";
import { PauseResumeControls } from "@/components/dashboard/PauseResumeControls";

/**
 * Shared top bar for the dashboard hub and the deep pages. Keeps the header
 * "unchanged in spirit": brand, language, edit onboarding, pause/resume, logout.
 * Deep pages pass `showBack` to add a "← Dashboard" link.
 */
export async function AppHeader({
  isPaused,
  showBack = false,
}: {
  isPaused: boolean;
  showBack?: boolean;
}) {
  const t = await getTranslations("Dashboard");
  const brand = await getTranslations("Brand");
  const auth = await getTranslations("Auth");

  return (
    <header className="border-b border-stone bg-surface">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-3.5">
        <div className="flex items-center gap-4">
          <Link
            href="/"
            className="font-display text-lg font-semibold tracking-tight text-ink"
          >
            {brand("name")}
          </Link>
          {showBack && (
            <Link
              href="/dashboard"
              className="text-sm font-medium text-sea underline-offset-2 hover:underline"
            >
              {t("backToDashboard")}
            </Link>
          )}
        </div>
        <div className="flex items-center gap-3">
          <LanguageSwitch />
          <Link
            href="/onboarding?edit=1"
            className="rounded-md border border-stone px-3 py-2 text-sm font-medium text-ink transition hover:bg-sand"
          >
            {t("editOnboarding")}
          </Link>
          <PauseResumeControls isPaused={isPaused} />
          <form action={logoutAction}>
            <button
              type="submit"
              className="rounded-md border border-stone px-3 py-2 text-sm font-medium text-ink transition hover:bg-sand"
            >
              {auth("logout")}
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
