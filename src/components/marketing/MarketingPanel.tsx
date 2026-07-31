"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import {
  generateKitAction,
  saveKitCreativesAction,
} from "@/actions/marketing";
import type {
  Creative,
  MarketingKitView,
  MarketingPanelView,
} from "@/lib/marketing/service";
import { compareCreativesByCalendar } from "@/lib/marketing/creatives";
import type { BatchArrivalEtaView } from "@/lib/supplier/batch-eta";
import type { MarketingStage } from "@/lib/constants";

export function MarketingPanel({
  view,
  requestedStage,
  surface = "deep",
}: {
  view: MarketingPanelView;
  requestedStage?: string;
  /**
   * `sku` = embedded on `/sku/[id]` (primary surface) — stage picks stay local.
   * `deep` = `/marketing` route (secondary door to the same work).
   */
  surface?: "deep" | "sku";
}) {
  const t = useTranslations("Marketing");
  const router = useRouter();

  // Sticky selection: deep link wins; otherwise last user pick; else journey default.
  const [userStage, setUserStage] = useState<MarketingStage | null>(null);

  const activeStage = (() => {
    if (requestedStage) {
      const info = view.stages.find(
        (s) => s.stage === requestedStage && s.unlocked,
      );
      if (info) return info.stage;
    }
    if (
      userStage &&
      view.stages.some((s) => s.stage === userStage && s.unlocked)
    ) {
      return userStage;
    }
    return view.currentStage;
  })();

  // Only the selected stage’s kits — never dump other stages under this screen.
  const activeKits = view.kits.filter((k) => k.stage === activeStage);

  function stickToStage(stage: MarketingStage) {
    setUserStage(stage);
    // On the SKU page, keep the founder on the product spine — don't bounce to /marketing.
    if (surface === "sku") return;
    const skuQ = view.isShopKit
      ? "shop"
      : (view.selectedSkuId ?? undefined);
    const qs = new URLSearchParams({ stage });
    if (skuQ) qs.set("sku", skuQ);
    router.replace(`/marketing?${qs.toString()}`);
  }

  function pickSku(skuId: string | null) {
    // Prefer the SKU product page as the primary work surface.
    if (skuId) {
      router.push(`/sku/${skuId}#marketing`);
      return;
    }
    setUserStage(null);
    router.replace("/marketing?sku=shop");
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
        <span className="whitespace-nowrap rounded-full border border-cedar/30 bg-cedar/10 px-3 py-1.5 text-xs font-semibold text-cedar-deep">
          {t("capacity", { n: view.capacityTier })}
        </span>
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
                view.selectedSkuId === s.id && !view.isShopKit
                  ? "border-cedar bg-cedar/10 text-cedar-deep"
                  : "border-stone bg-surface text-ink hover:bg-sand"
              }`}
              dir="auto"
            >
              {s.name}
            </button>
          ))}
          {view.shopKitAvailable && (
            <button
              type="button"
              onClick={() => pickSku(null)}
              title={t("shopKitHint")}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                view.isShopKit
                  ? "border-cedar bg-cedar/10 text-cedar-deep"
                  : "border-stone bg-surface text-ink hover:bg-sand"
              }`}
            >
              {t("shopKit")}
            </button>
          )}
        </div>
      )}

      <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
        {view.needsMarginAck
          ? t("notMoneyAdviceMarginsLow")
          : t("notMoneyAdvice")}
      </div>

      {!view.whatsappSet && (
        <div className="mt-2 rounded-md border border-sea/30 bg-sea/5 px-3 py-2 text-xs text-sea">
          {t("whatsappRequired")}
        </div>
      )}

      {activeStage === "pre_launch" &&
        !view.stages.some((s) => s.stage === "launch" && s.unlocked) && (
          <PreLaunchEtaBanner
            eta={view.batchArrivalEta}
            supplierHref={
              view.selectedSkuId
                ? `/sku/${view.selectedSkuId}#supplier`
                : "/supplier"
            }
          />
        )}

      {/* Stage rail — free travel among unlocked stages */}
      <div className="mt-4 grid items-stretch gap-2 sm:grid-cols-4">
        {view.stages.map((s) => (
          <StageCard
            key={s.stage}
            stage={s.stage}
            unlocked={s.unlocked}
            paidRule={s.paidRule}
            current={activeStage === s.stage}
            maxDailyPaid={view.maxDailyPaid}
            hasKit={view.kits.some((k) => k.stage === s.stage)}
            onGenerated={stickToStage}
            onSelect={stickToStage}
            kitSkuId={view.isShopKit ? null : view.selectedSkuId}
            surface={surface}
          />
        ))}
      </div>

      {/* Kits for the active stage only */}
      <div className="mt-5 space-y-4">
        {activeKits.length === 0 ? (
          <p className="text-sm text-stone-dark">
            {view.kits.length === 0
              ? t("noKits")
              : t("noKitForStage", {
                  stage: t(`stage.${activeStage}` as never),
                })}
          </p>
        ) : (
          activeKits
            .slice()
            .reverse()
            .map((kit) => <KitBlock key={kit.id} kit={kit} />)
        )}
      </div>
    </div>
  );
}

