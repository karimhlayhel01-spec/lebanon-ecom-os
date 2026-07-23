"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import {
  decideSampleAction,
  markBatchArrivedAction,
  markSampleReceivedAction,
  orderBatchAction,
  requestSampleAction,
  saveCostQuotesAction,
  setBatchArrivalEtaAction,
} from "@/actions/supplier";
import { MARGIN_BEFORE_ADS_MIN } from "@/lib/constants";
import { computeMargin } from "@/lib/skills/margin";
import type { EtaPreset } from "@/lib/supplier/batch-eta";
import type {
  BatchArrivalEtaView,
  CostQuotesView,
  SampleView,
  SupplierPanelView,
  SupplierView,
} from "@/lib/supplier/service";

const CHECKLIST_KEYS = [
  "matchesPhotos",
  "materialQuality",
  "functionsWork",
  "packagingIntact",
  "sizeWeight",
  "safetySmell",
  "arabicLabeling",
] as const;

function useSupNote() {
  const t = useTranslations("Supplier");
  return (key: string) =>
    key.startsWith("@") ? t(`notes.${key.slice(1)}` as never) : key;
}

export function SupplierPanel({ view }: { view: SupplierPanelView }) {
  const t = useTranslations("Supplier");

  const allSuppliers = view.groups.flatMap((g) =>
    [g.primary, ...g.backups].filter(Boolean),
  ) as SupplierView[];

  // Hide the full shortlist once a sample is in play (requested / received /
  // approved) or the batch flow has started. It reappears automatically after a
  // reject/replace because the service drops those from `view.sample`.
  const showShortlist =
    !view.sample && !view.sampleApproved && !view.batchOrdered;

  const chosenSupplier = view.sample
    ? allSuppliers.find((s) => s.id === view.sample!.supplierId) ?? null
    : null;

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
      </div>

      <div className="mt-3 rounded-md border border-sea/30 bg-sea/5 px-3 py-2 text-xs text-sea">
        {t("sampleFirstBanner")}
      </div>

      {/* Sample tracker — key by sample id so Path B re-sample resets local state. */}
      {view.sample && (
        <SampleTracker key={view.sample.id} sample={view.sample} />
      )}

      {/* Full shortlist — only while no sample is in play. */}
      {showShortlist ? (
        <div className="mt-4 space-y-4">
          {view.groups.map((g) => (
            <div key={g.rank}>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-dark">
                {t("group", { n: g.rank + 1 })}
              </h3>
              <div className="mt-2 grid items-start gap-3 md:grid-cols-3">
                {g.primary && (
                  <SupplierCard
                    s={g.primary}
                    canRequest={!view.sample}
                    softLimit={view.softLimitUsd}
                  />
                )}
                {g.backups.map((b) => (
                  <SupplierCard
                    key={b.id}
                    s={b}
                    canRequest={!view.sample}
                    softLimit={view.softLimitUsd}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        chosenSupplier && (
          <ChosenSupplierSummary
            s={chosenSupplier}
            selling={view.batchArrivedReady}
          />
        )
      )}

      <CostQuotesBlock costQuotes={view.costQuotes} />

      {/* Batch order (parallel with store setup; never needs store readiness) */}
      {view.sampleApproved && !view.batchOrdered && (
        <BatchOrder view={view} />
      )}

      {view.batchOrdered && !view.batchArrivedReady && (
        <BatchArrivalEtaBlock eta={view.batchArrivalEta} />
      )}

      {view.batchOrdered && !view.batchArrivedReady && (
        <BatchArrived />
      )}

      {view.batchArrivedReady && (
        <div className="mt-4 rounded-md border border-cedar/30 bg-cedar/10 px-3 py-2 text-sm font-medium text-cedar-deep">
          {t("batchArrivedDone")}
        </div>
      )}

      <p className="mt-4 text-xs text-stone-dark">
        {t("clearance")}: <span className="font-medium">{view.clearancePartner}</span>
      </p>
      <p className="mt-1.5 text-xs text-stone-dark/80">
        {t("clearanceVsDeliveryNote")}
      </p>
    </div>
  );
}

function SupplierCard({
  s,
  canRequest,
  softLimit,
}: {
  s: SupplierView;
  canRequest: boolean;
  softLimit: number;
}) {
  const t = useTranslations("Supplier");
  const note = useSupNote();
  const [pending, startTransition] = useTransition();
  const [showEmail, setShowEmail] = useState(false);
  const [warnOpen, setWarnOpen] = useState(false);

  const hasWarnings = s.overSoftLimit || s.redFlags.length > 0;
  const warningLines: string[] = [];
  if (s.overSoftLimit) {
    warningLines.push(t("overLimitHint", { limit: softLimit.toLocaleString() }));
  }
  for (const f of s.redFlags) {
    warningLines.push(note(f));
  }

  return (
    <article className="relative flex flex-col gap-2 rounded-lg border border-stone bg-surface-subtle p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h4 className="text-sm font-semibold text-ink">{s.name}</h4>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-stone-dark">
            <span
              className={`rounded px-1.5 py-0.5 font-medium ${
                s.role === "primary"
                  ? "bg-cedar/10 text-cedar-deep"
                  : "bg-sand text-stone-dark"
              }`}
            >
              {s.role === "primary" ? t("primary") : t("backup")}
            </span>
            {s.verified && (
              <span className="rounded bg-sea/10 px-1.5 py-0.5 text-sea">
                {t("verified")}
              </span>
            )}
          </div>
        </div>
        <span className="whitespace-nowrap text-xs font-semibold text-ink">
          ★ {s.rating.toFixed(1)}
        </span>
      </div>

      <dl className="space-y-1 text-xs">
        <Row label={t("years")}>{t("yearsValue", { n: s.years })}</Row>
        <Row label={t("moq")}>{s.moq}</Row>
        <Row label={t("unitPrice")}>${s.unitPrice.toFixed(2)}</Row>
        <Row label={t("estBatch")}>
          <span className={s.overSoftLimit ? "font-semibold text-amber-800" : "font-medium text-ink"}>
            ~${s.estBatchCost.toLocaleString()}
          </span>
        </Row>
      </dl>

      <div className="rounded border border-stone bg-surface px-2 py-1.5 text-[11px] text-stone-dark">
        <span className="font-medium text-ink">{t("payment")}: </span>
        {s.paymentMap.depositPct}% / {s.paymentMap.balancePct}% ·{" "}
        {s.paymentMap.method} · {t("estDeposit")} ~${s.paymentMap.estDeposit.toLocaleString()}
        <div className="mt-0.5">{note(s.paymentMap.note)}</div>
      </div>

      {/* Footer is always the last block, right under content, consistent gap.
          Expanding the email draft grows only this card (grid uses items-start). */}
      <div className="flex flex-col items-start gap-2">
        <button
          type="button"
          onClick={() => setShowEmail((v) => !v)}
          className="text-[11px] font-medium text-sea underline-offset-2 hover:underline"
        >
          {showEmail ? t("hideEmail") : t("showEmail")}
        </button>
        {showEmail && (
          <>
            <p className="text-[11px] text-stone-dark">{t("emailDraftHint")}</p>
            <textarea
              readOnly
              value={s.negotiationDraft}
              rows={8}
              className="w-full rounded border border-stone bg-surface p-2 text-[11px] text-stone-dark"
            />
          </>
        )}

        {canRequest && (
          <div className="flex flex-col items-start gap-1">
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  await requestSampleAction(s.id);
                })
              }
              className="rounded-md bg-cedar px-3 py-1.5 text-xs font-semibold text-foam transition hover:bg-cedar-deep disabled:opacity-60"
            >
              {t("requestSample")}
            </button>
            <p className="max-w-sm text-[11px] text-stone-dark">
              {t("requestSampleHint")}
            </p>
          </div>
        )}
      </div>

      {/* Overlay mark — out of flow so it never changes card height/width. */}
      {hasWarnings && (
        <div
          className="absolute bottom-2 end-2 z-10"
          onMouseEnter={() => setWarnOpen(true)}
          onMouseLeave={() => setWarnOpen(false)}
        >
          <button
            type="button"
            aria-label={t("warningsAria")}
            aria-expanded={warnOpen}
            aria-controls={`supplier-warn-${s.id}`}
            onClick={() => setWarnOpen((v) => !v)}
            onBlur={(e) => {
              const next = e.relatedTarget as Node | null;
              if (!e.currentTarget.parentElement?.contains(next)) {
                setWarnOpen(false);
              }
            }}
            className="bg-transparent p-1 text-[11px] leading-none text-amber-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-amber-600"
          >
            <span aria-hidden>⚠</span>
          </button>
          {warnOpen && (
            <div
              id={`supplier-warn-${s.id}`}
              role="tooltip"
              className="absolute bottom-full end-0 z-20 mb-1.5 w-56 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-2 text-start text-[11px] leading-snug text-amber-950 shadow-sm"
            >
              <ul className="space-y-1">
                {warningLines.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

function ChosenSupplierSummary({
  s,
  selling,
}: {
  s: SupplierView;
  selling: boolean;
}) {
  const t = useTranslations("Supplier");

  return (
    <div className="mt-4 rounded-lg border border-cedar/30 bg-surface-subtle p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-stone-dark">
            {selling ? t("workingSupplier") : t("chosenSupplier")}
          </p>
          <h4 className="mt-0.5 text-sm font-semibold text-ink">{s.name}</h4>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-stone-dark">
            <span
              className={`rounded px-1.5 py-0.5 font-medium ${
                s.role === "primary"
                  ? "bg-cedar/10 text-cedar-deep"
                  : "bg-sand text-stone-dark"
              }`}
            >
              {s.role === "primary" ? t("primary") : t("backup")}
            </span>
            {s.verified && (
              <span className="rounded bg-sea/10 px-1.5 py-0.5 text-sea">
                {t("verified")}
              </span>
            )}
            <span className="font-semibold text-ink">★ {s.rating.toFixed(1)}</span>
          </div>
        </div>
      </div>

      <dl className="mt-3 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
        <Row label={t("moq")}>{s.moq}</Row>
        <Row label={t("unitPrice")}>${s.unitPrice.toFixed(2)}</Row>
        <Row label={t("estBatch")}>~${s.estBatchCost.toLocaleString()}</Row>
      </dl>

      <p className="mt-3 text-[11px] text-stone-dark">
        {t("shortlistHiddenNote")}
      </p>
    </div>
  );
}

function SampleTracker({ sample }: { sample: SampleView }) {
  const t = useTranslations("Supplier");
  const [pending, startTransition] = useTransition();
  const [checklist, setChecklist] = useState<Record<string, boolean>>(
    sample.checklist,
  );
  const [photoNotes, setPhotoNotes] = useState(sample.photoNotes);

  const isRequested = sample.status === "requested";
  const isReceived = sample.status === "received";
  // Status on this sample record only — journey-level sampleApproved must not
  // paint a newly requested Path B sample as already approved.
  const isApproved = sample.status === "approved";

  return (
    <div className="mt-4 rounded-lg border border-cedar/30 bg-cedar/5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">
          {t("sampleTitle")} — {sample.supplierName}
        </h3>
        <span className="rounded-full bg-surface px-2.5 py-1 text-xs font-medium text-cedar-deep">
          {t(`sampleStatus.${sample.status}` as never)}
        </span>
      </div>

      {(isRequested || isReceived) && (
        <div className="mt-3">
          <p className="text-xs font-medium text-ink">{t("checklistTitle")}</p>
          <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
            {CHECKLIST_KEYS.map((k) => (
              <label key={k} className="flex items-center gap-2 text-xs text-stone-dark">
                <input
                  type="checkbox"
                  checked={!!checklist[k]}
                  onChange={(e) =>
                    setChecklist((c) => ({ ...c, [k]: e.target.checked }))
                  }
                  className="size-4 accent-cedar"
                />
                {t(`checklist.${k}` as never)}
              </label>
            ))}
          </div>
          <textarea
            value={photoNotes}
            onChange={(e) => setPhotoNotes(e.target.value)}
            rows={2}
            placeholder={t("photoNotes")}
            className="mt-2 w-full rounded-md border border-stone bg-surface px-2.5 py-2 text-xs outline-none focus:border-cedar"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  await markSampleReceivedAction(sample.id, checklist, photoNotes);
                })
              }
              className="rounded-md border border-stone bg-surface px-3 py-1.5 text-xs font-semibold text-ink transition hover:bg-sand disabled:opacity-60"
            >
              {isReceived ? t("saveChecklist") : t("markReceived")}
            </button>
          </div>
        </div>
      )}

      {isReceived && (
        <div className="mt-3 flex flex-wrap gap-2 border-t border-cedar/20 pt-3">
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                await decideSampleAction(sample.id, "approve");
              })
            }
            className="rounded-md bg-cedar px-3 py-1.5 text-xs font-semibold text-foam transition hover:bg-cedar-deep disabled:opacity-60"
          >
            {t("approveSample")}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                await decideSampleAction(sample.id, "replace");
              })
            }
            className="rounded-md border border-stone px-3 py-1.5 text-xs font-medium text-ink transition hover:bg-sand disabled:opacity-60"
          >
            {t("replaceSample")}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                await decideSampleAction(sample.id, "reject");
              })
            }
            className="rounded-md border border-stone px-3 py-1.5 text-xs font-medium text-ink transition hover:bg-sand disabled:opacity-60"
          >
            {t("rejectSample")}
          </button>
        </div>
      )}

      {isApproved && (
        <p className="mt-2 text-xs font-medium text-cedar-deep">
          {t("sampleApprovedNote")}
        </p>
      )}
    </div>
  );
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function CostQuotesBlock({ costQuotes }: { costQuotes: CostQuotesView }) {
  const t = useTranslations("Supplier");
  const [pending, startTransition] = useTransition();
  const [productCost, setProductCost] = useState(
    String(costQuotes.prefill.productCost),
  );
  const [intlShip, setIntlShip] = useState(String(costQuotes.prefill.intlShip));
  const [clearanceTaxes, setClearanceTaxes] = useState(
    String(costQuotes.prefill.clearanceTaxes),
  );
  const [localCourier, setLocalCourier] = useState(
    String(costQuotes.prefill.localCourier),
  );
  const [sellPrice, setSellPrice] = useState(String(costQuotes.prefill.sellPrice));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(costQuotes.saved);

  if (!costQuotes.unlocked) {
    return (
      <div
        id="cost-quotes"
        className="mt-4 rounded-lg border border-dashed border-stone bg-surface-subtle p-4"
      >
        <h3 className="text-sm font-semibold text-ink">{t("costQuotesTitle")}</h3>
        <p className="mt-1 text-xs text-stone-dark">{t("costQuotesLocked")}</p>
      </div>
    );
  }

  const parsed = {
    productCost: Number(productCost),
    intlShip: Number(intlShip),
    clearanceTaxes: Number(clearanceTaxes),
    localCourier: Number(localCourier),
    sellPrice: Number(sellPrice),
  };
  const valid = Object.values(parsed).every((n) => Number.isFinite(n) && n >= 0);
  const preview = valid
    ? computeMargin({
        ...parsed,
        monthlyFollowOnBudget: costQuotes.monthlyFollowOnBudget,
      })
    : null;
  const belowMin =
    preview != null && preview.marginBefore < MARGIN_BEFORE_ADS_MIN;

  return (
    <div
      id="cost-quotes"
      className={`mt-4 rounded-lg border bg-surface-subtle p-4 ${
        saved ? "border-cedar/30" : "border-cedar bg-cedar/5"
      }`}
    >
      {!saved && (
        <p className="mb-2 inline-flex items-center gap-1.5 rounded-md bg-cedar px-2.5 py-1 text-[11px] font-semibold text-foam">
          {t("costQuotesNextStep")}
        </p>
      )}
      <h3 className="text-sm font-semibold text-ink">{t("costQuotesTitle")}</h3>
      <p className="mt-1 text-xs text-stone-dark">{t("costQuotesIntro")}</p>

      <div className="mt-3 rounded-md border border-stone bg-surface px-3 py-2.5 text-xs text-stone-dark">
        <p className="font-medium text-ink">{t("costQuotesGuideTitle")}</p>
        <ul className="mt-1.5 list-disc space-y-1 ps-4">
          <li>{t("costQuotesGuideFreight")}</li>
          <li>{t("costQuotesGuideClearance")}</li>
          <li>{t("costQuotesGuideCourier")}</li>
        </ul>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <CostField
          label={t("costProductUnit")}
          value={productCost}
          onChange={setProductCost}
          hint={t("costProductHint")}
        />
        <CostField
          label={t("costSellPrice")}
          value={sellPrice}
          onChange={setSellPrice}
          hint={t("costSellHint")}
        />
        <CostField
          label={t("costIntlShip")}
          value={intlShip}
          onChange={setIntlShip}
          hint={t("costIntlHint")}
        />
        <CostField
          label={t("costClearance")}
          value={clearanceTaxes}
          onChange={setClearanceTaxes}
          hint={t("costClearanceHint")}
        />
        <CostField
          label={t("costCourier")}
          value={localCourier}
          onChange={setLocalCourier}
          hint={t("costCourierHint")}
        />
      </div>

      <div className="mt-4 overflow-hidden rounded-md border border-stone">
        <table className="w-full text-xs">
          <thead className="bg-sand/60 text-stone-dark">
            <tr>
              <th className="px-3 py-2 text-start font-medium">{t("costCompareMetric")}</th>
              <th className="px-3 py-2 text-end font-medium">{t("costPlanningEstimate")}</th>
              <th className="px-3 py-2 text-end font-medium">{t("costFounderQuoted")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone bg-surface">
            <tr>
              <td className="px-3 py-2 text-stone-dark">{t("marginBefore")}</td>
              <td className="px-3 py-2 text-end font-medium text-ink">
                {pct(costQuotes.planningMarginBefore)}
                <span className="ms-1 text-[10px] text-stone-dark">
                  ({t("costPlanningLabel")})
                </span>
              </td>
              <td className="px-3 py-2 text-end font-semibold text-cedar-deep">
                {preview ? pct(preview.marginBefore) : "—"}
                <span className="ms-1 text-[10px] font-normal text-stone-dark">
                  ({t("costExpectedLabel")})
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {belowMin && (
        <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <p className="font-semibold">{t("costWarnTitle")}</p>
          <p className="mt-1">{t("costWarnBody")}</p>
        </div>
      )}

      {error && (
        <p className="mt-2 text-xs text-amber-800">{t(error as never)}</p>
      )}
      {saved && !error && (
        <p className="mt-2 text-xs font-medium text-cedar-deep">{t("costQuotesSaved")}</p>
      )}

      <button
        type="button"
        disabled={pending || !valid}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const res = await saveCostQuotesAction(parsed);
            if (!res.ok) {
              setError(
                res.error === "locked"
                  ? "costQuotesLocked"
                  : res.error === "invalid"
                    ? "costQuotesInvalid"
                    : "errorGeneric",
              );
              return;
            }
            setSaved(true);
          });
        }}
        className="mt-3 rounded-md bg-cedar px-4 py-2 text-sm font-semibold text-foam shadow-sm transition hover:bg-cedar-deep disabled:opacity-60"
      >
        {t("costQuotesSave")}
      </button>
      <p className="mt-2 text-[11px] text-stone-dark">{t("costQuotesNoBlock")}</p>
    </div>
  );
}

