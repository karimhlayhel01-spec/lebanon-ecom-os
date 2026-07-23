"use client";

import { useActionState, useId, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import {
  markStoreReadyAction,
  saveStoreFieldsAction,
  toggleStoreChecklistAction,
  type StoreFieldsState,
} from "@/actions/store";
import type { StorePanelView } from "@/lib/store/service";
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
  const [pending, startTransition] = useTransition();
  const [fieldsState, saveFields, fieldsPending] = useActionState(
    saveStoreFieldsAction,
    fieldsInitial,
  );
  const [showDrafts, setShowDrafts] = useState(false);
  const [openKey, setOpenKey] = useState<StoreChecklistKey | null>(null);
  const checklist = view.checklist as StoreChecklistState;

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

      {/* Drafts */}
      <button
        type="button"
        onClick={() => setShowDrafts((v) => !v)}
        className="mt-4 text-xs font-medium text-sea underline-offset-2 hover:underline"
      >
        {showDrafts ? t("hideDrafts") : t("showDrafts")}
      </button>
      {showDrafts && (
        <div className="mt-2 grid gap-3 md:grid-cols-3">
          <Draft title={t("draftEn")} value={view.contentDraftEn} />
          <Draft title={t("draftAr")} value={view.contentDraftAr} rtl />
          <Draft title={t("draftPolicies")} value={view.policiesDraft} />
        </div>
      )}

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

function Draft({
  title,
  value,
  rtl = false,
}: {
  title: string;
  value: string;
  rtl?: boolean;
}) {
  return (
    <div className="rounded-lg border border-stone bg-surface-subtle p-3">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-stone-dark">
        {title}
      </h4>
      <textarea
        readOnly
        dir={rtl ? "rtl" : undefined}
        value={value}
        rows={7}
        className="mt-2 w-full rounded border border-stone bg-surface p-2 text-[11px] text-stone-dark"
      />
    </div>
  );
}
