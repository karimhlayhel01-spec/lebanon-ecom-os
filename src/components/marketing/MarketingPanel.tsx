"use client";

import { useRef, useState, useTransition, type MouseEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import {
  continueCreativesKitFillAction,
  generateKitAction,
  saveKitCreativesAction,
} from "@/actions/marketing";
import { setCreativePackChoiceAction } from "@/actions/photo-packs";
import {
  copyNanoVisualPromptAction,
  discardVisualAction,
  generateVisualAction,
  regenerateVisualAction,
} from "@/actions/visual-gen";
import { VisualResultDialog } from "@/components/marketing/VisualResultDialog";
import {
  isElementStartInView,
  isSkuPagePathname,
  markBatchArrivalEtaDeepLinkConsumed,
  markStayOnMarketingAfterKitAction,
  skuFocusLocationKey,
} from "@/lib/sku/suppress-auto-scroll";
import type {
  Creative,
  MarketingKitView,
  MarketingPanelView,
} from "@/lib/marketing/service";
import {
  getIntroSectionTitle,
  isIntroLessonSectionId,
  isIntroLiteracySectionId,
} from "@/lib/marketing/intro-lesson";
import { compareCreativesByCalendar } from "@/lib/marketing/creatives";
import {
  buildClaudeSkillRecipe,
  CLAUDE_CUSTOMIZE_SKILLS_URL,
  isKitDeskStage,
  serializeKitForExternalDesk,
} from "@/lib/marketing/ai-desk";
import {
  suggestCreativeVisualTool,
  type CreativeVisualSuggestion,
} from "@/lib/marketing/visual-tool";
import {
  packIdForCreative,
  productPhotosPath,
  resolveSelectedPackId,
  showPhotoPackDefaultControls,
  visualToolUsesPhotoPack,
  type CreativePackChoice,
  type CreativeVisualFileView,
  type PhotoPackOption,
  type VisualGenError,
} from "@/lib/marketing/visual-pack-ui";
import { copyTextToClipboard } from "@/lib/store/clipboard";
import { creativesFillReasonI18nKey } from "@/lib/marketing/creatives-ai";
import {
  formatCardNumberList,
  leftoverShowTargets,
  type LeftoverShowTarget,
} from "@/lib/marketing/leftover-cards";
import type { BatchArrivalEtaView } from "@/lib/supplier/batch-eta";
import type { MarketingStage } from "@/lib/constants";

/** Pin #marketing + suppress leftover ETA hash before kit writes on SKU spine. */
function stayOnMarketingForKitWrite(skuId: string | null | undefined) {
  if (!skuId || !isSkuPagePathname()) return;
  markStayOnMarketingAfterKitAction(skuId);
}

function explainVisualGen(
  code: VisualGenError,
  t: ReturnType<typeof useTranslations<"Marketing">>,
): string {
  if (code === "monthly_cap") return t("visualGenHonestyCap");
  if (code === "nsfw") return t("visualGenHonestyNsfw");
  if (code === "regen_cap") return t("visualGenRegenDisabled");
  return t("visualGenHonestyFail");
}

async function downloadOwnedVisual(
  href: string,
  kind: "still" | "clip",
): Promise<void> {
  const res = await fetch(`${href}?download=1`);
  if (!res.ok) return;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = kind === "clip" ? "product-clip.mp4" : "product-still.jpg";
  a.click();
  URL.revokeObjectURL(url);
}

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
            skuId={view.selectedSkuId}
            supplierHref={
              view.selectedSkuId
                ? surface === "sku"
                  ? "#batch-arrival-eta"
                  : `/sku/${view.selectedSkuId}#batch-arrival-eta`
                : "/supplier#batch-arrival-eta"
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
            kitSkuId={
              view.isShopKit ? null : (view.selectedSkuId as string)
            }
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
            .map((kit) => (
              <KitBlock
                key={kit.id}
                kit={kit}
                skuId={view.isShopKit ? null : view.selectedSkuId}
                surface={surface}
                geminiConfigured={view.geminiConfigured}
                geminiCapReached={view.geminiCapReached}
                productName={
                  view.isShopKit
                    ? "Whole shop"
                    : (view.liveSkus.find((s) => s.id === view.selectedSkuId)
                        ?.name ?? "your product")
                }
                category={view.selectedCategory}
                photoPacks={view.isShopKit ? [] : view.photoPacks}
                creativePackChoices={
                  view.isShopKit ? [] : view.creativePackChoices
                }
                creativeVisuals={view.isShopKit ? [] : view.creativeVisuals}
                visualGenReady={
                  !view.isShopKit && view.visualGenReady
                }
              />
            ))
        )}
      </div>
    </div>
  );
}

