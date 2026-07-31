"use client";

import { useActionState, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import {
  acceptProductAction,
  confirmDemandAction,
  continueDiscoveryAction,
  rejectCandidateAction,
  resolveTier1Action,
  showMoreAction,
  submitDiscoveryPassFeedbackAction,
  type DemandActionState,
  type PassFeedbackState,
} from "@/actions/discovery";
import {
  MARGIN_AFTER_ADS_MIN,
  MARGIN_BEFORE_ADS_MIN,
} from "@/lib/constants";
import {
  DISCOVERY_PASS_REASONS,
  suggestionsForPassReasons,
  type DiscoveryLadder,
  type DiscoveryPassReason,
} from "@/lib/discovery/ladder";
import type {
  DiscoveryCandidateView,
  DiscoveryView,
} from "@/lib/discovery/service";

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

const demandInitial: DemandActionState = {};

/** Translate `@fit.*` / `@margin.*` note keys; legacy English falls through as-is. */
function useDiscoveryNote() {
  const t = useTranslations("Discovery");
  return (key: string, values?: Record<string, string | number>) =>
    key.startsWith("@")
      ? t(`notes.${key.slice(1)}` as never, values as never)
      : key;
}

function translateMarginBlock(
  note: (key: string, values?: Record<string, string | number>) => string,
  fallback: string,
  c: DiscoveryCandidateView,
): string {
  const raw = c.marginBlockReason;
  if (!raw) return fallback;
  const minBefore = pct(MARGIN_BEFORE_ADS_MIN);
  const minAfter = pct(MARGIN_AFTER_ADS_MIN);
  return raw
    .split(/\s+/)
    .filter(Boolean)
    .map((key) => {
      if (key === "@margin.failBefore") {
        return note(key, { value: pct(c.marginBefore), min: minBefore });
      }
      if (key === "@margin.failAfter") {
        return note(key, { value: pct(c.marginAfter), min: minAfter });
      }
      return note(key);
    })
    .join(" ");
}

const passFeedbackInitial: PassFeedbackState = {};

export function DiscoveryBoard({
  view,
  mode = "first",
}: {
  view: DiscoveryView;
  /** `addSku` = another product while live SKUs continue (not a shop reset). */
  mode?: "first" | "addSku";
}) {
  const t = useTranslations("Discovery");
  const empty = view.candidates.length === 0;
  const isAdd = mode === "addSku";

  return (
    <div className="space-y-5">
      <div className="surface-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            {isAdd ? (
              <p className="text-xs font-medium uppercase tracking-wide text-stone-dark">
                {t("addSkuKicker")}
              </p>
            ) : null}
            <h2
              className={`font-display text-lg text-ink ${isAdd ? "mt-0.5" : ""}`}
            >
              {isAdd ? t("addSkuTitle") : t("title")}
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-stone-dark">
              {isAdd ? t("addSkuIntro") : t("intro")}
            </p>
          </div>
          <span className="whitespace-nowrap rounded-full border border-stone bg-sand px-3 py-1 text-xs font-medium text-stone-dark">
            {t("sessionCount", {
              shown: view.productsShown,
              cap: view.sessionCap,
            })}
          </span>
        </div>
      </div>

      {empty && view.ladder ? (
        <DiscoveryEmptyLadder ladder={view.ladder} view={view} />
      ) : (
        <div className="columns-1 gap-4 md:columns-2">
          {view.candidates.map((c) => (
            <ProductCard key={c.id} c={c} />
          ))}
        </div>
      )}

      {!empty && (
        <div className="flex items-center justify-center gap-3 pt-1">
          {view.canShowMore ? (
            <form action={showMoreAction}>
              <button
                type="submit"
                className="rounded-md border border-stone bg-surface px-5 py-2.5 text-sm font-semibold text-ink transition hover:bg-sand"
              >
                {t("showMore")}
                <span className="ms-2 text-stone-dark">
                  {t("showMoreRemaining", {
                    remaining: view.showMoreRemaining,
                  })}
                </span>
              </button>
            </form>
          ) : (
            <p className="text-sm text-stone-dark">{t("noMore")}</p>
          )}
        </div>
      )}
    </div>
  );
}

