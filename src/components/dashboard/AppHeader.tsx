import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { LanguageSwitch } from "@/components/dashboard/LanguageSwitch";
import { PauseResumeControls } from "@/components/dashboard/PauseResumeControls";
import { SettingsMenu } from "@/components/dashboard/SettingsMenu";
import { VocabularyDrawer } from "@/components/vocabulary/VocabularyDrawer";
import { getSessionUser } from "@/lib/auth";
import { getJourney } from "@/lib/memory/repos";
import {
  resolveVocabHighlightPhase,
  type VocabPhase,
} from "@/lib/vocabulary/glossary";
import { getWorkspaceForUser } from "@/lib/workspace";

/**
 * Shared top bar for the dashboard hub and deep pages.
 * Always visible: brand (+ workspace) · Shop · Language · Vocab · ⚙
 * Resume stays in the header when the shop is paused; Pause / Edit onboarding /
 * Logout live in the gear menu. Finance history stays gear-only.
 */
export async function AppHeader({
  isPaused,
  highlightPhase: highlightPhaseProp,
}: {
  isPaused: boolean;
  /** Soft vocab highlight; `null` = no highlight; omit = workspace fallback. */
  highlightPhase?: VocabPhase | null;
}) {
  const t = await getTranslations("Dashboard");
  const brand = await getTranslations("Brand");
  const user = await getSessionUser();
  const workspace = user ? await getWorkspaceForUser(user.id) : null;
  const journey = workspace ? await getJourney(workspace.id) : null;
  const highlightPhase =
    highlightPhaseProp !== undefined
      ? highlightPhaseProp
      : resolveVocabHighlightPhase(
          journey?.primaryState,
          journey?.pausedFromState,
        );

  return (
    <header className="border-b border-stone bg-surface">
      <div className="app-shell flex items-center justify-between gap-2 py-2.5 sm:gap-3 sm:py-3.5">
        <div className="flex min-w-0 items-center gap-2 sm:gap-4">
          <div className="flex min-w-0 flex-col">
            <Link
              href="/"
              className="truncate font-display text-base font-semibold tracking-tight text-ink sm:text-lg"
            >
              {brand("name")}
            </Link>
            {workspace?.name ? (
              <span
                className="truncate text-[11px] text-stone-dark sm:text-xs"
                dir="auto"
                title={workspace.name}
              >
                {workspace.name}
              </span>
            ) : null}
          </div>
          <Link
            href="/dashboard?hub=1"
            className="shrink-0 text-sm font-medium text-sea underline-offset-2 hover:underline"
          >
            {t("shopLink")}
          </Link>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <VocabularyDrawer highlightPhase={highlightPhase} />
          <LanguageSwitch />
          {isPaused ? <PauseResumeControls isPaused /> : null}
          {user && workspace ? (
            <SettingsMenu
              email={user.email}
              workspaceName={workspace.name}
              isPaused={isPaused}
            />
          ) : null}
        </div>
      </div>
    </header>
  );
}
