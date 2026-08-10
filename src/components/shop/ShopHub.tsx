"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import {
  pauseSkusAction,
  restoreSkuAction,
  resumeSkusAction,
  startAddSkuAction,
  wipeSkuAction,
  type AddSkuActionState,
} from "@/actions/sku";
import { ToolsRow } from "@/components/shop/ToolsRow";
import { UnitsLeftGlanceBlock } from "@/components/shop/UnitsLeftGlance";
import { SupplierDisplayNameEditor } from "@/components/supplier/SupplierDisplayNameEditor";
import type { UnitsLeftGlance } from "@/lib/finance/sku-runway";
import {
  buildToolsHrefs,
  skuToolHref,
  type ToolsUnlockFlags,
} from "@/lib/sku/tools";

export type ShopSkuChip = {
  id: string;
  name: string;
  primaryState: string;
  paused: boolean;
  attention: Array<{ label: string; href: string }>;
  /** Working/path supplier only — never spare-only names. */
  workingSupplierName: string | null;
  /** When name is set — enables founder rename after sample. */
  workingSupplierId: string | null;
  /**
   * Spare insurance unlocked for this SKU’s journey.
   * When false, omit the spares line (don’t list cold backups).
   */
  insuranceAvailable: boolean;
  /** Warmed (approved) same-source non-path suppliers — this skuId only. */
  warmedSpareNames: string[];
  /** Read-only Topic A units left; omit when hub should not show glance. */
  unitsLeftGlance?: UnitsLeftGlance | null;
};

export type ShopHubProps = {
  shopPaused: boolean;
  storeReadyPercent: number;
  financeHref: string;
  financeLabel: string;
  /** False when no live SKU has batch arrived / selling — chip must not promise open Finance. */
  financeUnlocked: boolean;
  /** Live SKU used for Supplier/Marketing/Finance deep-links. */
  toolsTargetSkuId: string;
  toolsUnlocked: ToolsUnlockFlags;
  /**
   * Shop-level “what next” — orientation only (same label as orientation SKU’s
   * primary attention chip). Not a link; founder opens a SKU to act.
   */
  hubNext: { label: string; skuName: string } | null;
  /** Server-rendered Supplier → Marketing → Journey (after products / Add SKU). */
  children?: ReactNode;
  coaching: string[];
  skus: ShopSkuChip[];
  archived: Array<{ id: string; name: string }>;
  addSku: {
    ok: boolean;
    error?: string;
    warning?: string;
    seriousnessWarning: boolean;
  };
};

function stateLabel(
  t: ReturnType<typeof useTranslations<"Shop">>,
  state: string,
): string {
  const key = `state.${state}` as
    | "state.discovery"
    | "state.supplier_sample"
    | "state.sample_approved"
    | "state.store_setup"
    | "state.batch_ordered"
    | "state.batch_arrived_ready"
    | "state.selling"
    | "state.paused";
  try {
    return t(key);
  } catch {
    return state;
  }
}

