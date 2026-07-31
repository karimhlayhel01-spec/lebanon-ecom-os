import { getTranslations } from "next-intl/server";
import {
  JOURNEY_STEPS,
  type JourneyStep,
} from "@/lib/dashboard/journey-step";

export type { JourneyStep };

/**
 * Human-readable status journey (Discovery → Accepted → Sample → Batch →
 * Arrived → Selling), with the current step emphasized. Uses i18n labels, not
 * raw status strings.
 *
 * When `skuName` is set (hub), the strip is for that one SKU — not a shop-wide
 * single journey.
 */
export async function JourneyStrip({
  current,
  skuName,
}: {
  current: JourneyStep;
  skuName?: string | null;
}) {
  const t = await getTranslations("Dashboard");
  const currentIdx = JOURNEY_STEPS.indexOf(current);

  return (
    <div className="surface-card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-base text-ink">{t("journeyTitle")}</h2>
        {skuName ? (
          <p
            className="truncate text-xs font-medium text-stone-dark"
            dir="auto"
            title={skuName}
          >
            {t("journeyForSku", { name: skuName })}
          </p>
        ) : null}
      </div>
      <ol className="mt-4 space-y-2.5">
        {JOURNEY_STEPS.map((step, i) => {
          const state =
            i < currentIdx ? "done" : i === currentIdx ? "current" : "upcoming";
          return (
            <li
              key={step}
              className={`flex items-center gap-3 ${
                state === "current" ? "animate-step" : ""
              }`}
            >
              <span
                className={`grid size-5 shrink-0 place-items-center rounded-full text-[10px] font-bold ${
                  state === "done"
                    ? "bg-cedar text-foam"
                    : state === "current"
                      ? "bg-cedar/15 text-cedar-deep ring-2 ring-cedar"
                      : "bg-sand text-stone-dark"
                }`}
                aria-hidden
              >
                {state === "done" ? "✓" : i + 1}
              </span>
              <span
                className={`text-sm ${
                  state === "current"
                    ? "font-semibold text-ink"
                    : state === "done"
                      ? "text-stone-dark"
                      : "text-stone-dark/70"
                }`}
              >
                {t(`journey.${step}` as never)}
              </span>
              {state === "current" && (
                <span className="ms-auto rounded-full bg-cedar/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-cedar-deep">
                  {t("journeyNow")}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
