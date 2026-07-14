"use client";

import { useTranslations } from "next-intl";
import {
  pauseJourneyAction,
  resumeJourneyAction,
} from "@/actions/journey";

export function PauseResumeControls({
  isPaused,
}: {
  isPaused: boolean;
}) {
  const t = useTranslations("Dashboard");

  return (
    <form action={isPaused ? resumeJourneyAction : pauseJourneyAction}>
      <button
        type="submit"
        className="rounded-md border border-stone bg-surface px-3 py-2 text-sm font-medium text-ink transition hover:bg-sand"
      >
        {isPaused ? t("resume") : t("pause")}
      </button>
    </form>
  );
}