export function ShopHub({
  shopPaused,
  storeReadyPercent,
  financeHref,
  financeLabel,
  financeUnlocked,
  toolsTargetSkuId,
  toolsUnlocked,
  hubNext,
  children,
  coaching,
  skus,
  archived,
  addSku,
}: ShopHubProps) {
  const t = useTranslations("Shop");
  const [selected, setSelected] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();
  const [addState, setAddState] = useState<AddSkuActionState>({});
  const [ackSerious, setAckSerious] = useState(false);

  function toggle(id: string) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  const toolsHrefs = buildToolsHrefs(toolsTargetSkuId);
  const showSparesSwitchNote = skus.some((s) => s.insuranceAvailable);

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-stone-dark">
          {t("kicker")}
        </p>
        <h1 className="font-display text-2xl text-ink">{t("title")}</h1>
        <p className="mt-1 max-w-xl text-sm text-stone-dark">{t("intro")}</p>
        {hubNext && (
          <p className="mt-3 max-w-xl text-sm font-semibold text-cedar-deep">
            {t("hubNextLine", {
              label: hubNext.label,
              name: hubNext.skuName,
            })}
          </p>
        )}
      </div>

      {shopPaused && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {t("shopPausedBanner")}
        </div>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-ink">{t("shopToolsTitle")}</h2>
        <ToolsRow hrefs={toolsHrefs} unlocked={toolsUnlocked} />
        <div className="flex flex-wrap items-center gap-2">
          {financeUnlocked ? (
            <Link
              href={financeHref}
              className="rounded-md border border-stone bg-surface px-3 py-2 text-xs font-medium text-ink transition hover:bg-sand"
            >
              {financeLabel}
            </Link>
          ) : (
            <Link
              href="/finance"
              title={financeLabel}
              className="rounded-md border border-stone/60 bg-surface-subtle px-3 py-2 text-xs font-medium text-stone-dark/80 transition hover:bg-sand"
            >
              {financeLabel}
            </Link>
          )}
          <Link
            href="/store"
            className="rounded-md border border-sea/40 bg-sea/5 px-3 py-2 text-xs font-medium text-sea underline-offset-2 transition hover:bg-sea/10 hover:underline"
          >
            {t("storePct", { pct: storeReadyPercent })}
          </Link>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-ink">{t("skusTitle")}</h2>
        {skus.length === 0 ? (
          <p className="text-sm text-stone-dark">{t("noSkus")}</p>
        ) : (
          <ul className="space-y-3">
            {skus.map((sku) => (
              <li
                key={sku.id}
                className="rounded-lg border border-stone bg-surface px-4 py-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <input
                        type="checkbox"
                        checked={selected.includes(sku.id)}
                        onChange={() => toggle(sku.id)}
                        aria-label={t("selectSku", { name: sku.name })}
                        className="size-4 shrink-0 accent-cedar"
                      />
                      <Link
                        href={`/sku/${sku.id}`}
                        className="truncate font-medium text-ink underline-offset-2 hover:underline"
                        dir="auto"
                      >
                        {sku.name}
                      </Link>
                      {sku.paused && (
                        <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-900">
                          {t("paused")}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 ps-6 text-[11px] text-stone-dark">
                      {sku.workingSupplierName && sku.workingSupplierId ? (
                        <span className="inline-flex min-w-0 flex-wrap items-baseline gap-x-1">
                          <span>{t("workingSupplierPrefix")}</span>
                          <SupplierDisplayNameEditor
                            supplierId={sku.workingSupplierId}
                            skuId={sku.id}
                            name={sku.workingSupplierName}
                            nameClassName="text-[11px] font-medium text-ink"
                            compact
                          />
                        </span>
                      ) : sku.workingSupplierName ? (
                        t("workingSupplier", { name: sku.workingSupplierName })
                      ) : (
                        t("workingSupplierNone")
                      )}
                    </div>
                    {sku.insuranceAvailable && (
                      <p className="mt-0.5 ps-6 text-[11px] text-stone-dark">
                        {sku.warmedSpareNames.length > 0 ? (
                          <>
                            {t("sparesReady", {
                              count: sku.warmedSpareNames.length,
                              names: sku.warmedSpareNames.slice(0, 2).join(", "),
                            })}
                            {sku.warmedSpareNames.length > 2 && (
                              <>
                                {" "}
                                {t("sparesMore", {
                                  n: sku.warmedSpareNames.length - 2,
                                })}
                              </>
                            )}
                          </>
                        ) : (
                          t("sparesNoneYet")
                        )}{" "}
                        <Link
                          href={skuToolHref(sku.id, "supplier")}
                          className="font-medium text-sea underline-offset-2 hover:underline"
                        >
                          {t("sparesManageLink")}
                        </Link>
                      </p>
                    )}
                  </div>
                  <span className="text-xs text-stone-dark">
                    {stateLabel(t, sku.primaryState)}
                  </span>
                </div>
                {sku.unitsLeftGlance != null && (
                  <div className="mt-2">
                    <UnitsLeftGlanceBlock
                      glance={sku.unitsLeftGlance}
                      compact
                      inventoryHref={`/sku/${sku.id}?attn=arrived#supplier`}
                    />
                  </div>
                )}
                {sku.attention.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {sku.attention.map((chip) => (
                      <Link
                        key={`${chip.label}:${chip.href}`}
                        href={chip.href}
                        className="rounded-full border border-sea/30 bg-sea/5 px-2.5 py-1 text-[11px] font-medium text-sea transition hover:bg-sea/10"
                      >
                        {chip.label}
                      </Link>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {showSparesSwitchNote && (
          <p className="text-[11px] text-stone-dark">{t("sparesSwitchNote")}</p>
        )}

        {selected.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  await pauseSkusAction(selected);
                  setSelected([]);
                })
              }
              className="rounded-md border border-stone px-3 py-1.5 text-xs font-medium text-ink hover:bg-sand disabled:opacity-50"
            >
              {t("pauseSelected")}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  await resumeSkusAction(selected);
                  setSelected([]);
                })
              }
              className="rounded-md border border-stone px-3 py-1.5 text-xs font-medium text-ink hover:bg-sand disabled:opacity-50"
            >
              {t("resumeSelected")}
            </button>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-stone bg-surface-subtle p-4">
        <h2 className="text-sm font-semibold text-ink">{t("addSkuTitle")}</h2>
        <p className="mt-1 text-xs text-stone-dark">{t("addSkuIntro")}</p>

        {!addSku.ok && addSku.error === "beginner_blocked" && (
          <p className="mt-2 text-sm text-amber-900">{t("gate.beginner_blocked")}</p>
        )}
        {addSku.ok && addSku.warning === "early_add" && (
          <p className="mt-2 text-sm text-amber-900">{t("gate.early_add")}</p>
        )}
        {addSku.ok && addSku.warning === "watch_previous_sku" && (
          <p className="mt-2 text-sm text-amber-900">
            {t("gate.watch_previous_sku")}
          </p>
        )}
        {addSku.ok && addSku.warning === "both" && (
          <p className="mt-2 text-sm text-amber-900">{t("gate.both")}</p>
        )}
        {addSku.seriousnessWarning && (
          <label className="mt-3 flex items-start gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={ackSerious}
              onChange={(e) => setAckSerious(e.target.checked)}
              className="mt-0.5 size-4 accent-cedar"
            />
            <span dir="auto">{t("gate.experienced_serious")}</span>
          </label>
        )}
        {addState.error && (
          <p className="mt-2 text-sm text-amber-900">
            {addState.error === "need_serious_ack"
              ? t("gate.need_serious_ack")
              : addState.error === "beginner_blocked"
                ? t("gate.beginner_blocked")
                : addState.error}
          </p>
        )}

        <button
          type="button"
          disabled={
            pending ||
            !addSku.ok ||
            (addSku.seriousnessWarning && !ackSerious)
          }
          onClick={() =>
            startTransition(async () => {
              const fd = new FormData();
              if (ackSerious) fd.set("ackSerious", "1");
              const res = await startAddSkuAction({}, fd);
              setAddState(res);
            })
          }
          className="mt-3 rounded-md bg-cedar px-4 py-2 text-sm font-semibold text-foam shadow-sm transition hover:bg-cedar-deep disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t("addSkuCta")}
        </button>
      </section>

      {children}

      {archived.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-ink">{t("archivedTitle")}</h2>
          <p className="text-xs text-stone-dark">{t("archivedHint")}</p>
          <ul className="space-y-2">
            {archived.map((a) => (
              <li
                key={a.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-stone px-3 py-2"
              >
                <Link
                  href={`/sku/${a.id}`}
                  className="text-sm font-medium text-ink underline-offset-2 hover:underline"
                  dir="auto"
                >
                  {a.name}
                </Link>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        await restoreSkuAction(a.id);
                      })
                    }
                    className="rounded-md bg-cedar px-3 py-1.5 text-xs font-semibold text-foam shadow-sm transition hover:bg-cedar-deep disabled:opacity-50"
                  >
                    {t("restore")}
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      if (!window.confirm(t("wipeConfirm"))) return;
                      startTransition(async () => {
                        await wipeSkuAction(a.id);
                      });
                    }}
                    className="rounded-md border border-amber-400 px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-50 disabled:opacity-50"
                  >
                    {t("wipe")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {coaching.length > 0 && (
        <section className="rounded-lg border border-sea/20 bg-sea/5 p-4">
          <h2 className="text-sm font-semibold text-ink">{t("coachingTitle")}</h2>
          <ul className="mt-2 list-disc space-y-1 ps-5 text-sm text-stone-dark">
            {coaching.map((c) => (
              <li key={c} dir="auto">
                {c}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
