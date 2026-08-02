"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { saveSkuNotesAction, type SkuNotesState } from "@/actions/sku";
import { MarginLegend } from "@/components/margins/MarginLegend";
import { MARGIN_BEFORE_ADS_MIN } from "@/lib/constants";
import type { SkuCardView } from "@/lib/sku/service";
import type { CurrentActualView } from "@/lib/finance/service";

const notesInitial: SkuNotesState = {};

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

/** One-decimal percent for the rolling actual after-ads margin, kept in step
 *  with the Finance hero so the SKU mirror never appears to disagree. */
function pct1(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

/** Translate a "@section.key" note; render any other string as raw text. */
function useNote() {
  const t = useTranslations("Sku");
  return (key: string) =>
    key.startsWith("@") ? t(`notes.${key.slice(1)}` as never) : key;
}

export function SkuCard({
  sku,
  actual = null,
}: {
  sku: SkuCardView;
  actual?: CurrentActualView | null;
}) {
  const t = useTranslations("Sku");
  const ind = useTranslations("Onboarding");
  const note = useNote();
  const [state, formAction, pending] = useActionState(
    saveSkuNotesAction,
    notesInitial,
  );

  return (
    <div className="surface-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-stone-dark">
            {t("kicker")}
          </p>
          <h2 className="mt-0.5 font-display text-lg text-ink">{sku.name}</h2>
          <p className="mt-0.5 text-xs text-stone-dark">
            {ind(`industries.${sku.basics.category}` as never)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="rounded-md bg-sand px-2.5 py-1 font-medium text-ink">
            {t("sellPrice")} ${sku.basics.sellPrice}
          </span>
          <span className="rounded-md bg-sand px-2.5 py-1 text-stone-dark">
            {t("landedCost")} ${sku.basics.landedCost}
          </span>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <Section title={t("secBasics")}>
          <dl className="space-y-1.5 text-sm">
            <Row label={t("category")}>
              {ind(`industries.${sku.basics.category}` as never)}
            </Row>
            <Row label={t("differentiation")}>{sku.basics.differentiation}</Row>
          </dl>
        </Section>

        <Section title={t("secShip")}>
          <div className="flex flex-wrap gap-1.5">
            <Tag>{t(`footprint.${sku.shipFitness.footprint}` as never)}</Tag>
            <Tag>{t(`parcel.${sku.shipFitness.parcelType}` as never)}</Tag>
            {sku.shipFitness.oversized && (
              <Tag tone="warn">{t("oversized")}</Tag>
            )}
          </div>
          <NoteList notes={sku.shipFitness.notes} render={note} />
        </Section>

        <Section title={t("secStorage")}>
          <div className="flex flex-wrap gap-1.5">
            <Tag>{t(`ambiance.${sku.storage.ambiance}` as never)}</Tag>
            <Tag>{t(`footprint.${sku.storage.footprint}` as never)}</Tag>
          </div>
          <NoteList notes={sku.storage.notes} render={note} />
        </Section>

        <Section title={t("secHandling")}>
          <div className="flex flex-wrap gap-1.5">
            {sku.handling.battery && <Tag tone="warn">{t("battery")}</Tag>}
            {sku.handling.fragile && <Tag tone="warn">{t("fragile")}</Tag>}
            {!sku.handling.battery && !sku.handling.fragile && (
              <Tag>{t("standardHandling")}</Tag>
            )}
          </div>
          <NoteList notes={sku.handling.notes} render={note} />
        </Section>

        <Section title={t("secImport")}>
          <dl className="space-y-1.5 text-sm">
            <Row label={t("moq")}>
              {sku.importBatch.moq ?? t("moqTbd")}
            </Row>
            <Row label={t("batchStatus")}>
              {t(`batch.${sku.importBatch.status}` as never)}
            </Row>
          </dl>
          <NoteList notes={sku.importBatch.notes} render={note} />
        </Section>

        <Section title={t("secMoney")}>
          <dl className="space-y-1.5 text-sm">
            <Row label={t("marginBefore")}>
              <span className="font-semibold text-cedar-deep">
                {pct(sku.moneySnapshot.marginBefore)}
              </span>
              <span className="ms-1 text-[10px] font-normal text-stone-dark">
                ({t("planningLabel")})
              </span>
            </Row>
            {sku.quotedCosts && (
              <Row label={t("expectedMarginBefore")}>
                <span
                  className={`font-semibold ${
                    sku.quotedCosts.expectedMarginBefore < MARGIN_BEFORE_ADS_MIN
                      ? "text-amber-800"
                      : "text-cedar-deep"
                  }`}
                >
                  {pct(sku.quotedCosts.expectedMarginBefore)}
                </span>
                <span className="ms-1 text-[10px] font-normal text-stone-dark">
                  ({t("quotedLabel")})
                </span>
              </Row>
            )}
            <Row label={t("marginAfter")}>
              <span className="font-semibold text-cedar-deep">
                {pct(sku.moneySnapshot.marginAfter)}
              </span>
              <span className="ms-1 text-[10px] font-normal text-stone-dark">
                ({t("planningLabel")})
              </span>
            </Row>
            {actual?.after != null && (
              <Row label={t("actualMarginAfter")}>
                <span
                  className={`font-semibold ${
                    actual.belowAfter ? "text-amber-800" : "text-cedar-deep"
                  }`}
                >
                  {pct1(actual.after)}
                </span>
                <span className="ms-1 text-[10px] font-normal text-stone-dark">
                  ({t("actualLabel")})
                </span>
              </Row>
            )}
          </dl>
          <MarginLegend />
          <p className="mt-2.5 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-2 text-[11px] leading-relaxed text-amber-900">
            {t("estimateDisclaimer")}
          </p>
        </Section>
      </div>

      <Section title={t("secHooks")} className="mt-3">
        <ul className="space-y-1.5 text-sm text-stone-dark">
          {sku.marketingHooks.hooks.filter(Boolean).map((h, i) => (
            <li key={i} className="flex gap-2">
              <span aria-hidden className="text-cedar">
                •
              </span>
              <span>{note(h)}</span>
            </li>
          ))}
        </ul>
      </Section>

      <form action={formAction} className="mt-4">
        <input type="hidden" name="skuId" value={sku.id} />
        <label className="text-sm font-medium text-ink">
          {t("founderNotes")}
        </label>
        <p className="mt-0.5 text-xs text-stone-dark">{t("founderNotesHint")}</p>
        <textarea
          name="founderNotes"
          defaultValue={sku.founderNotes}
          rows={3}
          placeholder={t("founderNotesPlaceholder")}
          className="mt-2 w-full rounded-md border border-stone bg-surface px-3 py-2 text-sm outline-none focus:border-cedar"
        />
        <div className="mt-2 flex items-center gap-3">
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-cedar px-4 py-2 text-sm font-semibold text-foam shadow-sm transition hover:bg-cedar-deep disabled:opacity-60"
          >
            {t("saveNotes")}
          </button>
          {state.ok && (
            <span className="text-xs text-cedar-deep">{t("saved")}</span>
          )}
        </div>
      </form>
    </div>
  );
}

function Section({
  title,
  children,
  className = "",
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-lg border border-stone bg-surface-subtle p-3 ${className}`}
    >
      <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-dark">
        {title}
      </h3>
      <div className="mt-2">{children}</div>
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
    <div className="flex items-start justify-between gap-3">
      <dt className="text-stone-dark">{label}</dt>
      <dd className="text-end font-medium text-ink">{children}</dd>
    </div>
  );
}

function Tag({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "warn";
}) {
  return (
    <span
      className={`rounded-md px-2 py-1 text-xs font-medium ${
        tone === "warn"
          ? "bg-amber-50 text-amber-900"
          : "bg-sand text-stone-dark"
      }`}
    >
      {children}
    </span>
  );
}

function NoteList({
  notes,
  render,
}: {
  notes: string[];
  render: (key: string) => string;
}) {
  if (!notes.length) return null;
  return (
    <ul className="mt-2 space-y-1 text-xs text-stone-dark">
      {notes.map((n, i) => (
        <li key={i} className="flex gap-1.5">
          <span aria-hidden className="text-cedar">
            •
          </span>
          <span>{render(n)}</span>
        </li>
      ))}
    </ul>
  );
}