function PreLaunchEtaBanner({
  eta,
  supplierHref,
  skuId,
}: {
  eta: BatchArrivalEtaView;
  supplierHref: string;
  skuId: string | null;
}) {
  const t = useTranslations("Marketing");
  const locale = useLocale();
  const summary = locale === "ar" ? eta.summaryAr : eta.summaryEn;

  function goToEta(e: MouseEvent<HTMLAnchorElement>) {
    // Next.js Link often skips same-document hash-only navigations.
    if (typeof window === "undefined") return;
    const el = document.getElementById("batch-arrival-eta");
    if (!el) return;
    e.preventDefault();
    if (window.location.hash !== "#batch-arrival-eta") {
      window.history.pushState(null, "", "#batch-arrival-eta");
    }
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    // One-shot: remount with leftover hash must not re-scroll (Generate kit).
    if (skuId) {
      markBatchArrivalEtaDeepLinkConsumed(skuId, skuFocusLocationKey());
    }
  }

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
            onClick={goToEta}
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
  /** null = shop kit; string = SKU id (required for SKU kits — never omit / active fallback) */
  kitSkuId: string | null;
  surface: "deep" | "sku";
}) {
  const t = useTranslations("Marketing");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Successful Intro is fixed on the stage rail. Template fallback recovery
  // lives only in IntroLessonBlock ("Try AI fill again").
  const showGenerate = !(stage === "intro_pdf" && hasKit);

  const generateLabel =
    stage === "weekly_refresh"
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
                // Stay on Marketing: clear leftover #batch-arrival-eta before revalidate.
                stayOnMarketingForKitWrite(kitSkuId);
                // Button click acknowledges launch budget rules (no checkbox).
                // Shop kits: null. SKU kits: always pass kitSkuId (never undefined).
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
                // Soft-scroll only if Marketing left the viewport (prefer stay put).
                if (surface === "sku" && typeof document !== "undefined") {
                  const m = document.getElementById("marketing");
                  if (
                    m &&
                    !isElementStartInView(m.getBoundingClientRect().top, 160)
                  ) {
                    m.scrollIntoView({ behavior: "smooth", block: "start" });
                  }
                }
              });
            }}
            onPointerDown={(e) => e.stopPropagation()}
            className="w-full rounded-md bg-cedar px-3 py-1.5 text-xs font-semibold text-foam transition hover:bg-cedar-deep disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending
              ? stage === "intro_pdf"
                ? t("generatingLesson")
                : t("generatingKit")
              : generateLabel}
          </button>
        )}
      </div>
    </div>
  );
}

function KitBlock({
  kit,
  skuId,
  surface,
  geminiConfigured,
  geminiCapReached,
  productName,
  category,
  photoPacks,
  creativePackChoices,
  creativeVisuals,
  visualGenReady,
}: {
  kit: MarketingKitView;
  skuId: string | null;
  surface: "deep" | "sku";
  geminiConfigured: boolean;
  geminiCapReached: boolean;
  productName: string;
  category: string;
  photoPacks: PhotoPackOption[];
  creativePackChoices: CreativePackChoice[];
  creativeVisuals: CreativeVisualFileView[];
  visualGenReady: boolean;
}) {
  if (kit.kind === "intro_lesson" && kit.lesson) {
    return (
      <IntroLessonBlock
        kit={kit}
        lesson={kit.lesson}
        skuId={skuId}
        surface={surface}
        geminiConfigured={geminiConfigured}
        geminiCapReached={geminiCapReached}
      />
    );
  }
  // Remount when regenerate swaps creative ids so local edit state resets.
  const creativesKey = kit.creatives.map((c) => c.id).join(",") || kit.id;
  return (
    <CreativeKitBlock
      key={creativesKey}
      kit={kit}
      skuId={skuId}
      surface={surface}
      geminiConfigured={geminiConfigured}
      geminiCapReached={geminiCapReached}
      productName={productName}
      category={category}
      photoPacks={photoPacks}
      creativePackChoices={creativePackChoices}
      creativeVisuals={creativeVisuals}
      visualGenReady={visualGenReady}
    />
  );
}