function PreLaunchEtaBanner({
  eta,
  supplierHref,
}: {
  eta: BatchArrivalEtaView;
  supplierHref: string;
}) {
  const t = useTranslations("Marketing");
  const locale = useLocale();
  const summary = locale === "ar" ? eta.summaryAr : eta.summaryEn;

  return (
    <div className="mt-3 rounded-md border border-stone bg-surface-subtle px-3 py-2.5 text-xs text-ink">
      <p className="font-semibold">{t("etaTitle")}</p>
      <p className="mt-1 text-stone-dark">
        {t("etaSummary", { summary, weeks: eta.weekCount })}
      </p>
      {eta.founderSet ? (
        <p className="mt-1 text-stone-dark">
          {t("etaSetNote", { weeks: eta.weekCount })}
        </p>
      ) : (
        <p className="mt-1 text-amber-900">
          {t("etaDefaultNote")}{" "}
          <Link
            href={supplierHref}
            className="font-semibold text-cedar-deep underline underline-offset-2"
          >
            {t("etaGoSupplier")}
          </Link>
        </p>
      )}
    </div>
  );
}

function StageCard({
  stage,
  unlocked,
  paidRule,
  current,
  maxDailyPaid,
  hasKit,
  onGenerated,
  onSelect,
  kitSkuId,
  surface,
}: {
  stage: MarketingStage;
  unlocked: boolean;
  paidRule: "none" | "capped" | "full";
  current: boolean;
  maxDailyPaid: number;
  hasKit: boolean;
  onGenerated: (stage: MarketingStage) => void;
  onSelect: (stage: MarketingStage) => void;
  /** null = shop kit; string = SKU id; undefined = active SKU default */
  kitSkuId?: string | null;
  surface: "deep" | "sku";
}) {
  const t = useTranslations("Marketing");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Intro lesson is fixed once generated — no regenerate control.
  const showGenerate = !(stage === "intro_pdf" && hasKit);

  const generateLabel =
    stage === "monthly_refresh"
      ? hasKit
        ? t("regenerateRefresh")
        : t("refresh")
      : stage === "intro_pdf"
        ? t("generateLesson")
        : hasKit
          ? t("regenerate")
          : t("generate");

  const stageHref =
    surface === "sku" && kitSkuId
      ? `/sku/${kitSkuId}#marketing`
      : kitSkuId
        ? `/marketing?stage=${stage}&sku=${kitSkuId}`
        : `/marketing?stage=${stage}`;

  return (
    <div
      className={`relative flex min-h-full flex-col rounded-lg border p-3 ${
        current
          ? "border-cedar/40 bg-cedar/5"
          : unlocked
            ? "border-stone bg-surface-subtle"
            : "border-stone bg-sand/40 opacity-70"
      }`}
    >
      {unlocked &&
        (surface === "sku" ? (
          <button
            type="button"
            aria-label={t(`stage.${stage}` as never)}
            aria-current={current ? "page" : undefined}
            onClick={() => onSelect(stage)}
            className="absolute inset-0 z-0 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cedar"
          />
        ) : (
          <Link
            href={stageHref}
            aria-label={t(`stage.${stage}` as never)}
            aria-current={current ? "page" : undefined}
            className="absolute inset-0 z-0 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cedar"
          />
        ))}

      <h3 className="relative z-[1] text-sm font-semibold text-ink pointer-events-none">
        {t(`stage.${stage}` as never)}
      </h3>
      <p className="relative z-[1] mt-1 min-h-[2.5rem] text-[11px] leading-snug text-stone-dark pointer-events-none">
        {paidRule === "none"
          ? t("paidNone")
          : paidRule === "capped"
            ? t("paidCapped", { max: maxDailyPaid })
            : t("paidFull")}
      </p>

      <div className="relative z-[1] mt-auto flex flex-col justify-end gap-2 pt-2">
        {error && (
          <p className="text-[11px] text-amber-800">{t(error as never)}</p>
        )}

        {showGenerate && (
          <button
            type="button"
            disabled={!unlocked || pending}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setError(null);
              startTransition(async () => {
                // Button click acknowledges launch budget rules (no checkbox).
                const res = await generateKitAction(
                  stage,
                  true,
                  kitSkuId,
                );
                if (!res.ok) {
                  setError(
                    res.error === "stage_locked"
                      ? "stageLocked"
                      : "errorGeneric",
                  );
                  return;
                }
                onGenerated(stage);
              });
            }}
            onPointerDown={(e) => e.stopPropagation()}
            className="w-full rounded-md bg-cedar px-3 py-1.5 text-xs font-semibold text-foam transition hover:bg-cedar-deep disabled:cursor-not-allowed disabled:opacity-50"
          >
            {generateLabel}
          </button>
        )}
      </div>
    </div>
  );
}

