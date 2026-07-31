"use client";

import { useTranslations } from "next-intl";
import { pauseShopAction, resumeShopAction } from "@/actions/sku";

/**
 * Shop-level pause/resume in the app header (whole store).
 * Per-SKU pause lives on Shop hub multi-select — not here.
 */
export function PauseResumeControls({
  isPaused,
}: {
  isPaused: boolean;
}) {
  const t = useTranslations("Dashboard");

  return (
    <form action={isPaused ? resumeShopAction : pauseShopAction}>
      <button
        type="submit"
        title={isPaused ? t("resumeShopTitle") : t("pauseShopTitle")}
        className={`rounded-md border px-2.5 py-1.5 text-xs font-medium transition sm:px-3 sm:py-2 sm:text-sm ${
          isPaused
            ? "border-cedar/40 bg-cedar/10 text-cedar-deep hover:bg-cedar/15"
            : "border-stone bg-surface text-ink hover:bg-sand"
        }`}
      >
        {isPaused ? t("resumeShop") : t("pauseShop")}
      </button>
    </form>
  );
}
