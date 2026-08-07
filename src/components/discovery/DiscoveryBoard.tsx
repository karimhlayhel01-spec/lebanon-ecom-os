"use client";

import {
  useActionState,
  useEffect,
  useId,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import {
  acceptProductAction,
  compareWorthConsideringAction,
  continueDiscoveryAction,
  explainWhyThisPickAction,
  refreshSuggestionsAction,
  rejectCandidateAction,
  resolveTier1Action,
  showMoreAction,
  submitDiscoveryPassFeedbackAction,
  type PassFeedbackState,
} from "@/actions/discovery";
import {
  DISCOVERY_COMPARE_MAX,
  DISCOVERY_COMPARE_MIN,
  MARGIN_AFTER_ADS_MIN,
  MARGIN_BEFORE_ADS_MIN,
} from "@/lib/constants";
import {
  revalidateWorthConsideringMarks,
  toggleWorthConsideringMark,
} from "@/lib/discovery/compare/pick";
import {
  COMPARE_CACHE_VERSION,
  WHY_PICK_CACHE_VERSION,
} from "@/lib/discovery/explain/cache";
import { isCompleteCompareBody } from "@/lib/discovery/explain/compare";
import {
  DISCOVERY_PASS_REASONS,
  suggestionsForPassReasons,
  type DiscoveryLadder,
  type DiscoveryPassReason,
} from "@/lib/discovery/ladder";
import { isCompleteSuggestionBody } from "@/lib/discovery/explain/why-pick";
import type {
  DiscoveryCandidateView,
  DiscoveryView,
} from "@/lib/discovery/service";

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

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
  const [refreshPending, startRefresh] = useTransition();
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [markSessionId, setMarkSessionId] = useState(view.sessionId);
  const [worthIds, setWorthIds] = useState<string[]>([]);
  const [worthMaxHint, setWorthMaxHint] = useState(false);
  const [comparePending, startCompare] = useTransition();
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareBody, setCompareBody] = useState<string | null>(null);
  const [compareCacheVersion, setCompareCacheVersion] = useState<string | null>(
    null,
  );
  const [compareHonestyKey, setCompareHonestyKey] = useState<
    | "whySuggestedHonesty"
    | "whySuggestedHonestyLive"
    | "whySuggestedHonestyEstimate"
  >("whySuggestedHonestyEstimate");
  const [compareError, setCompareError] = useState<string | null>(null);
  const [advisedName, setAdvisedName] = useState<string | null>(null);

  // Session-scoped marks: reset on new session; prune rejected/hidden cards.
  if (markSessionId !== view.sessionId) {
    setMarkSessionId(view.sessionId);
    setWorthIds([]);
    setWorthMaxHint(false);
    setCompareOpen(false);
    setCompareBody(null);
    setCompareCacheVersion(null);
    setAdvisedName(null);
    setCompareError(null);
  } else {
    const pruned = revalidateWorthConsideringMarks(
      worthIds,
      view.candidates.map((c) => c.id),
    );
    if (pruned.length !== worthIds.length) {
      setWorthIds(pruned);
    }
  }

  const selectedCards = view.candidates.filter((c) => worthIds.includes(c.id));
  const canCompare =
    selectedCards.length >= DISCOVERY_COMPARE_MIN &&
    selectedCards.length <= DISCOVERY_COMPARE_MAX;

  function toggleWorth(candidateId: string) {
    setWorthMaxHint(false);
    setWorthIds((prev) => {
      const next = toggleWorthConsideringMark(prev, candidateId);
      if (next.blockedAtMax) setWorthMaxHint(true);
      return next.ids;
    });
  }

  function clearWorth() {
    setWorthIds([]);
    setWorthMaxHint(false);
    setCompareOpen(false);
    setCompareBody(null);
    setCompareError(null);
    setAdvisedName(null);
  }

  function runCompare() {
    setCompareError(null);
    setCompareOpen(true);
    const versionOk = compareCacheVersion === COMPARE_CACHE_VERSION;
    const bodyOk =
      Boolean(compareBody) && versionOk && isCompleteCompareBody(compareBody!);
    if (bodyOk && canCompare) return;
    if (compareBody && !bodyOk) {
      setCompareBody(null);
      setCompareCacheVersion(null);
      setAdvisedName(null);
    }
    if (!view.geminiConfigured) {
      setCompareError(t("compareMissingKey"));
      return;
    }
    if (!canCompare) {
      setCompareError(t("compareInvalid"));
      return;
    }
    startCompare(async () => {
      const res = await compareWorthConsideringAction(worthIds);
      const complete =
        Boolean(res.ok && res.body) && isCompleteCompareBody(res.body!);
      if (!res.ok || !res.body || !complete) {
        setCompareBody(null);
        setCompareCacheVersion(null);
        setAdvisedName(null);
        setCompareError(
          res.error === "missing_key" || res.missingKey
            ? t("compareMissingKey")
            : res.error === "rate_limited"
              ? t("whyPickRateLimited")
              : res.error === "feature_off"
                ? t("compareOff")
                : res.error === "stale_selection"
                  ? t("compareStale")
                  : res.error === "invalid_selection"
                    ? t("compareInvalid")
                    : res.error === "api_error"
                      ? t("compareApiError")
                      : t("compareFailed"),
        );
      } else {
        setCompareBody(res.body);
        setCompareCacheVersion(res.cacheVersion ?? COMPARE_CACHE_VERSION);
        setAdvisedName(res.advisedName ?? null);
        setCompareHonestyKey(
          res.honestyKey === "whySuggestedHonestyLive"
            ? "whySuggestedHonestyLive"
            : res.honestyKey === "whySuggestedHonesty"
              ? "whySuggestedHonesty"
              : "whySuggestedHonestyEstimate",
        );
      }
    });
  }

  return (
    <div className="space-y-5 pb-24">
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
          <div className="flex flex-col items-end gap-2">
            <span className="whitespace-nowrap rounded-full border border-stone bg-sand px-3 py-1 text-xs font-medium text-stone-dark">
              {t("sessionCount", {
                shown: view.productsShown,
                cap: view.sessionCap,
              })}
            </span>
            {view.canRefreshSuggestions ? (
              <div className="text-end">
                <button
                  type="button"
                  disabled={refreshPending}
                  title={t("refreshSuggestionsHint")}
                  onClick={() =>
                    startRefresh(async () => {
                      setRefreshError(null);
                      const result = await refreshSuggestionsAction();
                      if (!result.ok) {
                        setRefreshError(
                          result.error === "catalog_exhausted"
                            ? t("refreshSuggestionsExhausted")
                            : t("errorGeneric"),
                        );
                      } else {
                        // New session — clear marks immediately (sessionId effect also clears).
                        setWorthIds([]);
                        setWorthMaxHint(false);
                        setCompareOpen(false);
                        setCompareBody(null);
                        setAdvisedName(null);
                      }
                    })
                  }
                  className="rounded-md border border-stone bg-surface px-3 py-1.5 text-xs font-semibold text-ink transition hover:bg-sand disabled:opacity-60"
                >
                  {refreshPending
                    ? t("refreshSuggestionsPending")
                    : t("refreshSuggestions")}
                </button>
                {refreshError ? (
                  <p className="mt-1 text-xs text-cedar-deep">{refreshError}</p>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {view.editOnboardingBanner ? (
        <EditOnboardingNote banner={view.editOnboardingBanner} />
      ) : null}

      {empty && view.ladder ? (
        <DiscoveryEmptyLadder ladder={view.ladder} view={view} />
      ) : (
        <div className="columns-1 gap-4 md:columns-2">
          {view.candidates.map((c) => (
            <ProductCard
              key={c.id}
              c={c}
              suggestionExplainEnabled={view.suggestionExplainEnabled}
              geminiConfigured={view.geminiConfigured}
              worthConsidering={worthIds.includes(c.id)}
              onToggleWorth={() => toggleWorth(c.id)}
            />
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

      {!empty && view.suggestionExplainEnabled ? (
        <WorthConsideringCompareBox
          selected={selectedCards}
          maxHint={worthMaxHint}
          canCompare={canCompare}
          comparePending={comparePending}
          geminiConfigured={view.geminiConfigured}
          onClear={clearWorth}
          onCompare={runCompare}
        />
      ) : null}

      {compareOpen ? (
        <CompareResultModal
          title={t("compareResultTitle")}
          advisedName={advisedName}
          body={compareBody}
          honesty={t(compareHonestyKey)}
          adviceNote={t("compareAdviceNote")}
          advisedLabel={t("compareAdvisedLabel")}
          error={compareError}
          loading={comparePending}
          loadingLabel={t("compareLoading")}
          closeLabel={t("compareClose")}
          onClose={() => setCompareOpen(false)}
        />
      ) : null}
    </div>
  );
}

function WorthConsideringCompareBox({
  selected,
  maxHint,
  canCompare,
  comparePending,
  geminiConfigured,
  onClear,
  onCompare,
}: {
  selected: DiscoveryCandidateView[];
  maxHint: boolean;
  canCompare: boolean;
  comparePending: boolean;
  geminiConfigured: boolean;
  onClear: () => void;
  onCompare: () => void;
}) {
  const t = useTranslations("Discovery");
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-stone bg-surface/95 px-4 py-3 shadow-[0_-4px_16px_rgba(0,0,0,0.06)] backdrop-blur">
      <div className="mx-auto flex max-w-3xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-stone-dark">
            {t("compareBoxTitle")}
          </p>
          {selected.length === 0 ? (
            <p className="mt-0.5 text-sm text-stone-dark">{t("compareBoxEmpty")}</p>
          ) : (
            <>
              <p className="mt-0.5 text-sm text-ink">
                {t("compareBoxCount", { count: selected.length })}
                {selected.length < DISCOVERY_COMPARE_MIN
                  ? ` — ${t("compareBoxNeedMore")}`
                  : null}
              </p>
              <p className="mt-0.5 truncate text-xs text-stone-dark">
                {selected.map((c) => c.name).join(" · ")}
              </p>
            </>
          )}
          {maxHint ? (
            <p className="mt-1 text-xs text-amber-800">{t("worthConsideringMax")}</p>
          ) : null}
          {!geminiConfigured ? (
            <p className="mt-1 text-xs text-amber-800">{t("compareMissingKey")}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {selected.length > 0 ? (
            <button
              type="button"
              onClick={onClear}
              className="rounded-md border border-stone px-3 py-1.5 text-sm font-medium text-ink transition hover:bg-sand"
            >
              {t("compareClear")}
            </button>
          ) : null}
          <button
            type="button"
            disabled={!canCompare || comparePending || !geminiConfigured}
            onClick={onCompare}
            className="rounded-md bg-cedar px-4 py-1.5 text-sm font-semibold text-foam shadow-sm transition hover:bg-cedar-deep disabled:cursor-not-allowed disabled:opacity-50"
          >
            {comparePending ? t("compareLoading") : t("compareButton")}
          </button>
        </div>
      </div>
    </div>
  );
}

function EditOnboardingNote({
  banner,
}: {
  banner: NonNullable<DiscoveryView["editOnboardingBanner"]>;
}) {
  const t = useTranslations("Discovery");
  const isZero = banner === "zero_accept_ready";
  return (
    <div className="rounded-md border border-sea/30 bg-sea/5 px-4 py-3">
      <p className="text-sm font-medium text-ink">
        {isZero ? t("editOnboardingZeroTitle") : t("editOnboardingThinTitle")}
      </p>
      <p className="mt-1 max-w-2xl text-sm text-stone-dark">
        {isZero ? t("editOnboardingZeroBody") : t("editOnboardingThinBody")}
      </p>
      <Link
        href="/onboarding?edit=1"
        className="mt-3 inline-flex rounded-md border border-stone bg-surface px-4 py-2 text-sm font-semibold text-ink transition hover:bg-sand"
      >
        {t("editOnboardingCta")}
      </Link>
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

function ProductCard({
  c,
  suggestionExplainEnabled,
  geminiConfigured,
  worthConsidering,
  onToggleWorth,
}: {
  c: DiscoveryCandidateView;
  suggestionExplainEnabled: boolean;
  geminiConfigured: boolean;
  worthConsidering: boolean;
  onToggleWorth: () => void;
}) {
  const t = useTranslations("Discovery");
  const note = useDiscoveryNote();
  const ind = useTranslations("Onboarding");
  const [pending, startTransition] = useTransition();
  const [ack, setAck] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [whyBody, setWhyBody] = useState<string | null>(null);
  const [whyCacheVersion, setWhyCacheVersion] = useState<string | null>(null);
  const [whyHonestyKey, setWhyHonestyKey] = useState<
    | "whySuggestedHonesty"
    | "whySuggestedHonestyLive"
    | "whySuggestedHonestyEstimate"
  >("whySuggestedHonestyEstimate");
  const [whyOpen, setWhyOpen] = useState(false);
  const [whyError, setWhyError] = useState<string | null>(null);
  const [whyPending, setWhyPending] = useState(false);

  const blocked = c.oversized || !c.marginsPass;
  const isOkay = c.strength === "Okay";
  const marginBlockCopy = translateMarginBlock(note, t("blockedMargin"), c);
  const riskReadCopy = c.riskRead
    ? note(c.riskRead, { fitScore: c.fitScore })
    : null;
  const systemPass = c.systemDemand?.pass === true;

  function demandPathCopy(): string {
    // No earned path means the deciding evidence leg was neutral-filled —
    // never dress that up as abroad traction or Lebanon demand (WAVE-2 §3.2).
    if (c.systemDemand?.demandPath === "local_proven") {
      return t("demandPathLocal");
    }
    if (c.systemDemand?.demandPath === "whitespace") {
      return t("demandPathWhitespace");
    }
    return t("demandPathUnproven");
  }

  function systemDemandCopy(): string {
    if (systemPass) {
      return t("dualGateSystemPass", { path: demandPathCopy() });
    }
    if (c.systemDemand?.status === "missing") {
      if (c.systemDemand?.reason === "score_refresh_failed") {
        return t.has("dualGateSystemFailedRefresh")
          ? t("dualGateSystemFailedRefresh")
          : t("dualGateSystemMissing");
      }
      return t("dualGateSystemMissing");
    }
    return t("dualGateSystemFail");
  }

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

  function whySuggested() {
    setWhyError(null);
    setWhyOpen(true);
    const versionOk = whyCacheVersion === WHY_PICK_CACHE_VERSION;
    const bodyOk =
      Boolean(whyBody) &&
      versionOk &&
      isCompleteSuggestionBody(whyBody!);
    if (bodyOk) return;
    if (whyBody && !bodyOk) {
      setWhyBody(null);
      setWhyCacheVersion(null);
    }
    if (!geminiConfigured) {
      setWhyError(t("whySuggestedMissingKey"));
      return;
    }
    setWhyPending(true);
    startTransition(async () => {
      try {
        const res = await explainWhyThisPickAction(c.id);
        const complete =
          Boolean(res.ok && res.body) &&
          isCompleteSuggestionBody(res.body!);
        if (!res.ok || !res.body || !complete) {
          setWhyBody(null);
          setWhyCacheVersion(null);
          setWhyError(
            res.error === "missing_key" || res.missingKey
              ? t("whySuggestedMissingKey")
              : res.error === "rate_limited"
                ? t("whyPickRateLimited")
                : res.error === "feature_off"
                  ? t("whySuggestedOff")
                  : res.error === "api_error"
                    ? t("whySuggestedApiError")
                    : // Wording we could not verify vs a paragraph that came
                      // back unfinished — the founder should be able to tell.
                      res.error === "ungrounded" ||
                        res.error === "okay_mismatch"
                      ? t("whySuggestedUnverified")
                      : res.error === "incomplete" ||
                          res.error === "empty" ||
                          (Boolean(res.ok) && !complete)
                        ? t("whySuggestedIncomplete")
                        : t("errorGeneric"),
          );
        } else {
          setWhyBody(res.body);
          setWhyCacheVersion(res.cacheVersion ?? WHY_PICK_CACHE_VERSION);
          setWhyHonestyKey(
            res.honestyKey === "whySuggestedHonestyLive"
              ? "whySuggestedHonestyLive"
              : res.honestyKey === "whySuggestedHonesty"
                ? "whySuggestedHonesty"
                : "whySuggestedHonestyEstimate",
          );
        }
      } finally {
        setWhyPending(false);
      }
    });
  }

  function closeWhySuggested() {
    setWhyOpen(false);
  }

  const errorMsg =
    actionError === "needs_risk_ack"
      ? t("acceptOkayHint")
      : actionError === "needs_system_demand_missing" ||
          actionError === "needs_system_demand"
        ? t("acceptNeedsSystemDemandMissing")
        : actionError === "needs_system_demand_weak"
          ? t("acceptNeedsSystemDemandWeak")
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

      {suggestionExplainEnabled ? (
        <label className="flex items-start gap-2 text-xs text-ink">
          <input
            type="checkbox"
            checked={worthConsidering}
            onChange={onToggleWorth}
            className="mt-0.5 size-4 accent-cedar"
          />
          <span>{t("worthConsidering")}</span>
        </label>
      ) : null}

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

      {/* System demand status (accept gate) — no founder paste */}
      {c.systemDemandGate && (
        <div
          className={`rounded-md border px-3 py-2 text-xs ${
            systemPass
              ? "border-stone bg-surface-subtle"
              : "border-amber-300 bg-amber-50 text-amber-900"
          }`}
        >
          <p className="font-semibold text-ink">{t("systemDemandTitle")}</p>
          <p className={`mt-1 ${systemPass ? "text-stone-dark" : ""}`}>
            {systemDemandCopy()}
          </p>
        </div>
      )}

      {/* §6.1 Why we suggested this — modal with full Gemini copy */}
      {suggestionExplainEnabled && (
        <div className="text-xs">
          {!geminiConfigured ? (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900">
              <p className="font-semibold text-ink">{t("whySuggestedTitle")}</p>
              <p className="mt-1 text-sm leading-relaxed">
                {t("whySuggestedMissingKey")}
              </p>
            </div>
          ) : (
            <button
              type="button"
              disabled={whyPending || pending}
              onClick={whySuggested}
              className="rounded-md border border-stone px-2.5 py-1 font-medium text-ink transition hover:bg-sand disabled:opacity-60"
            >
              {t("whySuggestedButton")}
            </button>
          )}
          {whyOpen && (
            <WhySuggestedModal
              title={t("whySuggestedTitle")}
              body={whyBody}
              honesty={t(whyHonestyKey)}
              error={whyError}
              loading={whyPending}
              loadingLabel={t("whySuggestedLoading")}
              closeLabel={t("whySuggestedClose")}
              onClose={closeWhySuggested}
            />
          )}
        </div>
      )}

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

/** Portal target only exists on the client; keep SSR and first paint aligned. */
const subscribeNoop = () => () => {};
const getMountedClient = () => true;
const getMountedServer = () => false;

function WhySuggestedModal({
  title,
  body,
  honesty,
  error,
  loading,
  loadingLabel,
  closeLabel,
  onClose,
}: {
  title: string;
  body: string | null;
  honesty: string;
  error: string | null;
  loading: boolean;
  loadingLabel: string;
  closeLabel: string;
  onClose: () => void;
}) {
  const titleId = useId();
  const mounted = useSyncExternalStore(
    subscribeNoop,
    getMountedClient,
    getMountedServer,
  );
  const displayBody =
    body && isCompleteSuggestionBody(body) ? body : null;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[90]" role="presentation">
      <button
        type="button"
        aria-label={closeLabel}
        className="absolute inset-0 bg-ink/40"
        onClick={onClose}
      />
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className="pointer-events-auto w-full max-w-md rounded-lg border border-stone bg-surface p-5 shadow-sm"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-3">
            <h2
              id={titleId}
              className="font-display text-lg font-semibold text-ink"
            >
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label={closeLabel}
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-ink transition hover:bg-sand"
            >
              <span aria-hidden className="text-xl leading-none">
                ×
              </span>
            </button>
          </div>

          <div className="mt-3">
            {loading && !displayBody && !error ? (
              <p className="text-sm text-stone-dark">{loadingLabel}</p>
            ) : null}
            {error ? (
              <p className="text-sm leading-relaxed text-amber-800">{error}</p>
            ) : null}
            {displayBody ? (
              <p className="text-sm leading-relaxed text-ink whitespace-normal">
                {displayBody}
              </p>
            ) : null}
            {displayBody && (
              <p className="mt-3 text-xs leading-relaxed text-stone-dark">
                {honesty}
              </p>
            )}
          </div>

          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-stone px-3 py-1.5 text-sm font-medium text-ink transition hover:bg-sand"
            >
              {closeLabel}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function CompareResultModal({
  title,
  advisedName,
  advisedLabel,
  adviceNote,
  body,
  honesty,
  error,
  loading,
  loadingLabel,
  closeLabel,
  onClose,
}: {
  title: string;
  advisedName: string | null;
  advisedLabel: string;
  adviceNote: string;
  body: string | null;
  honesty: string;
  error: string | null;
  loading: boolean;
  loadingLabel: string;
  closeLabel: string;
  onClose: () => void;
}) {
  const titleId = useId();
  const mounted = useSyncExternalStore(
    subscribeNoop,
    getMountedClient,
    getMountedServer,
  );
  const displayBody = body && isCompleteCompareBody(body) ? body : null;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[90]" role="presentation">
      <button
        type="button"
        aria-label={closeLabel}
        className="absolute inset-0 bg-ink/40"
        onClick={onClose}
      />
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className="pointer-events-auto w-full max-w-lg rounded-lg border border-stone bg-surface p-5 shadow-sm"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-3">
            <h2
              id={titleId}
              className="font-display text-lg font-semibold text-ink"
            >
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label={closeLabel}
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-ink transition hover:bg-sand"
            >
              <span aria-hidden className="text-xl leading-none">
                ×
              </span>
            </button>
          </div>

          <div className="mt-3 space-y-3">
            {loading && !displayBody && !error ? (
              <p className="text-sm text-stone-dark">{loadingLabel}</p>
            ) : null}
            {error ? (
              <p className="text-sm leading-relaxed text-amber-800">{error}</p>
            ) : null}
            {advisedName && displayBody ? (
              <p className="rounded-md border border-cedar/30 bg-cedar/10 px-3 py-2 text-sm text-cedar-deep">
                <span className="font-semibold">{advisedLabel}: </span>
                {advisedName}
              </p>
            ) : null}
            {displayBody ? (
              <p className="text-sm leading-relaxed text-ink whitespace-normal">
                {displayBody}
              </p>
            ) : null}
            {displayBody ? (
              <>
                <p className="text-xs leading-relaxed text-stone-dark">
                  {honesty}
                </p>
                <p className="text-xs leading-relaxed text-stone-dark">
                  {adviceNote}
                </p>
              </>
            ) : null}
          </div>

          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-stone px-3 py-1.5 text-sm font-medium text-ink transition hover:bg-sand"
            >
              {closeLabel}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
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
      {strong ? t("recommendationStrong") : t("recommendationOkay")}
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
