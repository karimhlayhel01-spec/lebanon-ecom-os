"use client";

import { useActionState, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import {
  addWeeklyEntryAction,
  startSellingAction,
  type WeeklyEntryState,
} from "@/actions/finance";
import type {
  CurrentActualView,
  FinancePanelView,
  InvestNextView,
  WeeklyEntryView,
  WeeklyHealth,
  WeeklyMargins,
} from "@/lib/finance/service";
import { MarginLegend } from "@/components/margins/MarginLegend";
import { MARGIN_AFTER_ADS_MIN, MARGIN_BEFORE_ADS_MIN } from "@/lib/constants";

function pct(fraction: number | null): string {
  return fraction == null ? "—" : `${Math.round(fraction * 100)}%`;
}

/** One-decimal percent for the hero + breakdown, so values near a threshold
 *  (e.g. 69.6%) don't round to the threshold while showing an under-threshold
 *  warning. Pass/fail is decided on the raw fraction in the service, not here. */
function pct1(fraction: number | null): string {
  return fraction == null ? "—" : `${(fraction * 100).toFixed(1)}%`;
}

/** Whole-dollar money for aggregate rows (thousands separated). */
function money(value: number): string {
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

/** Cents-precision money for per-unit figures. */
function money2(value: number): string {
  return `$${value.toFixed(2)}`;
}

const entryInitial: WeeklyEntryState = {};

function useFinNote() {
  const t = useTranslations("Finance");
  return (key: string) =>
    key.startsWith("@") ? t(`notes.${key.slice(1)}` as never) : key;
}

export function FinancePanel({ view }: { view: FinancePanelView }) {
  const t = useTranslations("Finance");

  return (
    <div className="surface-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-stone-dark">
            {t("kicker")}
          </p>
          <h2 className="mt-0.5 font-display text-lg text-ink">{t("title")}</h2>
          <p className="mt-1 max-w-2xl text-sm text-stone-dark">{t("intro")}</p>
        </div>
        <span
          className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold ${
            view.mode === "live"
              ? "border border-cedar/30 bg-cedar/10 text-cedar-deep"
              : "border border-amber-300 bg-amber-50 text-amber-900"
          }`}
        >
          {view.mode === "live" ? t("live") : t("preview")}
        </span>
      </div>

      {view.mode === "preview" ? (
        <PreviewBlock view={view} />
      ) : (
        <LiveBlock view={view} />
      )}
    </div>
  );
}

function PreviewBlock({ view }: { view: FinancePanelView }) {
  const t = useTranslations("Finance");
  const [pending, startTransition] = useTransition();

  return (
    <div className="mt-4">
      <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
        {t("previewNote")}
      </div>

      {view.previewSample && (
        <div className="mt-3 opacity-90">
          <p className="text-xs font-semibold uppercase tracking-wide text-stone-dark">
            {t("previewSampleTitle")}
          </p>
          <EntryRow entry={view.previewSample} sample />
        </div>
      )}

      <div className="mt-4 border-t border-stone pt-4">
        <button
          type="button"
          disabled={pending || !view.canStartSelling}
          onClick={() =>
            startTransition(async () => {
              await startSellingAction();
            })
          }
          className="rounded-md bg-cedar px-4 py-2 text-sm font-semibold text-foam shadow-sm transition hover:bg-cedar-deep disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t("startSelling")}
        </button>
        <p className="mt-1.5 text-xs text-stone-dark">
          {view.canStartSelling ? t("startSellingHint") : t("startSellingLocked")}
        </p>
      </div>
    </div>
  );
}

function LiveBlock({ view }: { view: FinancePanelView }) {
  const t = useTranslations("Finance");
  const [state, formAction, pending] = useActionState(
    addWeeklyEntryAction,
    entryInitial,
  );

  const inputs: Array<{ name: string; labelKey: string }> = [
    { name: "sales", labelKey: "fSales" },
    { name: "orders", labelKey: "fOrders" },
    { name: "metaSpend", labelKey: "fMeta" },
    { name: "tiktokSpend", labelKey: "fTiktok" },
    { name: "codCollected", labelKey: "fCodCollected" },
    { name: "codOutstanding", labelKey: "fCodOutstanding" },
    { name: "courierFees", labelKey: "fCourier" },
    { name: "skuSold", labelKey: "fSold" },
    { name: "skuLeft", labelKey: "fLeft" },
  ];

  return (
    <div className="mt-4">
      <CurrentActualStrip
        actual={view.currentActual}
        planningAfter={view.planningMarginAfter}
        expectedBefore={view.expectedMarginBefore}
      />

      {view.investNext ? (
        <InvestNextCard invest={view.investNext} />
      ) : (
        <div className="mt-4 rounded-md border border-sea/30 bg-sea/5 px-3 py-2 text-xs text-sea">
          {t("investLocked", {
            have: view.weekCount,
            need: view.investNextMinWeeks,
          })}
        </div>
      )}

      {/* Weekly entry form */}
      <form
        action={formAction}
        className="mt-4 rounded-lg border border-stone bg-surface-subtle p-4"
      >
        <h3 className="text-sm font-semibold text-ink">{t("addWeekTitle")}</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="text-xs text-stone-dark">
            {t("fWeek")}
            <input
              type="date"
              name="weekStart"
              required
              className="mt-1 w-full rounded-md border border-stone bg-surface px-2.5 py-2 text-sm outline-none focus:border-cedar"
            />
          </label>
          {inputs.map((f) => (
            <label key={f.name} className="text-xs text-stone-dark">
              {t(f.labelKey as never)}
              <input
                type="number"
                name={f.name}
                min={0}
                step="0.01"
                defaultValue={0}
                className="mt-1 w-full rounded-md border border-stone bg-surface px-2.5 py-2 text-sm outline-none focus:border-cedar"
              />
            </label>
          ))}
        </div>
        {state.error && (
          <p className="mt-2 text-xs text-amber-800">
            {state.error === "missing_week"
              ? t("errWeek")
              : state.error === "not_selling"
                ? t("errNotSelling")
                : t("errorGeneric")}
          </p>
        )}
        <button
          type="submit"
          disabled={pending}
          className="mt-3 rounded-md bg-cedar px-4 py-2 text-sm font-semibold text-foam shadow-sm transition hover:bg-cedar-deep disabled:opacity-60"
        >
          {t("addWeek")}
        </button>
      </form>

      {/* Weekly history */}
      <div className="mt-4 space-y-2">
        {view.entries.length === 0 ? (
          <div className="rounded-lg border border-dashed border-stone bg-surface-subtle px-3 py-4 text-center text-sm text-stone-dark">
            {t("emptyActual")}
          </div>
        ) : (
          view.entries
            .slice()
            .reverse()
            .map((e) => <EntryRow key={e.id} entry={e} />)
        )}
      </div>
    </div>
  );
}

function CurrentActualStrip({
  actual,
  planningAfter,
  expectedBefore,
}: {
  actual: CurrentActualView;
  planningAfter: number;
  expectedBefore: number | null;
}) {
  const t = useTranslations("Finance");
  const hasActual = actual.after != null;

  return (
    <div className="rounded-lg border border-cedar/30 bg-surface-subtle p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        {/* Hero: current actual after ads */}
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-dark">
            {t("actualAfterTitle")}
          </p>
          <p
            className={`mt-0.5 font-display text-3xl ${
              actual.belowAfter ? "text-amber-800" : "text-cedar-deep"
            }`}
          >
            {pct1(actual.after)}
          </p>
          <p className="mt-0.5 text-[11px] text-stone-dark">
            {hasActual
              ? t("windowLabel", {
                  weeks: actual.weeks,
                  source: actual.usesQuotes
                    ? t("sourceQuotes")
                    : t("sourceEstimate"),
                })
              : t("actualNoData")}
          </p>
        </div>

        {/* Secondary reference numbers */}
        <div className="flex flex-wrap gap-4 text-xs">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-stone-dark">
              {t("actualBeforeLabel")}
            </div>
            <div
              className={`font-semibold ${
                actual.belowBefore ? "text-amber-800" : "text-ink"
              }`}
            >
              {pct1(actual.before)}
            </div>
          </div>
          {expectedBefore != null && (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-stone-dark">
                {t("expectedBeforeLabel")}
              </div>
              <div className="font-semibold text-ink">
                {pct1(expectedBefore)}
              </div>
            </div>
          )}
          <div>
            <div className="text-[10px] uppercase tracking-wide text-stone-dark">
              {t("planningAfterLabel")}
            </div>
            <div className="font-medium text-stone-dark">
              {pct1(planningAfter)}
            </div>
          </div>
        </div>
      </div>

      {(actual.belowBefore || actual.belowAfter) && (
        <div className="mt-3 space-y-1.5">
          {actual.belowBefore && (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              {t("warnBefore", { min: pct(actual.minBefore) })}
            </div>
          )}
          {actual.belowAfter && (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              {t("warnAfter", { min: pct(actual.minAfter) })}
            </div>
          )}
        </div>
      )}

      {hasActual && <CalcBreakdown actual={actual} />}

      <MarginLegend />
    </div>
  );
}

/** "How we calculated this" — renders the SAME rolling-window dollar aggregates
 *  the service used to derive the hero margins. Purely presentational. */
function CalcBreakdown({ actual }: { actual: CurrentActualView }) {
  const t = useTranslations("Finance");
  const [open, setOpen] = useState(false);
  const source = actual.usesQuotes ? t("sourceQuotes") : t("sourceEstimate");

  return (
    <div className="mt-3 border-t border-stone/70 pt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-1.5 text-xs font-semibold text-cedar-deep transition hover:text-cedar"
      >
        <span
          aria-hidden
          className={`transition-transform ${open ? "rotate-90" : ""}`}
        >
          ▸
        </span>
        {t("calcTitle")}
      </button>

      {open && (
        <div className="mt-3 space-y-3 text-xs">
          <div className="space-y-1">
            <div>
              <CalcRow label={t("bdTotalSales")} value={money(actual.sumSales)} />
              {actual.salesByWeek.length > 1 && (
                <p className="ms-4 mt-0.5 text-[10px] leading-snug text-stone-dark">
                  <span className="font-medium">{t("bdTotalSalesWeeks")}: </span>
                  <span className="tabular-nums">
                    {actual.salesByWeek.map((w) => money(w.sales)).join(" + ")}
                  </span>
                </p>
              )}
            </div>
            <CalcRow
              sign="−"
              label={t("bdImportCogs")}
              hint={t("bdImportCogsHint", {
                perUnit: money2(actual.importCogsPerUnit),
                units: actual.unitsSold,
              })}
              value={money(actual.sumImportCogs)}
            />
            <CalcRow
              sign="−"
              label={t("bdCourier")}
              value={money(actual.sumCourier)}
            />
            <CalcRow
              sign="="
              label={t("bdProfitBefore")}
              value={money(actual.profitBeforeAds)}
              pctLabel={pct1(actual.before)}
              strong
              below={actual.belowBefore}
            />
            <CalcRow sign="−" label={t("bdMeta")} value={money(actual.sumMeta)} />
            <CalcRow
              sign="−"
              label={t("bdTiktok")}
              value={money(actual.sumTiktok)}
            />
            <CalcRow
              sign="="
              label={t("bdProfitAfter")}
              value={money(actual.profitAfterAds)}
              pctLabel={pct1(actual.after)}
              strong
              below={actual.belowAfter}
            />
          </div>

          <p className="rounded-md bg-surface px-3 py-2 font-medium text-stone-dark">
            {t("bdFormula")}
          </p>

          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
            <div>
              <div className="text-[10px] uppercase tracking-wide text-stone-dark">
                {t("bdUnitsSold")}
              </div>
              <div className="font-semibold text-ink">{actual.unitsSold}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-stone-dark">
                {t("bdCostPerUnit")}
              </div>
              <div className="font-semibold text-ink">
                {money2(actual.importCogsPerUnit)}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-stone-dark">
                {t("bdCostSource")}
              </div>
              <div className="font-semibold text-ink">{source}</div>
            </div>
          </div>

          <p className="text-[11px] leading-relaxed text-stone-dark">
            {t("bdDisclaimer")}
          </p>
        </div>
      )}
    </div>
  );
}

function CalcRow({
  label,
  value,
  hint,
  sign,
  pctLabel,
  strong = false,
  below = false,
}: {
  label: string;
  value: string;
  hint?: string;
  sign?: string;
  pctLabel?: string;
  strong?: boolean;
  below?: boolean;
}) {
  return (
    <div
      className={`flex items-baseline justify-between gap-3 ${
        strong ? "border-t border-stone/70 pt-1" : ""
      }`}
    >
      <div className="flex min-w-0 items-baseline gap-1.5">
        <span aria-hidden className="w-3 text-stone-dark">
          {sign ?? ""}
        </span>
        <span className={strong ? "font-semibold text-ink" : "text-stone-dark"}>
          {label}
        </span>
        {hint && <span className="truncate text-[10px] text-stone-dark">{hint}</span>}
      </div>
      <div className="flex shrink-0 items-baseline gap-2 tabular-nums">
        <span
          className={`${strong ? "font-semibold" : ""} ${
            below ? "text-amber-800" : "text-ink"
          }`}
        >
          {value}
        </span>
        {pctLabel && (
          <span
            className={`w-14 text-end font-semibold ${
              below ? "text-amber-800" : "text-cedar-deep"
            }`}
          >
            {pctLabel}
          </span>
        )}
      </div>
    </div>
  );
}

function EntryRow({
  entry,
  sample = false,
}: {
  entry: WeeklyEntryView;
  sample?: boolean;
}) {
  const t = useTranslations("Finance");
  const note = useFinNote();
  const h: WeeklyHealth = entry.health;
  const m: WeeklyMargins = entry.margins;
  const tone =
    h.verdict === "healthy"
      ? "border-cedar/30 bg-cedar/5 text-cedar-deep"
      : h.verdict === "watch"
        ? "border-amber-300 bg-amber-50 text-amber-900"
        : "border-red-300 bg-red-50 text-red-800";

  return (
    <div className="mt-2 rounded-lg border border-stone bg-surface p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium text-ink">
          {sample ? t("previewSampleLabel") : entry.weekStart}
        </span>
        <span
          className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${tone}`}
        >
          {t(`verdict.${h.verdict}` as never)}
        </span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-stone-dark sm:grid-cols-4">
        <Stat label={t("sales")} value={`$${entry.sales}`} />
        <Stat label={t("adSpend")} value={`$${h.adSpend}`} />
        <Stat label={t("courier")} value={`$${entry.courierFees}`} />
        <Stat
          label={t("net")}
          value={`$${h.netProfit}`}
          strong
          negative={h.netProfit < 0}
        />
      </div>

      {/* Actual margins for this week */}
      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 border-t border-stone/70 pt-2 text-xs text-stone-dark sm:grid-cols-4">
        <Stat
          label={t("marginBeforeShort")}
          value={pct(m.before)}
          strong
          negative={m.belowBefore}
        />
        <Stat
          label={t("marginAfterShort")}
          value={pct(m.after)}
          strong
          negative={m.belowAfter}
        />
        <Stat
          label={t("adPerUnit")}
          value={m.adPerUnit == null ? "—" : `$${m.adPerUnit.toFixed(2)}`}
        />
        <Stat
          label={t("costSource")}
          value={m.usesQuotes ? t("sourceQuotes") : t("sourceEstimate")}
        />
      </div>

      {(m.belowBefore || m.belowAfter) && (
        <div className="mt-2 space-y-1 text-[11px] text-amber-900">
          {m.belowBefore && (
            <p className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1">
              {t("warnBefore", { min: pct(MARGIN_BEFORE_ADS_MIN) })}
            </p>
          )}
          {m.belowAfter && (
            <p className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1">
              {t("warnAfter", { min: pct(MARGIN_AFTER_ADS_MIN) })}
            </p>
          )}
        </div>
      )}

      <ul className="mt-2 space-y-0.5 text-[11px] text-stone-dark">
        {h.reasons.map((r, i) => (
          <li key={i} className="flex gap-1.5">
            <span aria-hidden className="text-cedar">
              •
            </span>
            <span>{note(r)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function InvestNextCard({ invest }: { invest: InvestNextView }) {
  const t = useTranslations("Finance");
  const note = useFinNote();
  const tone =
    invest.recommendation === "reinvest"
      ? "border-cedar/40 bg-cedar/5"
      : "border-amber-300 bg-amber-50";
  return (
    <div className={`rounded-lg border p-4 ${tone}`}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">{t("investTitle")}</h3>
        <span className="text-xs text-stone-dark">
          {t("confidence", { pct: Math.round(invest.confidence * 100) })}
        </span>
      </div>
      <p className="mt-1 text-sm font-semibold text-cedar-deep">
        {t(`invest.${invest.recommendation}` as never)}
      </p>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-dark">
        <span>{t("investWeeks", { n: invest.weeks })}</span>
        <span>{t("investTotalNet", { v: invest.totalNet })}</span>
        <span>{t("investAvgNet", { v: invest.avgWeeklyNet })}</span>
      </div>
      <ul className="mt-2 space-y-0.5 text-[11px] text-stone-dark">
        {invest.reasons.map((r, i) => (
          <li key={i} className="flex gap-1.5">
            <span aria-hidden className="text-cedar">
              •
            </span>
            <span>{note(r)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Stat({
  label,
  value,
  strong = false,
  negative = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
  negative?: boolean;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-stone-dark">
        {label}
      </div>
      <div
        className={`${strong ? "font-semibold" : ""} ${
          negative ? "text-red-700" : "text-ink"
        }`}
      >
        {value}
      </div>
    </div>
  );
}