function KitBlock({ kit }: { kit: MarketingKitView }) {
  if (kit.kind === "intro_lesson" && kit.lesson) {
    return <IntroLessonBlock kit={kit} lesson={kit.lesson} />;
  }
  // Remount when regenerate swaps creative ids so local edit state resets.
  const creativesKey = kit.creatives.map((c) => c.id).join(",") || kit.id;
  return <CreativeKitBlock key={creativesKey} kit={kit} />;
}

/** Intro lesson accordion — one section open at a time. */
function IntroLessonBlock({
  kit,
  lesson,
}: {
  kit: MarketingKitView;
  lesson: NonNullable<MarketingKitView["lesson"]>;
}) {
  const t = useTranslations("Marketing");
  const locale = useLocale();
  const isAr = locale === "ar";
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="rounded-lg border border-stone bg-surface-subtle p-4">
      <h3 className="text-sm font-semibold text-ink">
        {t(`stage.${kit.stage}` as never)} · {t("lessonTitle")}
      </h3>
      <p className="mt-2 text-sm text-stone-dark">
        {t("lessonWhatThisIs", { name: lesson.productName })}
      </p>
      <p className="mt-1.5 text-xs font-medium text-ink">
        {t("lessonClickHint")}
      </p>

      <ul className="mt-3 divide-y divide-stone border-t border-stone">
        {lesson.sections.map((section) => {
          const open = openId === section.id;
          const title = isAr ? section.titleAr : section.titleEn;
          const body = isAr ? section.bodyAr : section.bodyEn;
          return (
            <li key={section.id}>
              <button
                type="button"
                aria-expanded={open}
                onClick={() =>
                  setOpenId((cur) => (cur === section.id ? null : section.id))
                }
                className="flex w-full items-center justify-between gap-3 py-3 text-start text-sm font-semibold text-ink transition hover:text-cedar-deep"
              >
                <span>{title}</span>
                <span
                  aria-hidden
                  className={`shrink-0 text-stone-dark transition ${open ? "rotate-180" : ""}`}
                >
                  ▾
                </span>
              </button>
              {open && (
                <div
                  className="pb-3 text-sm text-stone-dark"
                  dir={isAr ? "rtl" : "ltr"}
                >
                  <LessonBody text={body} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Render markdown-ish plain paragraphs + bullet lines from the lesson payload. */
function LessonBody({ text }: { text: string }) {
  const blocks = text.split(/\n\n+/).filter(Boolean);
  return (
    <div className="space-y-2.5">
      {blocks.map((block, i) => {
        const lines = block.split("\n").filter(Boolean);
        const allBullets = lines.every((l) => /^[•\-\*]/.test(l.trim()));
        if (allBullets) {
          return (
            <ul key={i} className="space-y-1">
              {lines.map((line, li) => (
                <li key={li} className="flex gap-1.5">
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

function CreativeKitBlock({ kit }: { kit: MarketingKitView }) {
  const t = useTranslations("Marketing");
  const locale = useLocale();
  const isAr = locale === "ar";
  const [pending, startTransition] = useTransition();
  const [creatives, setCreatives] = useState<Creative[]>(kit.creatives);
  const [saved, setSaved] = useState(false);
  const [editing, setEditing] = useState(false);

  const isPreLaunchPlan = kit.stage === "pre_launch";
  const isLaunchPlan = kit.stage === "launch";
  const isMonthlyPlan = kit.stage === "monthly_refresh";
  // Week-phased kits (ETA weeks / launch 2-week / monthly 1-week).
  const isWeekPlan =
    isPreLaunchPlan ||
    isLaunchPlan ||
    isMonthlyPlan ||
    creatives.some((c) => c.weekIndex > 0);
  const weekGroups = isWeekPlan
    ? groupCreativesByWeek(creatives, isAr)
    : [{ weekIndex: 0, label: "", items: creatives }];
  // Badge 1…N follows flattened weekGroups order (calendar within weeks).
  const badgeById: Record<string, number> = {};
  weekGroups
    .flatMap((g) => g.items)
    .forEach((c, i) => {
      badgeById[c.id] = i + 1;
    });

  function update(id: string, patch: Partial<Creative>) {
    setCreatives((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    setSaved(false);
  }

  function persistSchedule(next: Creative[]) {
    startTransition(async () => {
      const res = await saveKitCreativesAction(kit.id, next);
      if (res.ok) setSaved(true);
    });
  }

  function setScheduleIgnored(id: string, ignored: boolean) {
    const next = creatives.map((c) =>
      c.id === id ? { ...c, scheduleIgnored: ignored } : c,
    );
    setCreatives(next);
    setSaved(false);
    persistSchedule(next);
  }

  const fieldClass =
    "w-full rounded border border-stone px-2 py-1.5 outline-none focus:border-cedar";

  return (
    <div className="rounded-lg border border-stone bg-surface-subtle p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">
          {t(`stage.${kit.stage}` as never)} · {t("creativesCount", { n: creatives.length })}
        </h3>
        <div className="flex items-center gap-2">
          {saved && <span className="text-xs text-cedar-deep">{t("saved")}</span>}
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            className="rounded-md border border-stone px-2.5 py-1 text-xs font-medium text-ink transition hover:bg-sand"
          >
            {editing ? t("done") : t("edit")}
          </button>
        </div>
      </div>

      {isLaunchPlan && (
        <p className="mt-2 text-[11px] text-stone-dark">
          {t("launchPlanNote")}
        </p>
      )}
      {isMonthlyPlan && (
        <p className="mt-2 text-[11px] text-stone-dark">
          {t("weeklyPlanNote")}
        </p>
      )}
      {isWeekPlan && (
        <p className="mt-2 text-[11px] text-stone-dark">
          {t("scheduleOptionalNote")}
        </p>
      )}

      <div className="mt-3 space-y-3">
        {weekGroups.map((group) => (
          <section key={group.weekIndex || "flat"}>
            {group.label ? (
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-cedar-deep">
                {group.label}
              </h4>
            ) : null}
            <div
              className={
                isWeekPlan
                  ? "flex flex-col gap-2"
                  : "grid items-start gap-2 md:grid-cols-2"
              }
            >
              {group.items.map((c, i) => (
                <CreativeCard
                  key={c.id}
                  c={c}
                  index={badgeById[c.id] ?? i + 1}
                  editing={editing}
                  isAr={isAr}
                  showSchedule={isWeekPlan}
                  pending={pending}
                  fieldClass={fieldClass}
                  t={t}
                  onUpdate={update}
                  onIgnore={() => setScheduleIgnored(c.id, true)}
                  onRestore={() => setScheduleIgnored(c.id, false)}
                />
              ))}
            </div>
          </section>
        ))}
      </div>

      {editing && (
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const res = await saveKitCreativesAction(kit.id, creatives);
              if (res.ok) setSaved(true);
            })
          }
          className="mt-3 rounded-md bg-cedar px-4 py-2 text-sm font-semibold text-foam transition hover:bg-cedar-deep disabled:opacity-60"
        >
          {t("saveCreatives")}
        </button>
      )}
    </div>
  );
}

function groupCreativesByWeek(
  creatives: Creative[],
  isAr: boolean,
): { weekIndex: number; label: string; items: Creative[] }[] {
  const map = new Map<number, Creative[]>();
  for (const c of creatives) {
    const w = c.weekIndex > 0 ? c.weekIndex : 0;
    const list = map.get(w) ?? [];
    list.push(c);
    map.set(w, list);
  }
  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([weekIndex, items]) => {
      const ordered = [...items].sort(compareCreativesByCalendar);
      return {
        weekIndex,
        label:
          weekIndex > 0
            ? (isAr
                ? ordered[0]?.weekLabelAr
                : ordered[0]?.weekLabelEn) || `Week ${weekIndex}`
            : "",
        items: ordered,
      };
    });
}

function CreativeCard({
  c,
  index,
  editing,
  isAr,
  showSchedule,
  pending,
  fieldClass,
  t,
  onUpdate,
  onIgnore,
  onRestore,
}: {
  c: Creative;
  index: number;
  editing: boolean;
  isAr: boolean;
  showSchedule: boolean;
  pending: boolean;
  fieldClass: string;
  t: ReturnType<typeof useTranslations<"Marketing">>;
  onUpdate: (id: string, patch: Partial<Creative>) => void;
  onIgnore: () => void;
  onRestore: () => void;
}) {
  const hookEn = c.hookEn?.trim() ?? "";
  const hookAr = c.hookAr?.trim() ?? "";
  const hookLine = (isAr ? hookAr : hookEn) || (isAr ? hookEn : hookAr);
  const hookDir = hookLine && hookLine === hookAr ? ("rtl" as const) : undefined;
  const captionEn = c.captionEn?.trim() ?? "";
  const captionAr = c.captionAr?.trim() ?? "";
  const captionsIdentical =
    Boolean(captionEn) && Boolean(captionAr) && captionEn === captionAr;
  const hasSuggestion = !!(
    c.suggestedDay?.trim() && c.suggestedTimeBand?.trim()
  );
  const why = isAr ? c.whyAr : c.whyEn;
  const dayLabel = c.suggestedDay
    ? t(`day.${c.suggestedDay}` as never)
    : "";
  const bandLabel = c.suggestedTimeBand
    ? t(`timeBand.${c.suggestedTimeBand}` as never)
    : "";

  return (
    <div className="rounded-lg border border-stone bg-surface p-3 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <span className="rounded bg-sand px-2 py-0.5 font-medium text-stone-dark">
          {index}. {t(`format.${c.format}` as never)}
        </span>
      </div>

      {showSchedule && hasSuggestion && (
        <div className="mt-2 rounded-md border border-stone/80 bg-sand/40 px-2.5 py-2">
          {c.scheduleIgnored ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-stone-dark">{t("scheduleIgnored")}</p>
              <button
                type="button"
                disabled={pending}
                onClick={onRestore}
                className="rounded border border-stone px-2 py-0.5 text-[11px] font-medium text-ink transition hover:bg-surface disabled:opacity-50"
              >
                {pending ? t("scheduleSaving") : t("scheduleRestore")}
              </button>
            </div>
          ) : (
            <div className="space-y-1.5">
              <div>
                <p className="font-medium text-ink">{t("scheduleWhen")}</p>
                <p className="text-stone-dark">
                  {dayLabel}
                  {bandLabel ? ` · ${bandLabel}` : ""}
                </p>
              </div>
              {why?.trim() ? (
                <div>
                  <p className="font-medium text-ink">{t("scheduleWhy")}</p>
                  <p className={isAr ? "text-stone-dark" : "text-stone-dark"} dir={isAr ? "rtl" : undefined}>
                    {why}
                  </p>
                </div>
              ) : null}
              <button
                type="button"
                disabled={pending}
                onClick={onIgnore}
                className="rounded border border-stone px-2 py-0.5 text-[11px] font-medium text-ink transition hover:bg-surface disabled:opacity-50"
              >
                {pending ? t("scheduleSaving") : t("scheduleIgnore")}
              </button>
            </div>
          )}
        </div>
      )}

      {editing ? (
        <div className="mt-2 space-y-2">
          <div className="space-y-1">
            <p className="font-medium text-ink">{t("hook")}</p>
            <textarea
              value={c.hookEn ?? ""}
              onChange={(e) => onUpdate(c.id, { hookEn: e.target.value })}
              rows={2}
              className={fieldClass}
            />
            <textarea
              dir="rtl"
              value={c.hookAr ?? ""}
              onChange={(e) => onUpdate(c.id, { hookAr: e.target.value })}
              rows={2}
              className={fieldClass}
            />
          </div>
          <textarea
            value={c.captionEn}
            onChange={(e) => onUpdate(c.id, { captionEn: e.target.value })}
            rows={2}
            className={fieldClass}
          />
          <textarea
            dir="rtl"
            value={c.captionAr}
            onChange={(e) => onUpdate(c.id, { captionAr: e.target.value })}
            rows={2}
            className={fieldClass}
          />
          <div className="space-y-1">
            <p className="font-medium text-ink">{t("shotList")}</p>
            <textarea
              value={c.shots.join("\n")}
              onChange={(e) =>
                onUpdate(c.id, { shots: e.target.value.split("\n") })
              }
              rows={4}
              className={`${fieldClass} font-mono`}
            />
          </div>
        </div>
      ) : (
        <div className="mt-2 space-y-1.5">
          {hookLine ? (
            <div>
              <p className="font-medium text-ink">{t("hook")}</p>
              <p dir={hookDir} className="text-stone-dark">
                {hookLine}
              </p>
            </div>
          ) : null}
          <p className="font-medium text-ink">{c.angleEn}</p>
          {captionsIdentical ? (
            <p
              dir={isAr ? "rtl" : undefined}
              className="text-stone-dark"
            >
              {isAr ? captionAr : captionEn}
            </p>
          ) : (
            <>
              {captionEn ? (
                <p className="text-stone-dark">{captionEn}</p>
              ) : null}
              {captionAr ? (
                <p dir="rtl" className="text-stone-dark">
                  {captionAr}
                </p>
              ) : null}
            </>
          )}
          <div>
            <p className="font-medium text-ink">{t("shotList")}</p>
            <ul className="mt-0.5 space-y-0.5 text-stone-dark">
              {c.shots.map((s, si) => (
                <li key={si} className="flex gap-1.5">
                  <span aria-hidden className="text-cedar">
                    •
                  </span>
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