function CostField({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint: string;
}) {
  return (
    <label className="text-xs text-stone-dark">
      {label}
      <input
        type="number"
        min={0}
        step="0.01"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-md border border-stone bg-surface px-2.5 py-2 text-sm text-ink outline-none focus:border-cedar"
      />
      <span className="mt-0.5 block text-[10px]">{hint}</span>
    </label>
  );
}

function batchEstAtMoq(
  s: SupplierView,
  intlShip: number,
  clearanceTaxes: number,
): number {
  return Math.round((s.unitPrice + intlShip + clearanceTaxes) * s.moq);
}

/** Stable USD formatting — avoid SSR/client locale mismatches from toLocaleString(). */
function formatUsd(n: number): string {
  return n.toLocaleString("en-US");
}

function BatchOrder({ view }: { view: SupplierPanelView }) {
  const t = useTranslations("Supplier");
  const [pending, startTransition] = useTransition();
  const suppliers = view.groups.flatMap((g) =>
    [g.primary, ...g.backups].filter(Boolean),
  ) as SupplierView[];
  // Prefer the approved sample's supplier (batch is only legal with them).
  const defaultId =
    view.approvedSampleSupplierId &&
    suppliers.some((s) => s.id === view.approvedSampleSupplierId)
      ? view.approvedSampleSupplierId
      : view.sample?.supplierId &&
          suppliers.some((s) => s.id === view.sample!.supplierId)
        ? view.sample.supplierId
        : (suppliers[0]?.id ?? "");
  const [supplierId, setSupplierId] = useState(defaultId);
  const selected = suppliers.find((s) => s.id === supplierId) ?? suppliers[0];
  const [qty, setQty] = useState(selected?.moq ?? 100);
  const [acks, setAcks] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const freight =
    view.batchBasis.intlShip + view.batchBasis.clearanceTaxes;
  const perUnit = (selected?.unitPrice ?? 0) + freight;
  const estCost = Math.round(perUnit * qty);
  const overLimit = estCost > view.softLimitUsd;

  // Hard gate mirror: batch only when selection matches an approved sample.
  const canBatchSelected =
    !!selected &&
    !!view.approvedSampleSupplierId &&
    selected.id === view.approvedSampleSupplierId;
  const sampleSupplierName =
    view.approvedSampleSupplierName ?? view.sample?.supplierName ?? "—";

  // Path B — compact strip while over soft limit. Selecting a backup switches
  // the dropdown; next step is SAMPLE for that backup, not batch.
  const pathBOptions = overLimit
    ? suppliers
        .filter(
          (s) =>
            s.id !== selected?.id && s.moq < (selected?.moq ?? Infinity),
        )
        .sort((a, b) => a.moq - b.moq || a.unitPrice - b.unitPrice)
        .slice(0, 6)
    : [];

  function usePathBSupplier(s: SupplierView) {
    setSupplierId(s.id);
    setQty(s.moq);
    setAcks(false);
    setError(null);
  }

  function requestSampleForSelected() {
    if (!selected) return;
    setError(null);
    startTransition(async () => {
      const res = await requestSampleAction(selected.id);
      if (!res.ok) setError("errorGeneric");
    });
  }

  return (
    <div className="mt-4 rounded-lg border border-stone bg-surface-subtle p-4">
      <h3 className="text-sm font-semibold text-ink">{t("batchTitle")}</h3>
      <p className="mt-1 text-xs text-stone-dark">{t("batchIntro")}</p>
      {!view.costQuotes.saved && (
        <p className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
          {t("batchNudgeQuotesFirst")}
        </p>
      )}

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-stone-dark">
          {t("chooseSupplier")}
          <select
            value={supplierId}
            onChange={(e) => {
              setSupplierId(e.target.value);
              const s = suppliers.find((x) => x.id === e.target.value);
              if (s) setQty(s.moq);
              setAcks(false);
              setError(null);
            }}
            className="mt-1 w-full rounded-md border border-stone bg-surface px-2.5 py-2 text-sm text-ink outline-none focus:border-cedar"
          >
            {suppliers.map((s) => {
              const est = batchEstAtMoq(
                s,
                view.batchBasis.intlShip,
                view.batchBasis.clearanceTaxes,
              );
              return (
                <option key={s.id} value={s.id}>
                  {s.name} — MOQ {s.moq} · ${s.unitPrice.toFixed(2)} · ~
                  {`$${formatUsd(est)}`}
                </option>
              );
            })}
          </select>
        </label>
        <label className="text-xs text-stone-dark">
          {t("quantity")}
          <input
            type="number"
            min={1}
            value={qty}
            onChange={(e) => setQty(Number(e.target.value))}
            className="mt-1 w-full rounded-md border border-stone bg-surface px-2.5 py-2 text-sm text-ink outline-none focus:border-cedar"
          />
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
        <span className="text-stone-dark">{t("estBatch")}:</span>
        <span
          className={`font-semibold ${overLimit ? "text-amber-800" : "text-cedar-deep"}`}
        >
          ~${formatUsd(estCost)}
        </span>
        <span className="text-[11px] text-stone-dark">
          {view.batchBasis.usesQuotes
            ? t("batchUsesQuotes")
            : t("batchUsesPlanning")}
        </span>
      </div>

      {!canBatchSelected && selected && (
        <div className="mt-3 rounded-md border border-sea/40 bg-sea/5 p-3 text-xs text-sea">
          <p className="font-medium text-ink">
            {t("batchSupplierMismatch", {
              sample: sampleSupplierName,
              batch: selected.name,
            })}
          </p>
          <p className="mt-1 text-stone-dark">{t("pathBNeedsSample")}</p>
          <button
            type="button"
            disabled={pending}
            onClick={requestSampleForSelected}
            className="mt-2 rounded-md bg-cedar px-3 py-1.5 text-[11px] font-semibold text-foam transition hover:bg-cedar-deep disabled:opacity-60"
          >
            {t("requestSampleForSelected")}
          </button>
          <p className="mt-1.5 text-[11px] text-stone-dark">
            {t("requestSampleHint")}
          </p>
        </div>
      )}

      {overLimit && (
        <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
          <p className="font-semibold">
            {t("stuckTitle", { limit: formatUsd(view.softLimitUsd) })}
          </p>
          <ol className="mt-1.5 list-decimal space-y-1 ps-4">
            <li>{t("stuckA")}</li>
            <li>{t("stuckB")}</li>
            <li>{t("stuckC")}</li>
          </ol>

          {pathBOptions.length > 0 && (
            <div className="mt-3 rounded-md border border-amber-400/60 bg-white/70 p-2.5">
              <p className="font-semibold text-amber-950">{t("pathBTitle")}</p>
              <p className="mt-1 text-[11px] text-amber-900/90">
                {t("pathBNeedsSample")}
              </p>
              <ul className="mt-2 space-y-2">
                {pathBOptions.map((s) => {
                  const est = batchEstAtMoq(
                    s,
                    view.batchBasis.intlShip,
                    view.batchBasis.clearanceTaxes,
                  );
                  return (
                    <li
                      key={s.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded border border-stone/60 bg-surface px-2.5 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium text-ink">{s.name}</p>
                        <p className="text-[11px] text-stone-dark">
                          {t("moq")} {s.moq} · ${s.unitPrice.toFixed(2)} ·{" "}
                          {t("pathBEstAtMoq", {
                            cost: formatUsd(est),
                          })}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => usePathBSupplier(s)}
                        className="shrink-0 rounded-md border border-amber-500 bg-amber-500 px-2.5 py-1.5 text-[11px] font-semibold text-white transition hover:bg-amber-600"
                      >
                        {t("pathBUse")}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* Path C ack only when batching the already-sampled supplier. */}
          {canBatchSelected && (
            <label className="mt-2 flex items-start gap-2">
              <input
                type="checkbox"
                checked={acks}
                onChange={(e) => setAcks(e.target.checked)}
                className="mt-0.5 size-4 accent-cedar"
              />
              <span>{t("stuckAck")}</span>
            </label>
          )}
        </div>
      )}

      {error && <p className="mt-2 text-xs text-amber-800">{t(error as never)}</p>}

      <button
        type="button"
        disabled={pending || !canBatchSelected}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const res = await orderBatchAction(supplierId, qty, acks);
            if (!res.ok) {
              setError(
                res.error === "needs_stuck_acks"
                  ? "stuckAckRequired"
                  : res.error === "sample_not_approved"
                    ? "batchNeedsSample"
                    : res.error === "sample_supplier_mismatch"
                      ? "batchSampleMismatch"
                      : "errorGeneric",
              );
            }
          });
        }}
        className="mt-3 rounded-md bg-cedar px-4 py-2 text-sm font-semibold text-foam shadow-sm transition hover:bg-cedar-deep disabled:cursor-not-allowed disabled:opacity-50"
      >
        {t("orderBatch")}
      </button>
      <p className="mt-2 text-[11px] text-stone-dark">{t("orderBatchHint")}</p>
      <p className="mt-2 rounded-md border border-sea/30 bg-sea/5 px-2.5 py-1.5 text-[11px] font-medium text-sea">
        {t("batchNoStoreNote")}
      </p>
    </div>
  );
}

function BatchArrivalEtaBlock({ eta }: { eta: BatchArrivalEtaView }) {
  const t = useTranslations("Supplier");
  const [pending, startTransition] = useTransition();
  const [preset, setPreset] = useState<EtaPreset>(
    eta.founderSet && eta.preset !== "default" ? eta.preset : "1m",
  );
  const [date, setDate] = useState(eta.date ?? "");
  const [label, setLabel] = useState(eta.label ?? "");
  const [saved, setSaved] = useState(false);
  const [planUpdated, setPlanUpdated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const presets: { id: EtaPreset; labelKey: string }[] = [
    { id: "2w", labelKey: "etaPreset2w" },
    { id: "1m", labelKey: "etaPreset1m" },
    { id: "2m", labelKey: "etaPreset2m" },
    { id: "custom", labelKey: "etaPresetCustom" },
  ];

  return (
    <div className="mt-4 rounded-lg border border-stone bg-surface-subtle p-4">
      <h3 className="text-sm font-semibold text-ink">{t("etaTitle")}</h3>
      <p className="mt-1 text-xs text-stone-dark">{t("etaIntro")}</p>
      <p className="mt-2 text-xs text-ink">
        <span className="font-medium">{t("etaCurrent")}: </span>
        {eta.summaryEn}
        {!eta.founderSet && (
          <span className="text-stone-dark"> · {t("etaUsingDefault")}</span>
        )}
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        {presets.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => {
              setPreset(p.id);
              setSaved(false);
            }}
            className={`rounded-md border px-2.5 py-1 text-xs font-medium transition ${
              preset === p.id
                ? "border-cedar bg-cedar/10 text-cedar-deep"
                : "border-stone text-ink hover:bg-sand"
            }`}
          >
            {t(p.labelKey as never)}
          </button>
        ))}
      </div>

      {preset === "custom" && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <label className="block text-xs text-stone-dark">
            {t("etaDate")}
            <input
              type="date"
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                setSaved(false);
              }}
              className="mt-1 w-full rounded border border-stone px-2 py-1.5 text-sm text-ink outline-none focus:border-cedar"
            />
          </label>
          <label className="block text-xs text-stone-dark">
            {t("etaLabel")}
            <input
              type="text"
              value={label}
              onChange={(e) => {
                setLabel(e.target.value);
                setSaved(false);
              }}
              placeholder={t("etaLabelPlaceholder")}
              className="mt-1 w-full rounded border border-stone px-2 py-1.5 text-sm text-ink outline-none focus:border-cedar"
            />
          </label>
        </div>
      )}

      {error && <p className="mt-2 text-xs text-amber-800">{t(error as never)}</p>}
      {saved && (
        <p className="mt-2 text-xs text-cedar-deep">
          {planUpdated ? t("etaPlanUpdated") : t("etaSaved")}
        </p>
      )}

      <button
        type="button"
        disabled={pending || (preset === "custom" && !date.trim() && !label.trim())}
        onClick={() => {
          setError(null);
          setPlanUpdated(false);
          startTransition(async () => {
            const res = await setBatchArrivalEtaAction({
              preset,
              date: preset === "custom" ? date || null : null,
              label: preset === "custom" ? label || null : null,
            });
            if (!res.ok) {
              setError(
                res.error === "batch_not_ordered"
                  ? "batchNeedsSample"
                  : res.error === "batch_already_arrived"
                    ? "etaLockedArrived"
                    : "errorGeneric",
              );
              return;
            }
            setPlanUpdated(res.preLaunchRegenerated);
            setSaved(true);
          });
        }}
        className="mt-3 rounded-md bg-cedar px-4 py-2 text-sm font-semibold text-foam shadow-sm transition hover:bg-cedar-deep disabled:cursor-not-allowed disabled:opacity-50"
      >
        {t("etaSave")}
      </button>
      <p className="mt-2 text-[11px] text-stone-dark">{t("etaMarketingHint")}</p>
    </div>
  );
}

