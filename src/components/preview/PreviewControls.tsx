"use client";

/**
 * REMOVABLE PREVIEW COMPONENT — local QA only.
 * Stage-jump buttons for the /preview page. Delete with `src/lib/preview/`.
 */

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import {
  CLASSIC_PREVIEW_STAGES,
  WAVE1_PREVIEW_STAGES,
  PREVIEW_STAGES,
} from "@/lib/preview/config";
import {
  seedAndEnterAction,
  type PreviewActionState,
} from "@/lib/preview/actions";

export function PreviewControls() {
  const t = useTranslations("Preview");
  const [state, action, pending] = useActionState<PreviewActionState, FormData>(
    seedAndEnterAction,
    {},
  );

  // Default reset target: the full "selling" fixture (most complete for QA).
  const DEFAULT_RESET_STAGE = "selling";

  return (
    <div className="space-y-5">
      {/* Stage jump — each click is a full wipe + deterministic rebuild. */}
      <form action={action} className="space-y-4">
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-dark">
            {t("classicGroup")}
          </h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {CLASSIC_PREVIEW_STAGES.map((stage) => (
              <button
                key={stage}
                type="submit"
                name="stage"
                value={stage}
                disabled={pending}
                className="flex flex-col items-start gap-0.5 rounded-md border border-stone bg-surface px-4 py-3 text-start transition hover:bg-sand disabled:opacity-60"
              >
                <span className="text-sm font-semibold text-ink">
                  {t(`stage.${stage}.title`)}
                </span>
                <span className="text-xs text-stone-dark">
                  {t(`stage.${stage}.body`)}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-dark">
            {t("wave1Group")}
          </h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {WAVE1_PREVIEW_STAGES.map((stage) => (
              <button
                key={stage}
                type="submit"
                name="stage"
                value={stage}
                disabled={pending}
                className="flex flex-col items-start gap-0.5 rounded-md border border-stone bg-surface px-4 py-3 text-start transition hover:bg-sand disabled:opacity-60"
              >
                <span className="text-sm font-semibold text-ink">
                  {t(`stage.${stage}.title`)}
                </span>
                <span className="text-xs text-stone-dark">
                  {t(`stage.${stage}.body`)}
                </span>
              </button>
            ))}
          </div>
        </div>

        <p className="text-xs text-stone-dark">{t("stageWipeHint")}</p>
      </form>

      {/* Dedicated reset control — same wipe + rebuild, pick the target stage. */}
      <form
        action={action}
        className="rounded-md border border-amber-300 bg-amber-50/60 p-4"
      >
        <h3 className="text-sm font-semibold text-amber-900">
          {t("resetTitle")}
        </h3>
        <p className="mt-1 text-xs text-amber-800">{t("resetLead")}</p>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs text-amber-900">
            <span className="font-medium">{t("resetStageLabel")}</span>
            <select
              name="stage"
              defaultValue={DEFAULT_RESET_STAGE}
              disabled={pending}
              className="rounded-md border border-amber-300 bg-white px-3 py-2 text-sm text-ink disabled:opacity-60"
            >
              {PREVIEW_STAGES.map((stage) => (
                <option key={stage} value={stage}>
                  {t(`stage.${stage}.title`)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            disabled={pending}
            className="rounded-md border border-amber-500 bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-60"
          >
            {t("resetButton")}
          </button>
        </div>
      </form>

      {pending && <p className="text-sm text-stone-dark">{t("seeding")}</p>}
      {state.error && (
        <p className="text-sm text-amber-800">{t("seedError")}</p>
      )}
    </div>
  );
}
