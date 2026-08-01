"use client";

import { useActionState, useState, useTransition } from "react";
import { usePathname } from "next/navigation";
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
  SkuContributionBreakdown,
  WeeklyEntryView,
  WeeklyHealth,
  WeeklyMargins,
} from "@/lib/finance/service";
import { MarginLegend } from "@/components/margins/MarginLegend";
import { MARGIN_AFTER_ADS_MIN, MARGIN_BEFORE_ADS_MIN } from "@/lib/constants";
import {
  markStayOnFinanceAfterTopicAAction,
  scrollToTopicAFinanceAnchorIfNeeded,
} from "@/lib/sku/suppress-auto-scroll";

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

export function FinancePanel({
  view,
  preferredSkuId,
}: {
  view: FinancePanelView;
  /** When set (SKU page), prefer this id for Start selling if sellable. */
  preferredSkuId?: string;
}) {
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
          <p className="mt-2 max-w-2xl rounded-md border border-sea/20 bg-sea/5 px-3 py-2 text-xs leading-relaxed text-sea">
            {t("shopScopeHint")}
          </p>
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
        <PreviewBlock
          key={preferredSkuId ?? "default"}
          view={view}
          preferredSkuId={preferredSkuId}
        />
      ) : (
        <LiveBlock
          key={view.liveSkus.map((s) => s.id).join(",")}
          view={view}
          preferredSkuId={preferredSkuId}
        />
      )}
    </div>
  );
}

function defaultSellableSkuId(
  sellableSkus: FinancePanelView["sellableSkus"],
  preferredSkuId?: string,
): string {
  if (
    preferredSkuId &&
    sellableSkus.some((s) => s.id === preferredSkuId)
  ) {
    return preferredSkuId;
  }
  return sellableSkus[0]?.id ?? "";
}