/** Intro lesson accordion — one section open at a time. */
function IntroLessonBlock({
  kit,
  lesson,
  skuId,
  surface,
  geminiConfigured,
  geminiCapReached,
}: {
  kit: MarketingKitView;
  lesson: NonNullable<MarketingKitView["lesson"]>;
  skuId: string | null;
  surface: "deep" | "sku";
  geminiConfigured: boolean;
  geminiCapReached: boolean;
}) {
  const t = useTranslations("Marketing");
  const locale = useLocale();
  const router = useRouter();
  const isAr = locale === "ar";
  const [openId, setOpenId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const coreSections = lesson.sections.filter(
    (s) => !isIntroLiteracySectionId(s.id),
  );
  const literacySections = lesson.sections.filter((s) =>
    isIntroLiteracySectionId(s.id),
  );

  function regenerateIntro() {
    if (!skuId) return;
    setError(null);
    startTransition(async () => {
      stayOnMarketingForKitWrite(skuId);
      const res = await generateKitAction("intro_pdf", true, skuId);
      if (!res.ok) {
        setError(
          res.error === "stage_locked" ? "stageLocked" : "errorGeneric",
        );
        return;
      }
      router.refresh();
      if (surface === "sku" && typeof document !== "undefined") {
        const m = document.getElementById("marketing");
        if (
          m &&
          !isElementStartInView(m.getBoundingClientRect().top, 160)
        ) {
          m.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      }
    });
  }

  return (
    <div className="rounded-lg border border-stone bg-surface-subtle p-4">
      <h3 className="text-sm font-semibold text-ink">
        {t(`stage.${kit.stage}` as never)} · {t("lessonTitle")}
      </h3>
      <p className="mt-2 text-sm text-stone-dark" dir="auto">
        {t("lessonWhatThisIs", { name: lesson.productName })}
      </p>
      <p className="mt-1.5 text-xs font-medium text-ink">
        {t("lessonClickHint")}
      </p>
      {lesson.source === "template" && (
        <div className="mt-2 space-y-2">
          <p className="text-xs text-amber-900/90" dir={isAr ? "rtl" : undefined}>
            {geminiCapReached
              ? t("lessonAiCap")
              : geminiConfigured
                ? t("lessonAiFallback")
                : t("lessonAiUnavailable")}
          </p>
          {skuId && !geminiCapReached && (
            <button
              type="button"
              disabled={pending}
              onClick={regenerateIntro}
              className="rounded-md border border-cedar/40 bg-cedar/10 px-3 py-1.5 text-xs font-semibold text-cedar-deep transition hover:bg-cedar/15 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pending ? t("generatingLesson") : t("tryAiFillAgain")}
            </button>
          )}
          {error && (
            <p className="text-[11px] text-amber-800">{t(error as never)}</p>
          )}
        </div>
      )}

      <ul className="mt-3 divide-y divide-stone border-t border-stone">
        {coreSections.map((section) => (
          <IntroAccordionRow
            key={section.id}
            section={section}
            open={openId === section.id}
            isAr={isAr}
            onToggle={() =>
              setOpenId((cur) => (cur === section.id ? null : section.id))
            }
          />
        ))}
      </ul>

      {literacySections.length > 0 && (
        <div className="mt-5 border-t border-stone pt-4">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-cedar-deep">
            {t("lessonAiLiteracyTitle")}
          </h4>
          <p className="mt-1 text-xs text-stone-dark">
            {t("lessonAiLiteracyIntro")}
          </p>
          <ul className="mt-2 divide-y divide-stone border-t border-stone">
            {literacySections.map((section) => (
              <IntroAccordionRow
                key={section.id}
                section={section}
                open={openId === section.id}
                isAr={isAr}
                onToggle={() =>
                  setOpenId((cur) =>
                    cur === section.id ? null : section.id,
                  )
                }
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function IntroAccordionRow({
  section,
  open,
  isAr,
  onToggle,
}: {
  section: NonNullable<MarketingKitView["lesson"]>["sections"][number];
  open: boolean;
  isAr: boolean;
  onToggle: () => void;
}) {
  const title = isIntroLessonSectionId(section.id)
    ? getIntroSectionTitle(section.id, isAr ? "ar" : "en")
    : isAr
      ? section.titleAr
      : section.titleEn;
  const body = isAr ? section.bodyAr : section.bodyEn;
  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
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
          className="max-h-[min(28rem,55vh)] overflow-y-auto pb-3 text-sm text-stone-dark"
          dir={isAr ? "rtl" : "ltr"}
        >
          <LessonBody text={body} />
        </div>
      )}
    </li>
  );
}

/** Render markdown-ish plain paragraphs + bullet lines from the lesson payload. */
function LessonBody({ text }: { text: string }) {
  const t = useTranslations("Marketing");
  const trimmed = (text ?? "").trim();
  if (!trimmed) {
    return (
      <p className="text-sm italic text-stone-dark/80">{t("lessonBodyEmpty")}</p>
    );
  }

  const normalized = trimmed
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\r\n/g, "\n");

  const blocks = normalized.split(/\n\n+/).filter(Boolean);
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
                  <span className="whitespace-pre-line">
                    {line.replace(/^[•\-\*]\s*/, "")}
                  </span>
                </li>
              ))}
            </ul>
          );
        }
        // Mixed: promote leading bullet lines; plain-render the rest.
        const hasAnyBullet = lines.some((l) => /^[•\-\*]/.test(l.trim()));
        if (hasAnyBullet) {
          return (
            <div key={i} className="space-y-1.5">
              {lines.map((line, li) => {
                const bullet = /^[•\-\*]/.test(line.trim());
                if (bullet) {
                  return (
                    <div key={li} className="flex gap-1.5">
                      <span aria-hidden className="text-cedar">
                        •
                      </span>
                      <span className="whitespace-pre-line">
                        {line.replace(/^[•\-\*]\s*/, "")}
                      </span>
                    </div>
                  );
                }
                return (
                  <p key={li} className="leading-relaxed whitespace-pre-line">
                    {line.replace(/^#{1,6}\s+/, "")}
                  </p>
                );
              })}
            </div>
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

function KitFillHonesty({
  source,
  templateCount,
  fillError,
  geminiConfigured,
  geminiCapReached,
  leftoverTargets,
  isAr,
  onShowCard,
}: {
  source: "template" | "partial";
  templateCount: number;
  fillError: string | null;
  geminiConfigured: boolean;
  geminiCapReached: boolean;
  leftoverTargets: LeftoverShowTarget[];
  isAr: boolean;
  onShowCard: (id: string) => void;
}) {
  const t = useTranslations("Marketing");
  const reasonKey = creativesFillReasonI18nKey(fillError);
  const templateN = Math.max(1, templateCount);
  const leftoverLine =
    leftoverTargets.length === 1
      ? t("kitAiMissedCard", { n: leftoverTargets[0]!.badge })
      : leftoverTargets.length > 1
        ? t("kitAiMissedCards", {
            list: formatCardNumberList(
              leftoverTargets.map((row) => row.badge),
              isAr ? "ar" : "en",
            ),
          })
        : null;

  return (
    <div
      className="space-y-1 text-xs text-amber-900/90"
      dir={isAr ? "rtl" : undefined}
    >
      {geminiCapReached ? (
        <>
          {source === "partial" && <p>{t("kitAiPartial", { n: templateN })}</p>}
          <p>{t("kitAiCap")}</p>
        </>
      ) : !geminiConfigured ? (
        <p>{t("kitAiUnavailable")}</p>
      ) : source === "partial" ? (
        <>
          <p>{t("kitAiPartial", { n: templateN })}</p>
          {reasonKey && <p>{t(reasonKey as never)}</p>}
          {leftoverLine && <p>{leftoverLine}</p>}
          {leftoverTargets.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {leftoverTargets.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => onShowCard(row.id)}
                  className="rounded-md border border-amber-400/60 bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-950 transition hover:bg-amber-100"
                >
                  {t("showCard", { n: row.badge })}
                </button>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <p>{t("kitAiFallback")}</p>
          {reasonKey && <p>{t(reasonKey as never)}</p>}
        </>
      )}
    </div>
  );
}

function CreativeKitBlock({
  kit,
  skuId,
  surface,
  geminiConfigured,
  geminiCapReached,
  productName,
  category,
  photoPacks,
  creativePackChoices,
  creativeVisuals,
  visualGenReady,
}: {
  kit: MarketingKitView;
  skuId: string | null;
  surface: "deep" | "sku";
  geminiConfigured: boolean;
  geminiCapReached: boolean;
  productName: string;
  category: string;
  photoPacks: PhotoPackOption[];
  creativePackChoices: CreativePackChoice[];
  creativeVisuals: CreativeVisualFileView[];
  visualGenReady: boolean;
}) {
  const t = useTranslations("Marketing");
  const locale = useLocale();
  const router = useRouter();
  const isAr = locale === "ar";
  const [pending, startTransition] = useTransition();
  const [regenPending, startRegen] = useTransition();
  const [creatives, setCreatives] = useState<Creative[]>(kit.creatives);
  const [saved, setSaved] = useState(false);
  const [editing, setEditing] = useState(false);
  const [copiedDesk, setCopiedDesk] = useState<string | null>(null);
  const [deskOpen, setDeskOpen] = useState(false);
  const [focusedCreativeId, setFocusedCreativeId] = useState<string | null>(
    null,
  );
  const [fillFailedId, setFillFailedId] = useState<string | null>(null);
  const [kitFillFailed, setKitFillFailed] = useState(false);
  const focusTimer = useRef<number | null>(null);

  const isPreLaunchPlan = kit.stage === "pre_launch";
  const isLaunchPlan = kit.stage === "launch";
  const isWeeklyPlan = kit.stage === "weekly_refresh";
  // Week-phased kits (ETA weeks / launch 2-week / monthly 1-week).
  const isWeekPlan =
    isPreLaunchPlan ||
    isLaunchPlan ||
    isWeeklyPlan ||
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
  const leftoverTargets = leftoverShowTargets({
    source: kit.source,
    templateIds: kit.templateIds,
    badgeById,
    geminiConfigured,
    geminiCapReached,
  });
  const leftoverIdSet = new Set(
    kit.source === "partial" ? kit.templateIds : [],
  );

  const deskStage = isKitDeskStage(kit.stage) ? kit.stage : null;
  const kitPaste = deskStage
    ? serializeKitForExternalDesk({
        productName,
        stage: deskStage,
        cards: creatives,
      })
    : null;
  const skillRecipe = deskStage ? buildClaudeSkillRecipe() : "";

  function update(id: string, patch: Partial<Creative>) {
    setCreatives((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    setSaved(false);
  }

  function persistSchedule(next: Creative[]) {
    startTransition(async () => {
      if (surface === "sku") stayOnMarketingForKitWrite(skuId);
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

  function showLeftoverCard(id: string) {
    setFocusedCreativeId(id);
    document.getElementById(`creative-${id}`)?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
    if (focusTimer.current) window.clearTimeout(focusTimer.current);
    focusTimer.current = window.setTimeout(() => {
      setFocusedCreativeId((cur) => (cur === id ? null : cur));
      focusTimer.current = null;
    }, 2000);
  }

  function tryAiFillCard(id: string) {
    startRegen(async () => {
      setFillFailedId(null);
      if (surface === "sku") stayOnMarketingForKitWrite(skuId);
      const res = await continueCreativesKitFillAction(kit.id, [id], skuId);
      if (res.ok) {
        setFillFailedId(null);
        router.refresh();
        return;
      }
      if (res.error === "still_leftover") setFillFailedId(id);
    });
  }

  function moveToNextWeek() {
    startRegen(async () => {
      if (surface === "sku") stayOnMarketingForKitWrite(skuId);
      const res = await generateKitAction(kit.stage, true, skuId, true);
      if (res.ok) router.refresh();
    });
  }

  function tryAiAgain() {
    startRegen(async () => {
      setKitFillFailed(false);
      if (surface === "sku") stayOnMarketingForKitWrite(skuId);
      const res =
        kit.source === "partial" && kit.templateIds.length > 0
          ? await continueCreativesKitFillAction(
              kit.id,
              kit.templateIds,
              skuId,
            )
          : await generateKitAction(kit.stage, true, skuId);
      if (res.ok) {
        router.refresh();
        return;
      }
      if (res.error === "still_leftover") {
        setKitFillFailed(true);
        router.refresh();
      }
    });
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
          {skuId ? (
            <Link
              href={productPhotosPath(skuId)}
              className="rounded-md border border-cedar/40 bg-cedar/10 px-2.5 py-1 text-xs font-semibold text-cedar-deep transition hover:bg-cedar/15"
            >
              {t("photoPacksAdd")}
            </Link>
          ) : null}
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

      {(kit.source === "template" || kit.source === "partial") && (
        <div className="mt-2 space-y-2">
          <KitFillHonesty
            source={kit.source}
            templateCount={kit.templateCount}
            fillError={kit.fillError}
            geminiConfigured={geminiConfigured}
            geminiCapReached={geminiCapReached}
            leftoverTargets={leftoverTargets}
            isAr={isAr}
            onShowCard={showLeftoverCard}
          />
          {!geminiCapReached && (
            <div className="space-y-1.5">
              <button
                type="button"
                disabled={regenPending}
                onClick={tryAiAgain}
                className="rounded-md border border-cedar/40 bg-cedar/10 px-3 py-1.5 text-xs font-semibold text-cedar-deep transition hover:bg-cedar/15 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {regenPending ? t("generatingKit") : t("tryAiFillAgain")}
              </button>
              {kitFillFailed && (
                <p className="text-[11px] text-amber-900/90">
                  {t("tryAiFillAgainFailed")}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {isLaunchPlan && (
        <p className="mt-2 text-[11px] text-stone-dark">
          {t("launchPlanNote")}
        </p>
      )}
      {isWeeklyPlan && (
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
                  leftover={leftoverIdSet.has(c.id)}
                  focused={focusedCreativeId === c.id}
                  fillFailed={fillFailedId === c.id}
                  showTryAiFill={
                    geminiConfigured &&
                    !geminiCapReached &&
                    (leftoverIdSet.has(c.id) || kit.source === "template")
                  }
                  regenPending={regenPending}
                  editing={editing}
                  isAr={isAr}
                  showSchedule={isWeekPlan}
                  pending={pending}
                  fieldClass={fieldClass}
                  productName={productName}
                  category={category}
                  stage={kit.stage}
                  t={t}
                  onUpdate={update}
                  onIgnore={() => setScheduleIgnored(c.id, true)}
                  onRestore={() => setScheduleIgnored(c.id, false)}
                  onTryAiFill={() => tryAiFillCard(c.id)}
                  photoPackUi={
                    skuId
                      ? {
                          skuId,
                          kitId: kit.id,
                          packs: photoPacks,
                          selectedPackId: resolveSelectedPackId({
                            chosenPackId: packIdForCreative(
                              creativePackChoices,
                              kit.id,
                              c.id,
                            ),
                            packs: photoPacks,
                          }),
                        }
                      : null
                  }
                  visualGen={
                    skuId && visualGenReady
                      ? {
                          skuId,
                          kitId: kit.id,
                          file:
                            creativeVisuals.find(
                              (v) =>
                                v.kitId === kit.id && v.creativeId === c.id,
                            ) ?? null,
                        }
                      : null
                  }
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
              if (surface === "sku") stayOnMarketingForKitWrite(skuId);
              const res = await saveKitCreativesAction(kit.id, creatives);
              if (res.ok) setSaved(true);
            })
          }
          className="mt-3 rounded-md bg-cedar px-4 py-2 text-sm font-semibold text-foam transition hover:bg-cedar-deep disabled:opacity-60"
        >
          {t("saveCreatives")}
        </button>
      )}

      {isWeeklyPlan && (
        <div className="mt-4">
          <button
            type="button"
            disabled={regenPending}
            onClick={moveToNextWeek}
            className="rounded-md border border-cedar/40 bg-cedar/10 px-3 py-1.5 text-xs font-semibold text-cedar-deep transition hover:bg-cedar/15 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {regenPending ? t("generatingKit") : t("moveToNextWeek")}
          </button>
        </div>
      )}

      {deskStage && (
        <div className="mt-5 border-t border-stone/70 pt-3">
          <button
            type="button"
            onClick={() => setDeskOpen((o) => !o)}
            aria-expanded={deskOpen}
            className="text-left text-[11px] font-medium text-stone-dark underline-offset-2 transition hover:text-ink hover:underline"
            dir={isAr ? "rtl" : undefined}
          >
            {deskOpen ? t("deskHide") : t("deskMoreHelp")}
          </button>
          {deskOpen ? (
            <div className="mt-3">
              <h4
                className="text-[11px] font-medium tracking-wide text-stone-dark"
                dir={isAr ? "rtl" : undefined}
              >
                {t("deskTitle")}
              </h4>
              <p
                className="mt-1 text-[11px] leading-relaxed text-stone-dark"
                dir={isAr ? "rtl" : undefined}
              >
                {t("deskIntro")}
              </p>
              <a
                href={CLAUDE_CUSTOMIZE_SKILLS_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-block text-[11px] font-medium text-sea underline-offset-2 hover:underline"
                dir={isAr ? "rtl" : undefined}
              >
                {t("deskOpenClaudeSkills")}
              </a>
              <div className="mt-3 space-y-3">
                <div className="rounded-lg border border-stone/80 bg-surface p-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs font-semibold text-ink">
                      {t("deskWholeKitTitle")}
                    </p>
                    {kitPaste ? (
                      <button
                        type="button"
                        onClick={async () => {
                          const ok = await copyTextToClipboard(kitPaste);
                          if (!ok) return;
                          setCopiedDesk("kit");
                          window.setTimeout(
                            () =>
                              setCopiedDesk((cur) =>
                                cur === "kit" ? null : cur,
                              ),
                            2000,
                          );
                        }}
                        className="shrink-0 rounded-md border border-cedar/40 bg-cedar/10 px-2.5 py-1 text-xs font-semibold text-cedar-deep transition hover:bg-cedar/15"
                      >
                        {copiedDesk === "kit"
                          ? t("deskCopied")
                          : t("deskCopyKitForClaude")}
                      </button>
                    ) : null}
                  </div>
                  {kitPaste ? (
                    <pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap rounded border border-stone bg-surface-subtle p-2 text-[10px] leading-relaxed text-stone-dark">
                      {kitPaste}
                    </pre>
                  ) : (
                    <p
                      className="mt-2 text-[11px] leading-relaxed text-stone-dark"
                      dir={isAr ? "rtl" : undefined}
                    >
                      {t("deskEmptyKit")}
                    </p>
                  )}
                </div>
                <div className="rounded-lg border border-stone/80 bg-surface p-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs font-semibold text-ink">
                      {t("deskSkillRecipeTitle")}
                    </p>
                    <button
                      type="button"
                      onClick={async () => {
                        const ok = await copyTextToClipboard(skillRecipe);
                        if (!ok) return;
                        setCopiedDesk("skill");
                        window.setTimeout(
                          () =>
                            setCopiedDesk((cur) =>
                              cur === "skill" ? null : cur,
                            ),
                          2000,
                        );
                      }}
                      className="shrink-0 rounded-md border border-cedar/40 bg-cedar/10 px-2.5 py-1 text-xs font-semibold text-cedar-deep transition hover:bg-cedar/15"
                    >
                      {copiedDesk === "skill"
                        ? t("deskCopied")
                        : t("deskCopySkillForClaude")}
                    </button>
                  </div>
                  <pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap rounded border border-stone bg-surface-subtle p-2 text-[10px] leading-relaxed text-stone-dark">
                    {skillRecipe}
                  </pre>
                </div>
              </div>
            </div>
          ) : null}
        </div>
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
  leftover,
  focused,
  fillFailed,
  showTryAiFill,
  regenPending,
  editing,
  isAr,
  showSchedule,
  pending,
  fieldClass,
  productName,
  category,
  stage,
  t,
  onUpdate,
  onIgnore,
  onRestore,
  onTryAiFill,
  photoPackUi,
  visualGen,
}: {
  c: Creative;
  index: number;
  leftover: boolean;
  focused: boolean;
  fillFailed: boolean;
  showTryAiFill: boolean;
  regenPending: boolean;
  editing: boolean;
  isAr: boolean;
  showSchedule: boolean;
  pending: boolean;
  fieldClass: string;
  productName: string;
  category: string;
  stage: MarketingStage;
  t: ReturnType<typeof useTranslations<"Marketing">>;
  onUpdate: (id: string, patch: Partial<Creative>) => void;
  onIgnore: () => void;
  onRestore: () => void;
  onTryAiFill: () => void;
  photoPackUi: {
    skuId: string;
    kitId: string;
    packs: PhotoPackOption[];
    selectedPackId: string | null;
  } | null;
  visualGen: {
    skuId: string;
    kitId: string;
    file: CreativeVisualFileView | null;
  } | null;
}) {
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [copyPromptHonesty, setCopyPromptHonesty] = useState<string | null>(
    null,
  );
  const [copyPromptPending, startCopyPrompt] = useTransition();
  const [packPending, startPack] = useTransition();
  const [genPending, startGen] = useTransition();
  const [popupOpen, setPopupOpen] = useState(false);
  const [genHonesty, setGenHonesty] = useState<string | null>(null);
  const [genFile, setGenFile] = useState(visualGen?.file ?? null);
  const [usedGeneric, setUsedGeneric] = useState(false);
  const [pickedPackId, setPickedPackId] = useState(
    photoPackUi?.selectedPackId ?? "",
  );
  const hookEn = c.hookEn?.trim() ?? "";
  const hookAr = c.hookAr?.trim() ?? "";
  const hookLine = (isAr ? hookAr : hookEn) || (isAr ? hookEn : hookAr);
  const hookDir = hookLine && hookLine === hookAr ? ("rtl" as const) : undefined;
  const captionEn = c.captionEn?.trim() ?? "";
  const captionAr = c.captionAr?.trim() ?? "";
  const howToEn = c.howToShootEn?.trim() ?? "";
  const howToAr = c.howToShootAr?.trim() ?? "";
  const howToLine =
    (isAr ? howToAr : howToEn) || (isAr ? howToEn : howToAr);
  const howToDir =
    howToLine && howToLine === howToAr ? ("rtl" as const) : undefined;
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

  const visualStage =
    stage === "pre_launch" ||
    stage === "launch" ||
    stage === "weekly_refresh"
      ? stage
      : null;
  const visual: CreativeVisualSuggestion | null = visualStage
    ? suggestCreativeVisualTool({
        creative: c,
        productName,
        category,
        stage: visualStage,
      })
    : null;
  const visualWhy = visual
    ? isAr
      ? visual.whyAr
      : visual.whyEn
    : "";
  const visualPrompt = visual
    ? isAr
      ? visual.promptAr
      : visual.promptEn
    : "";
  const toolLabel = visual
    ? t(`visualTool.${visual.tool}` as never)
    : "";
  const shotListChoiceKey =
    visual?.tool === "seedance"
      ? ("photoPacksSeedanceChoice" as const)
      : visual?.tool === "nano_banana"
        ? ("photoPacksNanoChoice" as const)
        : null;
  const shotListChoiceLine = shotListChoiceKey ? (
    <p className="font-bold text-ink" dir={isAr ? "rtl" : undefined}>
      {t(shotListChoiceKey)}
    </p>
  ) : null;

  return (
    <div
      id={`creative-${c.id}`}
      className={`rounded-lg border bg-surface p-3 text-xs ${
        leftover ? "border-amber-300" : "border-stone"
      } ${focused ? "ring-2 ring-amber-500/80" : ""}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <span className="rounded bg-sand px-2 py-0.5 font-medium text-stone-dark">
          {index}. {t(`format.${c.format}` as never)}
        </span>
        <div className="flex flex-wrap items-center gap-1.5">
          {leftover && (
            <span className="rounded bg-amber-100 px-2 py-0.5 font-medium text-amber-950">
              {t("leftoverDraftChip")}
            </span>
          )}
          {showTryAiFill && (
            <button
              type="button"
              disabled={regenPending}
              onClick={onTryAiFill}
              className="rounded-md border border-cedar/40 bg-cedar/10 px-2 py-0.5 text-[11px] font-semibold text-cedar-deep transition hover:bg-cedar/15 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {regenPending ? t("generatingKit") : t("tryAiFillCard")}
            </button>
          )}
        </div>
      </div>
      {fillFailed && (
        <p className="mt-1.5 text-[11px] text-amber-900/90">
          {t("tryAiFillCardFailed")}
        </p>
      )}

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
                  <p className="text-stone-dark" dir={isAr ? "rtl" : undefined}>
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
          {shotListChoiceLine}
          <div className="space-y-1">
            <p className="font-medium text-ink">{t("shotList")}</p>
            <textarea
              value={c.shots.join("\n")}
              onChange={(e) =>
                onUpdate(c.id, { shots: e.target.value.split("\n") })
              }
              rows={5}
              className={`${fieldClass} font-mono`}
            />
          </div>
          <div className="space-y-1">
            <p className="font-medium text-ink">{t("howToShoot")}</p>
            <textarea
              value={c.howToShootEn ?? ""}
              onChange={(e) =>
                onUpdate(c.id, { howToShootEn: e.target.value })
              }
              rows={2}
              className={fieldClass}
            />
            <textarea
              dir="rtl"
              value={c.howToShootAr ?? ""}
              onChange={(e) =>
                onUpdate(c.id, { howToShootAr: e.target.value })
              }
              rows={2}
              className={fieldClass}
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
          {shotListChoiceLine}
          <div>
            <p className="font-medium text-ink">{t("shotList")}</p>
            <ul className="mt-0.5 space-y-1 text-stone-dark">
              {c.shots.map((s, si) => (
                <li key={si} className="flex gap-1.5">
                  <span aria-hidden className="shrink-0 text-cedar">
                    •
                  </span>
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          </div>
          {howToLine ? (
            <div className="rounded-md border border-stone/60 bg-sand/20 px-2.5 py-2">
              <p className="font-medium text-ink">{t("howToShoot")}</p>
              <p dir={howToDir} className="mt-1 text-stone-dark">
                {howToLine}
              </p>
            </div>
          ) : null}
        </div>
      )}

      {visual && !editing ? (
        <div className="mt-3 rounded-md border border-stone/80 bg-sand/30 px-2.5 py-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium text-ink">
              {t("visualToolTitle")}: {toolLabel}
            </p>
            <button
              type="button"
              disabled={copyPromptPending}
              onClick={async () => {
                const nanoSku = visualGen?.skuId ?? photoPackUi?.skuId;
                const nanoKit = visualGen?.kitId ?? photoPackUi?.kitId;
                if (
                  (visual.tool === "nano_banana" ||
                    visual.tool === "seedance") &&
                  nanoSku &&
                  nanoKit
                ) {
                  startCopyPrompt(async () => {
                    const res = await copyNanoVisualPromptAction(
                      nanoSku,
                      nanoKit,
                      c.id,
                      isAr ? "ar" : "en",
                    );
                    if (!res.ok) return;
                    const ok = await copyTextToClipboard(res.text);
                    if (!ok) return;
                    setCopiedPrompt(true);
                    setCopyPromptHonesty(
                      res.honesty === "monthly_cap"
                        ? t("visualToolCopyCap")
                        : res.honesty === "api_error"
                          ? t("visualToolCopyFail")
                          : null,
                    );
                    window.setTimeout(() => setCopiedPrompt(false), 2000);
                  });
                  return;
                }
                const ok = await copyTextToClipboard(visualPrompt);
                if (!ok) return;
                setCopiedPrompt(true);
                setCopyPromptHonesty(null);
                window.setTimeout(() => setCopiedPrompt(false), 2000);
              }}
              className="rounded border border-cedar/40 bg-cedar/10 px-2 py-0.5 text-[11px] font-semibold text-cedar-deep transition hover:bg-cedar/15 disabled:opacity-60"
            >
              {copyPromptPending
                ? t("visualToolCopyPending")
                : copiedPrompt
                  ? t("deskCopied")
                  : t("visualToolCopyPrompt")}
            </button>
          </div>
          <p
            className="mt-1 text-stone-dark"
            dir={isAr ? "rtl" : undefined}
          >
            {visualWhy}
          </p>
          {photoPackUi && visualToolUsesPhotoPack(visual.tool) ? (
            <div className="mt-2 space-y-2" dir={isAr ? "rtl" : undefined}>
              {photoPackUi.packs.length === 0 ? (
                <p className="text-stone-dark">
                  <Link
                    href={productPhotosPath(photoPackUi.skuId)}
                    className="font-medium text-sea underline-offset-2 hover:underline"
                  >
                    {t("photoPacksEmptyPointer")}
                  </Link>
                </p>
              ) : (
                <label className="block font-medium text-ink">
                  {t("photoPacksPickerLabel")}
                  <select
                    className="mt-1 w-full rounded border border-stone bg-surface px-2 py-1 text-xs outline-none focus:border-cedar"
                    value={pickedPackId || photoPackUi.selectedPackId || ""}
                    disabled={packPending}
                    onChange={(e) => {
                      const next = e.target.value;
                      setPickedPackId(next);
                      startPack(async () => {
                        stayOnMarketingForKitWrite(photoPackUi.skuId);
                        await setCreativePackChoiceAction(
                          photoPackUi.skuId,
                          photoPackUi.kitId,
                          c.id,
                          next,
                        );
                      });
                    }}
                  >
                    {photoPackUi.packs.map((pack) => (
                      <option key={pack.id} value={pack.id}>
                        {showPhotoPackDefaultControls(photoPackUi.packs.length) &&
                        pack.isDefault
                          ? `${pack.name} ${t("photoPacksDefaultSuffix")}`
                          : pack.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          ) : null}
          <p className="mt-2 font-medium text-ink">{t("visualToolPromptLabel")}</p>
          <pre
            dir={isAr ? "rtl" : undefined}
            className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap rounded border border-stone bg-surface-subtle p-2 text-[10px] leading-relaxed text-stone-dark"
          >
            {visualPrompt}
          </pre>
          <p className="mt-1 text-[10px] text-stone-dark">
            {visualToolUsesPhotoPack(visual.tool)
              ? t("visualToolHintInApp")
              : t("visualToolHintPhoneFilm")}
          </p>
          {copyPromptHonesty ? (
            <p className="mt-1 text-[11px] text-amber-900">{copyPromptHonesty}</p>
          ) : null}
          {visualGen && visualToolUsesPhotoPack(visual.tool) ? (
            <div className="mt-2 space-y-2">
              {photoPackUi && photoPackUi.packs.length === 0 ? (
                <p className="text-[11px] text-stone-dark">
                  {t("visualGenHonestyNoPack")}
                </p>
              ) : null}
              {genFile ? (
                <div className="flex flex-wrap items-center gap-2">
                  {genFile.kind === "clip" ? (
                    <video
                      src={`${genFile.href}?v=${genFile.generatedAt ?? ""}`}
                      className="h-16 w-16 rounded border border-stone object-cover"
                    />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`${genFile.href}?v=${genFile.generatedAt ?? ""}`}
                      alt=""
                      className="h-16 w-16 rounded border border-stone object-cover"
                    />
                  )}
                  <button
                    type="button"
                    disabled={genPending}
                    onClick={() => setPopupOpen(true)}
                    className="rounded-md border border-cedar/40 bg-cedar/10 px-2.5 py-1 text-xs font-semibold text-cedar-deep hover:bg-cedar/15 disabled:opacity-50"
                  >
                    {t("visualGenView")}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={genPending}
                  onClick={() => {
                    stayOnMarketingForKitWrite(visualGen.skuId);
                    setGenHonesty(null);
                    startGen(async () => {
                      const res = await generateVisualAction(
                        visualGen.skuId,
                        visualGen.kitId,
                        c.id,
                      );
                      if (!res.ok) {
                        setGenHonesty(explainVisualGen(res.error, t));
                        return;
                      }
                      setUsedGeneric(res.value.usedGeneric);
                      setGenFile({
                        kitId: visualGen.kitId,
                        creativeId: c.id,
                        href: res.value.href,
                        kind: res.value.kind,
                        regenerateCount: res.value.regenerateCount,
                        generatedAt: new Date().toISOString(),
                      });
                      setPopupOpen(true);
                    });
                  }}
                  className="rounded-md bg-cedar px-2.5 py-1 text-xs font-semibold text-foam hover:bg-cedar-deep disabled:opacity-50"
                >
                  {genPending ? t("visualGenGenerating") : t("visualGenGenerate")}
                </button>
              )}
              {genHonesty ? (
                <p className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] text-amber-950">
                  {genHonesty}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      {popupOpen && genFile && visualGen ? (
        <VisualResultDialog
          href={`${genFile.href}?v=${genFile.generatedAt ?? ""}`}
          kind={genFile.kind}
          regenerateCount={genFile.regenerateCount}
          usedGeneric={
            usedGeneric || Boolean(photoPackUi && photoPackUi.packs.length === 0)
          }
          pending={genPending}
          honesty={genHonesty}
          onClose={() => setPopupOpen(false)}
          onSave={() => {
            void downloadOwnedVisual(genFile.href, genFile.kind);
          }}
          onRegenerate={() => {
            stayOnMarketingForKitWrite(visualGen.skuId);
            setGenHonesty(null);
            startGen(async () => {
              const res = await regenerateVisualAction(
                visualGen.skuId,
                visualGen.kitId,
                c.id,
              );
              if (!res.ok) {
                setGenHonesty(explainVisualGen(res.error, t));
                return;
              }
              setUsedGeneric(res.value.usedGeneric);
              setGenFile({
                kitId: visualGen.kitId,
                creativeId: c.id,
                href: res.value.href,
                kind: res.value.kind,
                regenerateCount: res.value.regenerateCount,
                generatedAt: new Date().toISOString(),
              });
            });
          }}
          onDiscard={() => {
            if (!window.confirm(t("visualGenDiscardConfirm"))) return;
            stayOnMarketingForKitWrite(visualGen.skuId);
            startGen(async () => {
              const res = await discardVisualAction(
                visualGen.skuId,
                visualGen.kitId,
                c.id,
              );
              if (!res.ok) {
                setGenHonesty(explainVisualGen("not_found", t));
                return;
              }
              setGenFile(null);
              setPopupOpen(false);
              setGenHonesty(null);
            });
          }}
        />
      ) : null}
    </div>
  );
}
