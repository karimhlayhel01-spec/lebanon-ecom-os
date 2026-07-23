"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import type {
  CoachingCard,
  Orchestration,
  OrchestratorCta,
} from "@/lib/orchestrator/service";

// Map orchestrator anchors to their real routes. Discovery stays on the hub;
// the heavy stages each live on their own deep page.
const ANCHOR_TO_HREF: Record<string, "/dashboard" | "/supplier" | "/store" | "/marketing" | "/finance"> = {
  top: "/dashboard",
  discovery: "/dashboard",
  supplier: "/supplier",
  store: "/store",
  marketing: "/marketing",
  finance: "/finance",
};

// Marketing CTAs deep-link to the matching stage so the panel lands focused on
// the right kit instead of the full stacked list.
const MARKETING_CTA_STAGE: Record<string, string> = {
  marketingIntro: "intro_pdf",
  preLaunch: "pre_launch",
  launchKit: "launch",
  refreshKit: "monthly_refresh",
};

export function OrchestratorPanel({
  view,
  coachingOnly = false,
}: {
  view: Orchestration;
  coachingOnly?: boolean;
}) {
  const t = useTranslations("Orchestrator");

  return (
    <div className="space-y-5">
      {/* On the cockpit stages the CTAs are promoted into the hero, so the hub
          renders coaching only to avoid duplicate action buttons. */}
      {!coachingOnly && (
        <div className="surface-card p-5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-display text-base text-ink">{t("nextTitle")}</h2>
            {view.parallel && view.ctas.length > 1 && (
              <span className="rounded-full bg-sea/10 px-2.5 py-0.5 text-[10px] font-semibold text-sea">
                {t("parallelBadge")}
              </span>
            )}
          </div>
          {view.parallel && view.ctas.length > 1 && (
            <p className="mt-1 text-xs text-stone-dark">{t("parallelHint")}</p>
          )}

          <div className="mt-3 space-y-2">
            {view.ctas.length === 0 ? (
              <p className="text-sm text-stone-dark">{t("allDone")}</p>
            ) : (
              view.ctas.map((cta) => <CtaCard key={cta.id} cta={cta} />)
            )}
          </div>
        </div>
      )}

      <div className="surface-card p-5">
        <h2 className="font-display text-base text-ink">{t("coachingTitle")}</h2>
        <ul className="mt-3 space-y-2.5">
          {view.coaching.length === 0 ? (
            <li className="text-sm text-stone-dark">{t("noCoaching")}</li>
          ) : (
            view.coaching.map((c) => <CoachingRow key={c.id} card={c} />)
          )}
        </ul>
      </div>
    </div>
  );
}

function CtaCard({ cta }: { cta: OrchestratorCta }) {
  const t = useTranslations("Orchestrator");
  const toneClass =
    cta.tone === "primary"
      ? "border-cedar/30 bg-cedar/5"
      : cta.tone === "parallel"
        ? "border-sea/30 bg-sea/5"
        : "border-stone bg-surface-subtle";

  const stageQuery =
    cta.anchor === "marketing" ? MARKETING_CTA_STAGE[cta.id] : undefined;
  const baseHref = ANCHOR_TO_HREF[cta.anchor] ?? "/dashboard";
  const href = stageQuery
    ? `/marketing?stage=${stageQuery}`
    : cta.id === "costQuotes"
      ? "/supplier#cost-quotes"
      : baseHref;

  return (
    <Link
      href={href}
      className={`block rounded-lg border p-3 transition hover:shadow-sm ${toneClass}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-ink">
          {t(`cta.${cta.id}.title` as never)}
        </span>
        <span className="text-xs text-stone-dark" aria-hidden>
          →
        </span>
      </div>
      <p className="mt-0.5 text-xs text-stone-dark">
        {t(`cta.${cta.id}.desc` as never)}
      </p>
    </Link>
  );
}

function CoachingRow({ card }: { card: CoachingCard }) {
  const t = useTranslations("Orchestrator");
  const dot =
    card.tone === "safety"
      ? "bg-red-500"
      : card.tone === "margins"
        ? "bg-cedar"
        : card.tone === "budget"
          ? "bg-sea"
          : card.tone === "risk"
            ? "bg-amber-500"
            : "bg-stone-dark";

  return (
    <li className="flex gap-2.5">
      <span className={`mt-1.5 size-2 shrink-0 rounded-full ${dot}`} aria-hidden />
      <div>
        <p className="text-sm font-medium text-ink">
          {t(`coach.${card.id}.title` as never)}
        </p>
        <p className="text-xs text-stone-dark">
          {t(`coach.${card.id}.body` as never)}
        </p>
      </div>
    </li>
  );
}