function PreviewBlock({
  view,
  preferredSkuId,
}: {
  view: FinancePanelView;
  preferredSkuId?: string;
}) {
  const t = useTranslations("Finance");
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [skuId, setSkuId] = useState(() =>
    defaultSellableSkuId(view.sellableSkus, preferredSkuId),
  );

  return (
    <div className="mt-4">
      <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
        {t("previewNote")}
      </div>

      {view.weekCount > 0 && (
        <div className="mt-2 rounded-md border border-sea/20 bg-sea/5 px-3 py-2 text-xs text-sea">
          {t("previewShopHistory", { n: view.weekCount })}
        </div>
      )}

      {view.previewSample && (
        <div className="mt-3 opacity-90">
          <p className="text-xs font-semibold uppercase tracking-wide text-stone-dark">
            {t("previewSampleTitle")}
          </p>
          <TopicAEntryRow entry={view.previewSample} sample />
        </div>
      )}

      <div className="mt-4 border-t border-stone pt-4">
        {view.sellableSkus.length > 1 && (
          <label className="mb-2 block text-xs text-stone-dark">
            {t("sellableSku")}
            <select
              value={skuId}
              onChange={(e) => setSkuId(e.target.value)}
              className="mt-1 w-full max-w-xs rounded-md border border-stone bg-surface px-2.5 py-2 text-sm"
            >
              {view.sellableSkus.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <button
          type="button"
          disabled={pending || !view.canStartSelling}
          onClick={() =>
            startTransition(async () => {
              const targetId = skuId || preferredSkuId;
              // SKU page only: pin Topic A; SkuSectionFocus owns remount restore.
              if (targetId) markStayOnFinanceAfterTopicAAction(targetId, pathname);
              const res = await startSellingAction(skuId || undefined);
              if (res.ok) {
                // One backup if remount already consumed the flag and we're still off.
                scrollToTopicAFinanceAnchorIfNeeded("smooth");
              }
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

function LiveBlock({
  view,
  preferredSkuId,
}: {
  view: FinancePanelView;
  preferredSkuId?: string;
}) {
  const t = useTranslations("Finance");
  const pathname = usePathname();
  const staySkuId =
    preferredSkuId && view.liveSkus.some((s) => s.id === preferredSkuId)
      ? preferredSkuId
      : (view.liveSellingSkus[0]?.id ?? view.liveSkus[0]?.id ?? "");

  const [state, formAction, pending] = useActionState(
    async (prev: WeeklyEntryState, formData: FormData) => {
      // markStay is a no-op on /finance; SkuSectionFocus restores on SKU remount.
      if (staySkuId) markStayOnFinanceAfterTopicAAction(staySkuId, pathname);
      return addWeeklyEntryAction(prev, formData);
    },
    entryInitial,
  );

  // Mode C whenever 2+ live — not only 2+ selling (avoids legacy bleed after Add SKU).
  const multi = view.liveSkus.length > 1;
  const invById = new Map(
    view.inventoryBySku.map((h) => [h.skuId, h] as const),
  );
  const [lines, setLines] = useState(
    () =>
      view.liveSkus.map((s) => ({
        skuId: s.id,
        name: s.name,
        sold: 0,
        sales: 0,
      })),
  );
  const [singleSold, setSingleSold] = useState(0);

  function computedLeft(
    skuId: string,
    thisWeekSold: number,
  ): number | null {
    const inv = invById.get(skuId);
    if (!inv || inv.totalUnitsReceived == null) return null;
    return Math.max(
      0,
      inv.totalUnitsReceived - inv.priorUnitsSold - Math.max(0, thisWeekSold),
    );
  }

  const shopInputs: Array<{ name: string; labelKey: string }> = [
    { name: "orders", labelKey: "fOrders" },
    { name: "metaSpend", labelKey: "fMeta" },
    { name: "tiktokSpend", labelKey: "fTiktok" },
    { name: "codCollected", labelKey: "fCodCollected" },
    { name: "codOutstanding", labelKey: "fCodOutstanding" },
    { name: "courierFees", labelKey: "fCourier" },
  ];

  const singleInputs: Array<{ name: string; labelKey: string }> = [
    { name: "sales", labelKey: "fSales" },
    ...shopInputs,
  ];

  const soleSkuId = view.liveSkus[0]?.id ?? "";
  const soleLeft = computedLeft(soleSkuId, singleSold);

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

      {view.liveSkus.length >= 2 && (
        <SkuContributionBlock breakdown={view.skuContribution} />
      )}

      {/* Weekly history — under margin strip / invest, above Add week */}
      <div className="mt-4 space-y-2">
        {view.entries.length === 0 ? (
          <div className="rounded-lg border border-dashed border-stone bg-surface-subtle px-3 py-4 text-center text-sm text-stone-dark">
            {t("emptyActual")}
          </div>
        ) : (
          view.entries
            .slice()
            .reverse()
            .map((e) => <TopicAEntryRow key={e.id} entry={e} />)
        )}
      </div>

      {/* Weekly entry form */}
      <form
        action={formAction}
        onSubmit={() => {
          if (staySkuId) markStayOnFinanceAfterTopicAAction(staySkuId, pathname);
        }}
        className="mt-4 rounded-lg border border-stone bg-surface-subtle p-4"
      >
        <h3 className="text-sm font-semibold text-ink">{t("addWeekTitle")}</h3>
        {multi && (
          <p className="mt-1 text-xs text-stone-dark">{t("multiSkuHint")}</p>
        )}
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
          {(multi ? shopInputs : singleInputs).map((f) => (
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
          {!multi && (
            <>
              <label className="text-xs text-stone-dark">
                {t("fSold")}
                <input
                  type="number"
                  name="skuSold"
                  min={0}
                  step="1"
                  value={singleSold}
                  onChange={(e) =>
                    setSingleSold(Number(e.target.value) || 0)
                  }
                  className="mt-1 w-full rounded-md border border-stone bg-surface px-2.5 py-2 text-sm outline-none focus:border-cedar"
                />
              </label>
              <div className="text-xs text-stone-dark">
                <p>{t("fLeft")}</p>
                <p className="mt-1 rounded-md border border-stone/70 bg-surface-subtle px-2.5 py-2 text-sm font-medium tabular-nums text-ink">
                  {soleLeft == null ? "—" : soleLeft}
                </p>
                <p className="mt-1 text-[11px] leading-snug text-stone-dark">
                  {t("fLeftHint")}
                </p>
              </div>
            </>
          )}
        </div>

        {multi && (
          <div className="mt-4 space-y-3">
            <input
              type="hidden"
              name="skuLines"
              value={JSON.stringify(
                lines.map(({ skuId, sold, sales }) => ({
                  skuId,
                  sold,
                  left: computedLeft(skuId, sold),
                  sales,
                })),
              )}
            />
            {lines.map((line, idx) => {
              const left = computedLeft(line.skuId, line.sold);
              return (
                <div
                  key={line.skuId}
                  className="rounded-md border border-stone bg-surface p-3"
                >
                  <p className="text-xs font-semibold text-ink" dir="auto">
                    {line.name}
                  </p>
                  <div className="mt-2 grid gap-2 sm:grid-cols-3">
                    <label className="text-xs text-stone-dark">
                      {t("fSkuSales")}
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={line.sales}
                        onChange={(e) => {
                          const v = Number(e.target.value) || 0;
                          setLines((prev) =>
                            prev.map((row, i) =>
                              i === idx ? { ...row, sales: v } : row,
                            ),
                          );
                        }}
                        className="mt-1 w-full rounded-md border border-stone bg-surface px-2.5 py-2 text-sm outline-none focus:border-cedar"
                      />
                    </label>
                    <label className="text-xs text-stone-dark">
                      {t("fSold")}
                      <input
                        type="number"
                        min={0}
                        step="1"
                        value={line.sold}
                        onChange={(e) => {
                          const v = Math.max(
                            0,
                            Math.floor(Number(e.target.value) || 0),
                          );
                          setLines((prev) =>
                            prev.map((row, i) =>
                              i === idx ? { ...row, sold: v } : row,
                            ),
                          );
                        }}
                        className="mt-1 w-full rounded-md border border-stone bg-surface px-2.5 py-2 text-sm outline-none focus:border-cedar"
                      />
                    </label>
                    <div className="text-xs text-stone-dark">
                      <p>{t("fLeft")}</p>
                      <p className="mt-1 rounded-md border border-stone/70 bg-surface-subtle px-2.5 py-2 text-sm font-medium tabular-nums text-ink">
                        {left == null ? "—" : left}
                      </p>
                      <p className="mt-1 text-[11px] leading-snug text-stone-dark">
                        {t("fLeftHint")}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {state.error && (
          <p className="mt-2 text-xs text-amber-800">
            {state.error === "missing_week"
              ? t("errWeek")
              : state.error === "duplicate_week"
                ? t("errDuplicateWeek")
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
    </div>
  );
}

function SkuContributionBlock({
  breakdown,
}: {
  breakdown: SkuContributionBreakdown | null;
}) {
  const t = useTranslations("Finance");

  if (!breakdown) {
    return (
      <div className="mt-4 rounded-lg border border-dashed border-stone bg-surface-subtle px-3 py-3 text-xs text-stone-dark">
        <p className="font-semibold text-ink">{t("skuContribTitle")}</p>
        <p className="mt-1">{t("skuContribEmpty")}</p>
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-lg border border-stone bg-surface-subtle p-4">
      <h3 className="text-sm font-semibold text-ink">{t("skuContribTitle")}</h3>
      <p className="mt-1 text-xs text-stone-dark">{t("skuContribIntro")}</p>
      <p className="mt-1 text-[11px] text-stone-dark">
        {t("skuContribWindow", { n: breakdown.weekStarts.length })}
        {" · "}
        {t("skuContribRankedBy")}
      </p>
      {breakdown.weeksSkippedNoLines > 0 && (
        <p className="mt-1 text-[11px] text-stone-dark/80">
          {t("skuContribSkipped", { n: breakdown.weeksSkippedNoLines })}
        </p>
      )}

      <ul className="mt-3 space-y-2">
        {breakdown.rows.map((row) => (
          <li
            key={row.skuId}
            className="rounded-md border border-stone bg-surface px-3 py-2.5"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-ink" dir="auto">
                  <span className="me-1.5 text-xs font-medium text-stone-dark">
                    #{row.rank}
                  </span>
                  {row.name}
                </p>
                <dl className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-stone-dark">
                  <div>
                    <dt className="inline">{t("skuContribSales")}: </dt>
                    <dd className="inline font-medium text-ink">
                      {money(row.sales)}
                    </dd>
                  </div>
                  <div>
                    <dt className="inline">{t("skuContribUnits")}: </dt>
                    <dd className="inline font-medium text-ink">
                      {row.unitsSold}
                    </dd>
                  </div>
                  <div>
                    <dt className="inline">{t("skuContribCogs")}: </dt>
                    <dd className="inline font-medium text-ink">
                      {money(row.cogs)}
                    </dd>
                  </div>
                </dl>
              </div>
              <div className="text-end text-xs">
                <p className="text-[10px] uppercase tracking-wide text-stone-dark">
                  {t("marginBeforeShort")}
                </p>
                <p
                  className={`font-display text-lg ${
                    row.marginBefore != null &&
                    row.marginBefore < MARGIN_BEFORE_ADS_MIN
                      ? "text-amber-800"
                      : "text-cedar-deep"
                  }`}
                >
                  {pct1(row.marginBefore)}
                </p>
                {row.estimatedMarginAfter != null && (
                  <p className="mt-1 max-w-[11rem] text-[10px] leading-snug text-stone-dark">
                    {t("skuContribEstAfter", {
                      pct: pct1(row.estimatedMarginAfter),
                    })}
                  </p>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
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
    <div
      id="finance-actual"
      className="scroll-mt-6 rounded-lg border border-cedar/30 bg-surface-subtle p-4"
    >
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

export function TopicAEntryRow({
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

      {entry.weekSkuSplit && entry.weekSkuSplit.rows.length > 0 && (
        <div className="mt-2 rounded-md border border-stone/80 bg-surface-subtle px-2.5 py-2">
          <p className="text-[11px] font-semibold text-ink">
            {t("weekSkuSplitTitle")}
          </p>
          <p className="mt-0.5 text-[10px] leading-snug text-stone-dark">
            {t("weekSkuSplitNote")}
          </p>
          <ul className="mt-1.5 space-y-1">
            {entry.weekSkuSplit.rows.map((row) => (
              <li
                key={row.skuId}
                className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-[11px]"
              >
                <span className="min-w-0 font-medium text-ink" dir="auto">
                  <span className="me-1 text-stone-dark">#{row.rank}</span>
                  {row.name}
                </span>
                <span className="shrink-0 tabular-nums text-stone-dark">
                  {t("skuContribSales")} {money(row.sales)}
                  <span className="mx-1 text-stone-dark/50">·</span>
                  {row.unitsSold} {t("skuContribUnitsShort")}
                  <span className="mx-1 text-stone-dark/50">·</span>
                  {t("skuContribCogs")} {money(row.cogs)}
                  <span className="mx-1 text-stone-dark/50">·</span>
                  <span
                    className={
                      row.marginBefore != null &&
                      row.marginBefore < MARGIN_BEFORE_ADS_MIN
                        ? "font-semibold text-amber-800"
                        : "font-semibold text-cedar-deep"
                    }
                  >
                    {t("marginBeforeShort")} {pct1(row.marginBefore)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
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