function DiscoveryEmptyLadder({
  ladder,
  view,
}: {
  ladder: DiscoveryLadder;
  view: DiscoveryView;
}) {
  const t = useTranslations("Discovery");
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<DiscoveryPassReason[]>([]);
  const [feedbackState, feedbackAction, feedbackPending] = useActionState(
    submitDiscoveryPassFeedbackAction,
    passFeedbackInitial,
  );

  const suggestionKeys =
    selected.length > 0 ? suggestionsForPassReasons(selected) : [];

  function toggleReason(reason: DiscoveryPassReason) {
    setSelected((prev) =>
      prev.includes(reason)
        ? prev.filter((r) => r !== reason)
        : [...prev, reason],
    );
  }

  if (ladder === "show_more") {
    return (
      <div className="surface-card p-6 text-center">
        <h3 className="font-display text-lg text-ink">
          {t("emptyShowMoreTitle")}
        </h3>
        <p className="mx-auto mt-2 max-w-md text-sm text-stone-dark">
          {t("emptyShowMoreBody")}
        </p>
        <form action={showMoreAction} className="mt-4">
          <button
            type="submit"
            className="rounded-md bg-cedar px-5 py-2.5 text-sm font-semibold text-foam shadow-sm transition hover:bg-cedar-deep"
          >
            {t("showMore")}
            <span className="ms-2 opacity-90">
              {t("showMoreRemaining", { remaining: view.showMoreRemaining })}
            </span>
          </button>
        </form>
      </div>
    );
  }

  if (ladder === "continue") {
    return (
      <div className="surface-card p-6 text-center">
        <h3 className="font-display text-lg text-ink">
          {t("emptyContinueTitle")}
        </h3>
        <p className="mx-auto mt-2 max-w-lg text-sm text-stone-dark">
          {t("emptyContinueBody")}
        </p>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              await continueDiscoveryAction();
            })
          }
          className="mt-4 rounded-md bg-cedar px-5 py-2.5 text-sm font-semibold text-foam shadow-sm transition hover:bg-cedar-deep disabled:opacity-60"
        >
          {t("continueDiscovery")}
        </button>
      </div>
    );
  }

  if (ladder === "why_pass") {
    return (
      <div className="surface-card p-6">
        <h3 className="font-display text-lg text-ink">{t("emptyWhyTitle")}</h3>
        <p className="mt-2 max-w-2xl text-sm text-stone-dark">
          {t("emptyWhyBody")}
        </p>

        {feedbackState.ok ? (
          <p className="mt-4 text-sm font-medium text-cedar-deep">
            {t("whySaved")}
          </p>
        ) : (
          <form action={feedbackAction} className="mt-4 space-y-4">
            <div className="grid gap-2 sm:grid-cols-2">
              {DISCOVERY_PASS_REASONS.map((reason) => (
                <label
                  key={reason}
                  className="flex items-start gap-2 rounded-md border border-stone bg-surface-subtle px-3 py-2 text-sm text-ink"
                >
                  <input
                    type="checkbox"
                    name={`reason_${reason}`}
                    checked={selected.includes(reason)}
                    onChange={() => toggleReason(reason)}
                    className="mt-0.5 size-4 accent-cedar"
                  />
                  <span>{t(`whyReason_${reason}` as never)}</span>
                </label>
              ))}
            </div>

            {(selected.includes("other") || selected.length > 0) && (
              <label className="block text-xs text-stone-dark">
                {t("whyOtherNote")}
                <textarea
                  name="otherNote"
                  rows={2}
                  placeholder={t("whyOtherPlaceholder")}
                  className="mt-1 w-full rounded-md border border-stone bg-surface px-2.5 py-2 text-sm outline-none focus:border-cedar"
                />
              </label>
            )}

            {suggestionKeys.length > 0 && (
              <div className="rounded-md border border-sea/30 bg-sea/5 px-3 py-2 text-xs text-sea">
                <p className="font-semibold">{t("whySuggestionsTitle")}</p>
                <ul className="mt-1.5 list-inside list-disc space-y-0.5">
                  {suggestionKeys.map((key) => (
                    <li key={key}>
                      {t(`whySuggestion_${key}` as never)}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {feedbackState.error === "empty" && (
              <p className="text-xs text-amber-800">{t("whyEmpty")}</p>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="submit"
                disabled={feedbackPending}
                className="rounded-md bg-cedar px-4 py-2 text-sm font-semibold text-foam shadow-sm transition hover:bg-cedar-deep disabled:opacity-60"
              >
                {t("whySubmit")}
              </button>
              <Link
                href="/onboarding?edit=1"
                className="rounded-md border border-stone px-4 py-2 text-sm font-medium text-ink transition hover:bg-sand"
              >
                {t("editOnboardingCta")}
              </Link>
            </div>
          </form>
        )}

        {feedbackState.ok && (
          <Link
            href="/onboarding?edit=1"
            className="mt-4 inline-flex rounded-md bg-cedar px-4 py-2 text-sm font-semibold text-foam shadow-sm transition hover:bg-cedar-deep"
          >
            {t("editOnboardingCta")}
          </Link>
        )}
      </div>
    );
  }

  // catalog_exhausted (D)
  return (
    <div className="surface-card p-6 text-center">
      <h3 className="font-display text-lg text-ink">{t("emptyCatalogTitle")}</h3>
      <p className="mx-auto mt-2 max-w-lg text-sm text-stone-dark">
        {t("emptyCatalogBody")}
      </p>
      <Link
        href="/onboarding?edit=1"
        className="mt-4 inline-flex rounded-md bg-cedar px-5 py-2.5 text-sm font-semibold text-foam shadow-sm transition hover:bg-cedar-deep"
      >
        {t("editOnboardingCta")}
      </Link>
    </div>
  );
}

function ProductCard({ c }: { c: DiscoveryCandidateView }) {
  const t = useTranslations("Discovery");
  const note = useDiscoveryNote();
  const ind = useTranslations("Onboarding");
  const [pending, startTransition] = useTransition();
  const [demandOpen, setDemandOpen] = useState(false);
  const [ack, setAck] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [demandState, demandFormAction, demandPending] = useActionState(
    confirmDemandAction,
    demandInitial,
  );

  const blocked = c.oversized || !c.marginsPass;
  const isOkay = c.strength === "Okay";
  const marginBlockCopy = translateMarginBlock(note, t("blockedMargin"), c);
  const riskReadCopy = c.riskRead ? note(c.riskRead) : null;

  function accept() {
    setActionError(null);
    startTransition(async () => {
      const res = await acceptProductAction(c.id, ack);
      if (!res.ok) setActionError(res.error);
    });
  }

  function reject() {
    startTransition(async () => {
      await rejectCandidateAction(c.id);
    });
  }

  function tier1(choice: "customize" | "drop") {
    startTransition(async () => {
      await resolveTier1Action(c.id, choice);
    });
  }

  const errorMsg =
    actionError === "needs_risk_ack"
      ? t("acceptOkayHint")
      : actionError === "needs_demand"
        ? t("acceptNeedsDemand")
        : actionError === "tier1_unresolved"
          ? t("acceptNeedsTier1")
          : actionError === "blocked"
            ? t("acceptBlocked")
            : actionError
              ? t("errorGeneric")
              : null;

  return (
    <article
      className={`surface-card mb-4 flex break-inside-avoid flex-col gap-3 p-5 ${
        blocked ? "opacity-95" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-base text-ink">{c.name}</h3>
          <p className="mt-0.5 text-xs text-stone-dark">
            {ind(`industries.${c.category}`)}
          </p>
        </div>
        <StrengthBadge strength={c.strength} notRecommended={c.notRecommended} />
      </div>

      <p className="text-sm text-stone-dark">{c.summary}</p>

      <div className="flex flex-wrap gap-2 text-xs">
        <span className="rounded-md bg-sand px-2 py-1 font-medium text-ink">
          {t("fit")} {c.fitScore}
        </span>
        <span className="rounded-md bg-sand px-2 py-1 text-stone-dark">
          {t("sellPrice")} ${c.sellPrice}
        </span>
        <span className="rounded-md bg-sand px-2 py-1 text-stone-dark">
          {t("landedCost")} ${c.landedCost}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <MarginPill label={t("marginBefore")} value={c.marginBefore} pass={c.marginsPass} />
        <MarginPill label={t("marginAfter")} value={c.marginAfter} pass={c.marginsPass} />
      </div>
      <p className="text-[11px] text-stone-dark">{t("estimateNote")}</p>

      {c.sourceCostHint && (
        <div className="rounded-md border border-stone bg-surface-subtle px-3 py-2 text-[11px] text-stone-dark">
          <p className="font-medium text-ink">{t("sourceCostHintTitle")}</p>
          <p className="mt-1">
            {t("sourceCostHintBody", {
              importLanded: c.sourceCostHint.importLanded.toFixed(2),
              localLanded: c.sourceCostHint.localLanded.toFixed(2),
              importMargin: Math.round(c.sourceCostHint.importMarginBefore * 100),
              localMargin: Math.round(c.sourceCostHint.localMarginBefore * 100),
            })}
          </p>
          <p className="mt-1 text-[10px]">{t("sourceCostHintNote")}</p>
        </div>
      )}

      {blocked && (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <span className="font-semibold">{t("blocked")}: </span>
          {c.oversized ? t("blockedOversized") : marginBlockCopy}
        </p>
      )}

      <div className="rounded-md border border-stone bg-surface-subtle px-3 py-2 text-xs text-stone-dark">
        <span className="font-medium text-ink">{t("differentiation")}: </span>
        {c.differentiation}
      </div>

      {/* Demand */}
      <div className="text-xs">
        <div className="flex items-center justify-between gap-2">
          <span className="text-stone-dark">
            {t("demand")}:{" "}
            {c.demandConfirmed || demandState.ok ? (
              <span className="font-semibold text-cedar-deep">
                {t("demandConfirmed")}
              </span>
            ) : (
              <span className="text-stone-dark">{t("demandNeeded")}</span>
            )}
          </span>
          {!c.demandConfirmed && !demandState.ok && !blocked && (
            <button
              type="button"
              onClick={() => setDemandOpen((v) => !v)}
              className="rounded-md border border-stone px-2.5 py-1 font-medium text-ink transition hover:bg-sand"
            >
              {t("confirmDemand")}
            </button>
          )}
        </div>

        {/* Saved / just-confirmed demand summary (not a hollow "Confirmed" badge). */}
        {(c.demandSummary || (demandState.ok && demandState.summary)) && (
          <div className="mt-2 rounded-md border border-cedar/25 bg-cedar/5 px-3 py-2">
            <p className="font-semibold text-cedar-deep">
              {t("demandSummaryTitle")}
            </p>
            <p className="mt-1 text-sm leading-relaxed text-ink">
              {c.demandSummary ?? demandState.summary}
            </p>
            <p className="mt-1.5 text-[11px] text-stone-dark">
              {t("demandHonesty")}
            </p>
          </div>
        )}

        {demandOpen && !c.demandConfirmed && !demandState.ok && (
          <form
            action={demandFormAction}
            className="mt-2 flex flex-col gap-2 rounded-md border border-stone bg-surface p-3"
          >
            <input type="hidden" name="candidateId" value={c.id} />
            <input
              name="url"
              placeholder={t("demandUrl")}
              className="rounded-md border border-stone px-2.5 py-2 outline-none focus:border-cedar"
            />
            <input
              name="note"
              placeholder={t("demandNote")}
              className="rounded-md border border-stone px-2.5 py-2 outline-none focus:border-cedar"
            />
            <input
              name="screenshotNote"
              placeholder={t("demandScreenshot")}
              className="rounded-md border border-stone px-2.5 py-2 outline-none focus:border-cedar"
            />
            {demandState.error && (
              <p className="text-amber-800">
                {demandState.error === "empty_signal"
                  ? t("demandEmpty")
                  : t("errorGeneric")}
              </p>
            )}
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={demandPending}
                className="rounded-md bg-cedar px-3 py-1.5 font-semibold text-foam transition hover:bg-cedar-deep disabled:opacity-60"
              >
                {t("demandSubmit")}
              </button>
              <button
                type="button"
                onClick={() => setDemandOpen(false)}
                className="rounded-md border border-stone px-3 py-1.5 font-medium text-ink transition hover:bg-sand"
              >
                {t("cancel")}
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Tier-1 conflict */}
      {c.tier1Conflict && (
        <div className="rounded-md border border-sea/30 bg-sea/5 px-3 py-2 text-xs">
          <p className="font-semibold text-sea">{t("tier1Title")}</p>
          <p className="mt-1 text-stone-dark">
            {t("tier1Body", { markets: c.tier1Marketplaces.join(", ") })}
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => tier1("customize")}
              className="rounded-md border border-sea/40 px-2.5 py-1 font-medium text-sea transition hover:bg-sea/10 disabled:opacity-60"
            >
              {t("tier1Customize")}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => tier1("drop")}
              className="rounded-md border border-stone px-2.5 py-1 font-medium text-ink transition hover:bg-sand disabled:opacity-60"
            >
              {t("tier1Drop")}
            </button>
          </div>
        </div>
      )}

      {/* Risk read (Okay only) */}
      {isOkay && riskReadCopy && !blocked && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <p className="font-semibold">{t("riskReadTitle")}</p>
          <p className="mt-1">{riskReadCopy}</p>
          <label className="mt-2 flex items-start gap-2">
            <input
              type="checkbox"
              checked={ack}
              onChange={(e) => setAck(e.target.checked)}
              className="mt-0.5 size-4 accent-cedar"
            />
            <span>{t("riskAck")}</span>
          </label>
        </div>
      )}

      {errorMsg && <p className="text-xs text-amber-800">{errorMsg}</p>}

      <div className="mt-1 flex items-center gap-2">
        <button
          type="button"
          disabled={pending || blocked}
          onClick={accept}
          className="rounded-md bg-cedar px-4 py-2 text-sm font-semibold text-foam shadow-sm transition hover:bg-cedar-deep disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t("accept")}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={reject}
          className="rounded-md border border-stone px-4 py-2 text-sm font-medium text-ink transition hover:bg-sand disabled:opacity-60"
        >
          {t("reject")}
        </button>
      </div>
    </article>
  );
}

function StrengthBadge({
  strength,
  notRecommended,
}: {
  strength: "Strong" | "Okay";
  notRecommended: boolean;
}) {
  const t = useTranslations("Discovery");
  if (notRecommended) {
    return (
      <span className="whitespace-nowrap rounded-full border border-stone bg-sand px-2.5 py-1 text-xs font-semibold text-stone-dark">
        {t("notRecommended")}
      </span>
    );
  }
  const strong = strength === "Strong";
  return (
    <span
      className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${
        strong
          ? "border border-cedar/30 bg-cedar/10 text-cedar-deep"
          : "border border-amber-300 bg-amber-50 text-amber-900"
      }`}
    >
      {strong ? t("strengthStrong") : t("strengthOkay")}
    </span>
  );
}

function MarginPill({
  label,
  value,
  pass,
}: {
  label: string;
  value: number;
  pass: boolean;
}) {
  return (
    <span
      className={`flex items-center justify-between rounded-md px-2 py-1 ${
        pass ? "bg-cedar/10 text-cedar-deep" : "bg-amber-50 text-amber-900"
      }`}
    >
      <span className="text-[11px]">{label}</span>
      <span className="font-semibold">{pct(value)}</span>
    </span>
  );
}
