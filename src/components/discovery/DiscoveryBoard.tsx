"use client";

import { useActionState, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import {
  acceptProductAction,
  confirmDemandAction,
  rejectCandidateAction,
  resolveTier1Action,
  showMoreAction,
  type DemandActionState,
} from "@/actions/discovery";
import type {
  DiscoveryCandidateView,
  DiscoveryView,
} from "@/lib/discovery/service";

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

const demandInitial: DemandActionState = {};

export function DiscoveryBoard({ view }: { view: DiscoveryView }) {
  const t = useTranslations("Discovery");

  return (
    <div className="space-y-5">
      <div className="surface-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-lg text-ink">{t("title")}</h2>
            <p className="mt-1 max-w-2xl text-sm text-stone-dark">
              {t("intro")}
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

      <div className="grid gap-4 md:grid-cols-2">
        {view.candidates.map((c) => (
          <ProductCard key={c.id} c={c} />
        ))}
      </div>

      <div className="flex items-center justify-center gap-3 pt-1">
        {view.canShowMore ? (
          <form action={showMoreAction}>
            <button
              type="submit"
              className="rounded-md border border-stone bg-surface px-5 py-2.5 text-sm font-semibold text-ink transition hover:bg-sand"
            >
              {t("showMore")}
              <span className="ms-2 text-stone-dark">
                {t("showMoreRemaining", { remaining: view.showMoreRemaining })}
              </span>
            </button>
          </form>
        ) : (
          <p className="text-sm text-stone-dark">{t("noMore")}</p>
        )}
      </div>
    </div>
  );
}

function ProductCard({ c }: { c: DiscoveryCandidateView }) {
  const t = useTranslations("Discovery");
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
      className={`surface-card flex flex-col gap-3 p-5 ${
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

      {blocked && (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <span className="font-semibold">{t("blocked")}: </span>
          {c.oversized ? t("blockedOversized") : t("blockedMargin")}
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
            {c.demandConfirmed ? (
              <span className="font-semibold text-cedar-deep">
                {t("demandConfirmed")}
              </span>
            ) : (
              <span className="text-stone-dark">{t("demandNeeded")}</span>
            )}
          </span>
          {!c.demandConfirmed && !blocked && (
            <button
              type="button"
              onClick={() => setDemandOpen((v) => !v)}
              className="rounded-md border border-stone px-2.5 py-1 font-medium text-ink transition hover:bg-sand"
            >
              {t("confirmDemand")}
            </button>
          )}
        </div>

        {demandOpen && !c.demandConfirmed && (
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
      {isOkay && c.riskRead && !blocked && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <p className="font-semibold">{t("riskReadTitle")}</p>
          <p className="mt-1">{c.riskRead}</p>
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