function BatchArrived() {
  const t = useTranslations("Supplier");
  const [pending, startTransition] = useTransition();
  const [ack, setAck] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="mt-4 rounded-lg border border-stone bg-surface-subtle p-4">
      <h3 className="text-sm font-semibold text-ink">{t("arrivedTitle")}</h3>
      <p className="mt-1 text-xs text-stone-dark">{t("arrivedIntro")}</p>
      <label className="mt-2 flex items-start gap-2 text-xs text-stone-dark">
        <input
          type="checkbox"
          checked={ack}
          onChange={(e) => setAck(e.target.checked)}
          className="mt-0.5 size-4 accent-cedar"
        />
        <span>{t("inventoryAck")}</span>
      </label>
      {error && <p className="mt-2 text-xs text-amber-800">{t(error as never)}</p>}
      <button
        type="button"
        disabled={pending || !ack}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const res = await markBatchArrivedAction(ack);
            if (!res.ok) setError("errorGeneric");
          });
        }}
        className="mt-3 rounded-md bg-cedar px-4 py-2 text-sm font-semibold text-foam shadow-sm transition hover:bg-cedar-deep disabled:cursor-not-allowed disabled:opacity-50"
      >
        {t("markArrived")}
      </button>
    </div>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-stone-dark">{label}</dt>
      <dd className="font-medium text-ink">{children}</dd>
    </div>
  );
}
