"use client";

import { useActionState, useId, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  improveStorePageCopyAction,
  markStoreReadyAction,
  saveStoreFieldsAction,
  selectStorePageCopyVersionAction,
  toggleStoreChecklistAction,
  type StoreFieldsState,
} from "@/actions/store";
import type { StorePanelView } from "@/lib/store/service";
import {
  formatDiscoverabilityForCopy,
  type DiscoverabilityPack,
} from "@/lib/store/page-copy";
import { copyTextToClipboard } from "@/lib/store/clipboard";
import { useRouter } from "@/i18n/navigation";
import {
  STORE_CHECKLIST_BUILD_KEYS,
  STORE_CHECKLIST_SECTIONS,
  type StoreChecklistKey,
} from "@/lib/constants";
import {
  buildComplete,
  canCheckStoreChecklistKey,
  goLiveReadyForTest,
  type StoreChecklistState,
} from "@/lib/store/gating";

const fieldsInitial: StoreFieldsState = {};

function gateForKey(
  checklist: StoreChecklistState,
  key: StoreChecklistKey,
): { disabled: boolean; reason: "build" | "goLiveOthers" | null } {
  const isBuild = (
    STORE_CHECKLIST_BUILD_KEYS as readonly StoreChecklistKey[]
  ).includes(key);
  if (isBuild) return { disabled: false, reason: null };

  if (!buildComplete(checklist)) {
    // Allow unchecking already-ticked Go live items if Build regresses.
    return {
      disabled: !checklist[key],
      reason: checklist[key] ? null : "build",
    };
  }

  if (key === "testCheckout" && !goLiveReadyForTest(checklist)) {
    return {
      disabled: !checklist[key],
      reason: checklist[key] ? null : "goLiveOthers",
    };
  }

  return { disabled: false, reason: null };
}

function deliveryOptions(view: StorePanelView): string[] {
  const ids = [...view.couriers];
  if (view.courierChoice && !ids.includes(view.courierChoice)) {
    ids.unshift(view.courierChoice);
  }
  return ids;
}

function deliveryCompanyLabel(
  t: ReturnType<typeof useTranslations<"Store">>,
  id: string,
): string {
  const key = `deliveryCompanies.${id}` as Parameters<typeof t>[0];
  return t.has(key) ? t(key) : id;
}

export function StorePanel({ view }: { view: StorePanelView }) {
  const t = useTranslations("Store");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [fieldsState, saveFields, fieldsPending] = useActionState(
    saveStoreFieldsAction,
    fieldsInitial,
  );
  const [openKey, setOpenKey] = useState<StoreChecklistKey | null>(null);
  const checklist = view.checklist as StoreChecklistState;

  function pickSku(skuId: string) {
    router.replace(`/store?sku=${skuId}`);
  }

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
        <div className="shrink-0 text-end tabular-nums">
          <div className="text-2xl font-semibold text-cedar-deep">
            {view.percent}%
          </div>
          <div className="text-xs text-stone-dark">{t("ready")}</div>
        </div>
      </div>

      {view.liveSkus.length > 1 && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-stone-dark">
            {t("skuPicker")}
          </span>
          {view.liveSkus.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => pickSku(s.id)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                view.selectedSkuId === s.id
                  ? "border-cedar bg-cedar/10 text-cedar-deep"
                  : "border-stone bg-surface text-ink hover:bg-sand"
              }`}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}

      <div className="mt-3 rounded-md border border-sea/40 bg-sea/10 px-3 py-2.5 text-xs font-medium text-sea">
        {t("sideOnlyNote")}
      </div>

      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-sand">
        <div
          className="h-full rounded-full bg-cedar transition-all"
          style={{ width: `${view.percent}%` }}
        />
      </div>
      <p className="mt-1.5 text-start text-xs text-stone-dark">
        {t("readyProgressNote")}
      </p>
      <p className="mt-1 text-start text-xs text-stone-dark">
        {t("honorSystemNote")}
      </p>

      {/* Build → fields → Go live */}
      <div className="mt-4 space-y-5">
        {STORE_CHECKLIST_SECTIONS.map((section) => (
          <div key={section.id} className="space-y-3">
            <section>
              <h3 className="text-sm font-semibold text-ink">
                {t(section.id)}
              </h3>
              {section.id === "goLiveSection" && (
                <p className="mt-1 text-xs text-stone-dark">
                  {t("goLiveOrientation")}
                </p>
              )}
              <ul className="mt-2 divide-y divide-stone rounded-lg border border-stone bg-surface-subtle">
                {section.keys.map((key) => {
                  const gate = gateForKey(checklist, key);
                  const disabledReason =
                    gate.reason === "build"
                      ? t("gateFinishBuild")
                      : gate.reason === "goLiveOthers"
                        ? t("gateFinishGoLiveOthers")
                        : null;
                  return (
                    <ChecklistItem
                      key={key}
                      itemKey={key}
                      checked={checklist[key]}
                      pending={pending}
                      checkDisabled={gate.disabled}
                      disabledReason={disabledReason}
                      open={openKey === key}
                      onToggleOpen={() =>
                        setOpenKey((cur) => (cur === key ? null : key))
                      }
                      onToggleChecked={(value) => {
                        if (
                          value &&
                          !canCheckStoreChecklistKey(checklist, key)
                        ) {
                          return;
                        }
                        startTransition(async () => {
                          await toggleStoreChecklistAction(key, value);
                        });
                      }}
                    />
                  );
                })}
              </ul>
            </section>

            {section.id === "buildSection" && (
              <form
                action={saveFields}
                className="grid gap-3 sm:grid-cols-3"
              >
                <label className="text-xs text-stone-dark">
                  {t("storeUrl")}
                  <input
                    name="storeUrl"
                    defaultValue={view.storeUrl ?? ""}
                    placeholder="https://…"
                    className="mt-1 w-full rounded-md border border-stone bg-surface px-2.5 py-2 text-sm outline-none focus:border-cedar"
                  />
                </label>
                <label className="text-xs text-stone-dark">
                  {t("whatsapp")}
                  <input
                    name="whatsappNumber"
                    defaultValue={view.whatsappNumber ?? ""}
                    placeholder="+961…"
                    className="mt-1 w-full rounded-md border border-stone bg-surface px-2.5 py-2 text-sm outline-none focus:border-cedar"
                  />
                </label>
                <label className="text-xs text-stone-dark">
                  {t("courier")}
                  <select
                    name="courierChoice"
                    defaultValue={view.courierChoice ?? ""}
                    className="mt-1 w-full rounded-md border border-stone bg-surface px-2.5 py-2 text-sm text-ink outline-none focus:border-cedar"
                  >
                    <option value="">{t("courierPlaceholder")}</option>
                    {deliveryOptions(view).map((id) => (
                      <option key={id} value={id}>
                        {deliveryCompanyLabel(t, id)}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="sm:col-span-3 flex items-center gap-3">
                  <button
                    type="submit"
                    disabled={fieldsPending}
                    className="rounded-md border border-stone bg-surface px-4 py-2 text-sm font-semibold text-ink transition hover:bg-sand disabled:opacity-60"
                  >
                    {t("saveFields")}
                  </button>
                  {fieldsState.ok && (
                    <span className="text-xs text-cedar-deep">{t("saved")}</span>
                  )}
                </div>
              </form>
            )}
          </div>
        ))}
      </div>

      {/* Make the page stronger — Wave 4 Phase 2 */}
      <PageStrongerSection view={view} />

      {/* Mark store ready (side-only) */}
      <div className="mt-4 border-t border-stone pt-4">
        {view.storeReady ? (
          <span className="inline-flex items-center gap-2 rounded-md bg-cedar/10 px-3 py-2 text-sm font-medium text-cedar-deep">
            {t("storeReadyDone")}
          </span>
        ) : (
          <MarkReady disabled={view.percent < 100} />
        )}
      </div>
    </div>
  );
}

function PageStrongerSection({ view }: { view: StorePanelView }) {
  const t = useTranslations("Store");
  const locale = useLocale();
  const isAr = locale === "ar";
  const router = useRouter();
  const [improvePending, startImprove] = useTransition();
  const [selectPending, startSelect] = useTransition();
  const [improveError, setImproveError] = useState<string | null>(null);
  const [improveNote, setImproveNote] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const tips = view.discoverability
    ? isAr
      ? view.discoverability.attractivenessTipsAr
      : view.discoverability.attractivenessTipsEn
    : [];

  const aiLeft = view.pageCopyAiLeft;
  const atCap = aiLeft <= 0;
  const hasVersions = view.pageCopyVersions.length > 0;
  const hasAiVersion = view.pageCopyAiCount > 0;
  const canRunAi = Boolean(view.selectedSkuId) && !atCap;

  async function copyField(key: string, text: string) {
    const ok = await copyTextToClipboard(text);
    if (!ok) return;
    setCopiedKey(key);
    window.setTimeout(() => setCopiedKey((cur) => (cur === key ? null : cur)), 2000);
  }

  function runImprove() {
    setImproveError(null);
    setImproveNote(null);
    startImprove(async () => {
      const skuId = view.selectedSkuId;
      if (!skuId) {
        setImproveError("noSku");
        return;
      }
      const res = await improveStorePageCopyAction(skuId);
      if (!res.ok) {
        setImproveError(
          res.error === "noSku"
            ? "noSku"
            : res.error === "aiCap"
              ? "aiCap"
              : "errorGeneric",
        );
        return;
      }
      setImproveNote(
        res.source === "gemini" ? "improveAiOk" : "improveTemplateOk",
      );
      router.refresh();
    });
  }

  return (
    <section className="mt-6 border-t border-stone pt-5">
      <h3 className="font-display text-base text-ink">{t("pageStrongerTitle")}</h3>
      <p className="mt-1 max-w-2xl text-sm text-stone-dark">
        {t("pageStrongerIntro", {
          name: view.skuName ?? t("pageStrongerNoSku"),
        })}
      </p>
      <p className="mt-2 text-xs text-stone-dark">{t("pageStrongerHonesty")}</p>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={improvePending || !canRunAi}
          onClick={runImprove}
          className="rounded-md bg-cedar px-4 py-2 text-sm font-semibold text-foam transition hover:bg-cedar-deep disabled:cursor-not-allowed disabled:opacity-50"
        >
          {improvePending
            ? t("improving")
            : hasAiVersion
              ? t("regenerateAi")
              : t("improveWithAi")}
        </button>
        <span className="text-xs text-stone-dark">
          {t("aiImprovesLeft", {
            n: aiLeft,
            max: view.pageCopyMaxAi,
          })}
        </span>
        {!view.geminiConfigured && (
          <span className="text-xs text-amber-900/90">{t("aiUnavailable")}</span>
        )}
        {atCap && (
          <span className="text-xs text-stone-dark">{t("aiCapHint")}</span>
        )}
        {improveError && (
          <span className="text-xs text-amber-800">
            {t(improveError as never)}
          </span>
        )}
        {improveNote && (
          <span className="text-xs text-cedar-deep">
            {t(improveNote as never)}
          </span>
        )}
      </div>

      {hasVersions && (
        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-stone-dark">
            {t("versionPicker")}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {view.pageCopyVersions.map((v) => {
              const active = v.index === view.pageCopyActiveIndex;
              const label =
                v.kind === "baseline"
                  ? t("versionBaseline")
                  : t("versionAi", { n: v.aiOrdinal ?? v.index });
              return (
                <button
                  key={v.index}
                  type="button"
                  disabled={selectPending || active}
                  aria-pressed={active}
                  onClick={() => {
                    startSelect(async () => {
                      if (!view.selectedSkuId) return;
                      await selectStorePageCopyVersionAction(
                        view.selectedSkuId,
                        v.index,
                      );
                      router.refresh();
                    });
                  }}
                  className={`rounded-md border px-3 py-1.5 text-xs font-semibold transition ${
                    active
                      ? "border-cedar bg-cedar/10 text-cedar-deep"
                      : "border-stone bg-surface text-ink hover:bg-sand disabled:opacity-50"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {tips.length > 0 && (
        <div className="mt-4">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-cedar-deep">
            {t("attractivenessTips")}
          </h4>
          <ul className="mt-2 space-y-1.5 text-sm text-stone-dark">
            {tips.map((tip, i) => (
              <li key={i} className="flex gap-1.5">
                <span aria-hidden className="text-cedar">
                  •
                </span>
                <span>{tip}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div
        key={`${view.pageCopyActiveIndex}-${view.contentDraftEn.length}-${view.discoverability?.titleEn ?? ""}`}
        className="mt-4 grid gap-3 md:grid-cols-3"
      >
        <ReadonlyDraft
          title={t("draftEn")}
          value={view.contentDraftEn}
          copied={copiedKey === "en"}
          onCopy={() => copyField("en", view.contentDraftEn)}
        />
        <ReadonlyDraft
          title={t("draftAr")}
          value={view.contentDraftAr}
          rtl
          copied={copiedKey === "ar"}
          onCopy={() => copyField("ar", view.contentDraftAr)}
        />
        <ReadonlyDraft
          title={t("draftPolicies")}
          value={view.policiesDraft}
          copied={copiedKey === "policies"}
          onCopy={() => copyField("policies", view.policiesDraft)}
        />
      </div>

      {view.discoverability ? (
        <DiscoverabilityBlock
          pack={view.discoverability}
          isAr={isAr}
          copied={copiedKey === "pack"}
          onCopy={() =>
            copyField(
              "pack",
              formatDiscoverabilityForCopy(view.discoverability!),
            )
          }
        />
      ) : (
        <p className="mt-4 text-xs text-stone-dark">{t("discoverabilityEmpty")}</p>
      )}
    </section>
  );
}

function DiscoverabilityBlock({
  pack,
  isAr,
  copied,
  onCopy,
}: {
  pack: DiscoverabilityPack;
  isAr: boolean;
  copied: boolean;
  onCopy: () => void;
}) {
  const t = useTranslations("Store");
  return (
    <div className="mt-5 rounded-lg border border-stone bg-surface-subtle p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h4 className="text-sm font-semibold text-ink">
            {t("discoverabilityTitle")}
          </h4>
          <p className="mt-1 max-w-2xl whitespace-pre-line text-xs text-stone-dark">
            {t("discoverabilityIntro")}
          </p>
        </div>
        <button
          type="button"
          onClick={onCopy}
          className="rounded-md border border-cedar/40 bg-cedar/10 px-3 py-1.5 text-xs font-semibold text-cedar-deep transition hover:bg-cedar/15"
        >
          {copied ? t("copied") : t("copyPack")}
        </button>
      </div>

      <dl className="mt-3 space-y-3 text-sm">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-stone-dark">
            {t("seoTitle")}
          </dt>
          <dd className="mt-0.5 text-ink" dir={isAr ? "rtl" : "ltr"}>
            {isAr ? pack.titleAr : pack.titleEn}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-stone-dark">
            {t("seoShort")}
          </dt>
          <dd
            className="mt-0.5 whitespace-pre-line text-stone-dark"
            dir={isAr ? "rtl" : "ltr"}
          >
            {isAr ? pack.shortDescriptionAr : pack.shortDescriptionEn}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-stone-dark">
            {t("seoPhrases")}
          </dt>
          <dd className="mt-1 flex flex-wrap gap-1.5">
            {(isAr ? pack.searchPhrasesAr : pack.searchPhrasesEn).map((p) => (
              <span
                key={p}
                className="rounded border border-stone bg-surface px-2 py-0.5 text-xs text-ink"
              >
                {p}
              </span>
            ))}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-stone-dark">
            {t("seoFaqs")}
          </dt>
          <dd className="mt-1 space-y-2">
            {pack.faqs.map((f, i) => (
              <div key={i} className="text-stone-dark" dir={isAr ? "rtl" : "ltr"}>
                <p className="font-medium text-ink">
                  {isAr ? f.qAr : f.qEn}
                </p>
                <p className="mt-0.5 text-xs leading-relaxed">
                  {isAr ? f.aAr : f.aEn}
                </p>
              </div>
            ))}
          </dd>
        </div>
      </dl>
    </div>
  );
}

function ChecklistItem({
  itemKey,
  checked,
  pending,
  checkDisabled,
  disabledReason,
  open,
  onToggleOpen,
  onToggleChecked,
}: {
  itemKey: StoreChecklistKey;
  checked: boolean;
  pending: boolean;
  checkDisabled: boolean;
  disabledReason: string | null;
  open: boolean;
  onToggleOpen: () => void;
  onToggleChecked: (value: boolean) => void;
}) {
  const t = useTranslations("Store");
  const uid = useId();
  const checkId = `${uid}-check`;
  const panelId = `${uid}-howto`;
  const inputDisabled = pending || checkDisabled;

  return (
    <li className="px-3 py-2.5">
      <div className="flex items-start gap-2.5">
        <input
          id={checkId}
          type="checkbox"
          checked={checked}
          disabled={inputDisabled}
          onChange={(e) => onToggleChecked(e.target.checked)}
          className="mt-1 size-4 shrink-0 accent-cedar disabled:opacity-50"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <label
                htmlFor={checkId}
                className={`block text-sm font-medium ${inputDisabled && !checked ? "text-stone-dark" : "text-ink"}`}
              >
                {t(`checklist.${itemKey}`)}
              </label>
              <p className="mt-0.5 text-xs text-stone-dark">
                {t(`checklistHint.${itemKey}`)}
              </p>
              {checkDisabled && disabledReason && (
                <p className="mt-1 text-xs font-medium text-stone-dark">
                  {disabledReason}
                </p>
              )}
            </div>
            <button
              type="button"
              aria-expanded={open}
              aria-controls={panelId}
              onClick={onToggleOpen}
              className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-sea transition hover:bg-sea/10"
            >
              {t("howToToggle")}
              <span
                aria-hidden
                className={`text-stone-dark transition ${open ? "rotate-180" : ""}`}
              >
                ▾
              </span>
            </button>
          </div>
          {open && (
            <div
              id={panelId}
              className="mt-2 rounded-md border border-stone bg-surface px-3 py-2 text-xs text-stone-dark"
            >
              <p className="font-semibold text-ink">
                {t(`howto.${itemKey}.title`)}
              </p>
              <div className="mt-2">
                <HowToBody text={t(`howto.${itemKey}.body`)} />
              </div>
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

/** Plain paragraphs + bullet lines from Store.howto.*.body. */
function HowToBody({ text }: { text: string }) {
  const blocks = text.split(/\n\n+/).filter(Boolean);
  return (
    <div className="space-y-2">
      {blocks.map((block, i) => {
        const lines = block.split("\n").filter(Boolean);
        const allBullets = lines.every((l) => /^[•\-\*]/.test(l.trim()));
        if (allBullets) {
          return (
            <ul key={i} className="space-y-1">
              {lines.map((line, li) => (
                <li key={li} className="flex gap-1.5 leading-relaxed">
                  <span aria-hidden className="text-cedar">
                    •
                  </span>
                  <span>{line.replace(/^[•\-\*]\s*/, "")}</span>
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i} className="leading-relaxed whitespace-pre-line">
            {block}
          </p>
        );
      })}
    </div>
  );
}

function MarkReady({ disabled }: { disabled: boolean }) {
  const t = useTranslations("Store");
  const [pending, startTransition] = useTransition();
  return (
    <div>
      <button
        type="button"
        disabled={pending || disabled}
        onClick={() =>
          startTransition(async () => {
            await markStoreReadyAction();
          })
        }
        className="rounded-md bg-cedar px-4 py-2 text-sm font-semibold text-foam shadow-sm transition hover:bg-cedar-deep disabled:cursor-not-allowed disabled:opacity-50"
      >
        {t("markReady")}
      </button>
      {disabled && (
        <p className="mt-1.5 text-xs text-stone-dark">{t("markReadyHint")}</p>
      )}
    </div>
  );
}

function ReadonlyDraft({
  title,
  value,
  rtl = false,
  copied,
  onCopy,
}: {
  title: string;
  value: string;
  rtl?: boolean;
  copied: boolean;
  onCopy: () => void;
}) {
  const t = useTranslations("Store");
  return (
    <div className="rounded-lg border border-stone bg-surface-subtle p-3">
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-stone-dark">
          {title}
        </h4>
        <button
          type="button"
          onClick={onCopy}
          className="shrink-0 rounded-md border border-cedar/40 bg-cedar/10 px-2.5 py-1 text-xs font-semibold text-cedar-deep transition hover:bg-cedar/15"
        >
          {copied ? t("copied") : t("copyDraft")}
        </button>
      </div>
      <textarea
        readOnly
        dir={rtl ? "rtl" : undefined}
        value={value}
        rows={8}
        className="mt-2 w-full rounded border border-stone bg-surface p-2 text-[11px] text-stone-dark"
      />
    </div>
  );
}
