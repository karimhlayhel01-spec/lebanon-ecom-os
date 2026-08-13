import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireOnboardedContext } from "@/lib/workspace";
import { getSkuViewById } from "@/lib/sku/service";
import {
  effectiveSkuPrimaryState,
  getSkuJourney,
} from "@/lib/sku/journey";
import { getCurrentActual, getFinancePanel } from "@/lib/finance/service";
import { getSupplierPanel } from "@/lib/supplier/service";
import { getMarketingPanel } from "@/lib/marketing/service";
import { getSkuOrchestration } from "@/lib/orchestrator/service";
import { getArchiveWarnings } from "@/lib/sku/lifecycle";
import {
  filterSkuHeroCtas,
  isSkuFinanceSectionUnlocked,
  isSkuMarketingSectionUnlocked,
  isSkuStoreSectionUnlocked,
} from "@/lib/sku/page-sections";
import { buildToolsHrefs } from "@/lib/sku/tools";
import { SkuCard } from "@/components/sku/SkuCard";
import { AppHeader } from "@/components/dashboard/AppHeader";
import { StageHero, type HeroCta } from "@/components/dashboard/StageHero";
import { SkuLifecycleControls } from "@/components/shop/SkuLifecycleControls";
import { ToolsRow } from "@/components/shop/ToolsRow";
import { SkuSectionFocus } from "@/components/shop/SkuSectionFocus";
import { SupplierPanel } from "@/components/supplier/SupplierPanel";
import { MarketingPanel } from "@/components/marketing/MarketingPanel";
import { FinancePanel } from "@/components/finance/FinancePanel";
import { resolveVocabHighlightPhase } from "@/lib/vocabulary/glossary";

type Props = {
  params: Promise<{ locale: string; id: string }>;
};

const SKU_COACHING = new Set([
  "sampleFirst",
  "protectMargins",
  "startSmall",
  "over10k",
]);

export default async function SkuDetailPage({ params }: Props) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const ctx = await requireOnboardedContext(locale);
  const t = await getTranslations("Shop");
  const td = await getTranslations("Dashboard");

  const sku = await getSkuViewById(ctx.workspace.id, id);
  if (!sku) notFound();

  const card = await db
    .select()
    .from(schema.skuCards)
    .where(eq(schema.skuCards.id, id))
    .then((rows) => rows[0]);
  if (!card || card.workspaceId !== ctx.workspace.id) notFound();
  if (card.lifecycleStatus === "wiped") notFound();

  // Do not mutate workspaces.activeSkuId on GET — multi-tab views must not
  // race which SKU mutations target. Page/actions pass explicit skuId instead.

  const [eff, journey, supplier, orchestration, archiveWarnings] =
    await Promise.all([
      effectiveSkuPrimaryState(ctx.workspace.id, id),
      getSkuJourney(id),
      card.lifecycleStatus === "live"
        ? getSupplierPanel(ctx.workspace.id, id)
        : Promise.resolve(null),
      getSkuOrchestration(ctx.workspace.id, id),
      getArchiveWarnings(ctx.workspace.id, id),
    ]);

  const primaryState = eff.primaryState;
  const isPaused = eff.shopPaused || eff.skuPaused;
  const shopPaused = eff.shopPaused;

  // Match deep-page gates: marketing/store after sample approved; finance after
  // batch arrived / selling. Do not mount panels earlier.
  const showMarketing =
    card.lifecycleStatus === "live" &&
    isSkuMarketingSectionUnlocked({
      sampleStatus: journey?.sampleStatus,
      primaryState: journey?.primaryState ?? primaryState,
      pausedFromState: journey?.pausedFromState,
    });
  const showStore =
    card.lifecycleStatus === "live" &&
    isSkuStoreSectionUnlocked({
      sampleStatus: journey?.sampleStatus,
      primaryState: journey?.primaryState ?? primaryState,
      pausedFromState: journey?.pausedFromState,
    });
  const showFinance =
    card.lifecycleStatus === "live" &&
    isSkuFinanceSectionUnlocked({
      batchArrivedReady: !!journey?.batchArrivedReady,
      primaryState: journey?.primaryState ?? primaryState,
      pausedFromState: journey?.pausedFromState,
    });

  const storeReadyPercent = ctx.side?.storeReadyPercent ?? 0;
  const [actual, marketing, finance] = await Promise.all([
    showFinance ? getCurrentActual(ctx.workspace.id) : Promise.resolve(null),
    showMarketing
      ? getMarketingPanel(ctx.workspace.id, id)
      : Promise.resolve(null),
    showFinance ? getFinancePanel(ctx.workspace.id) : Promise.resolve(null),
  ]);

  const ctas: HeroCta[] = (() => {
    if (isPaused || card.lifecycleStatus !== "live") return [];
    const raw: HeroCta[] = (() => {
      switch (primaryState) {
        case "supplier_sample":
          return [
            {
              href: `#supplier`,
              label: td("ctaRequestSample"),
              tone: "primary",
            },
          ];
        case "sample_approved":
        case "store_setup":
          return [
            {
              href: `#supplier`,
              label: journey?.costQuotesSaved
                ? td("ctaOrderBatch")
                : td("ctaEnterCosts"),
              tone: "primary",
            },
            {
              href: `#marketing`,
              label: td("openMarketing"),
              tone: "parallel",
            },
          ];
        case "batch_ordered":
          return [
            {
              href: `#supplier`,
              label: td("ctaMarkArrived"),
              tone: "primary",
            },
            {
              href: `#marketing`,
              label: td("ctaPreLaunch"),
              tone: "parallel",
            },
          ];
        case "batch_arrived_ready":
          return [
            {
              href: `#finance`,
              label: td("ctaStartSelling"),
              tone: "primary",
            },
            {
              href: `#marketing`,
              label: td("ctaLaunchMarketing"),
              tone: "parallel",
            },
          ];
        case "selling":
          return [
            {
              href: `#finance`,
              label: td("ctaLogWeek"),
              tone: "primary",
            },
            {
              href: `#marketing`,
              label: td("ctaWeeklyRefresh"),
              tone: "parallel",
            },
          ];
        default:
          return [];
      }
    })();
    return filterSkuHeroCtas(raw, {
      marketing: showMarketing,
      finance: showFinance,
    });
  })();

  const coaching: string[] = [];
  if (orchestration?.coaching?.length && !isPaused) {
    for (const c of orchestration.coaching) {
      if (SKU_COACHING.has(c.id)) {
        coaching.push(t(`coaching.${c.id}` as never));
      }
    }
  }
  if (primaryState === "supplier_sample") {
    coaching.push(t("coaching.sampleFirst"));
  }
  if (
    primaryState === "sample_approved" ||
    primaryState === "store_setup" ||
    primaryState === "batch_ordered"
  ) {
    coaching.push(t("coaching.batchMargins"));
  }

  const uniqueCoaching = [...new Set(coaching)].slice(0, 4);

  const primaryCta = ctas.find((c) => c.tone === "primary") ?? null;
  const primarySectionId = primaryCta?.href.replace(/^#/, "") ?? null;

  function sectionToneClass(sectionId: string): string {
    if (!primarySectionId) return "";
    return sectionId === primarySectionId
      ? "sku-section-primary"
      : "sku-section-secondary";
  }

  const highlightPhase = resolveVocabHighlightPhase(
    journey?.primaryState ?? primaryState,
    journey?.pausedFromState,
  );

  return (
    <div className="min-h-screen">
      <AppHeader
        isPaused={shopPaused || isPaused}
        highlightPhase={highlightPhase}
      />
      <main className="app-shell py-8">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/dashboard?hub=1"
              className="text-sm font-medium text-sea underline-offset-2 hover:underline"
            >
              {t("backToShop")}
            </Link>
            <ToolsRow
              quiet
              hrefs={buildToolsHrefs(id)}
              unlocked={{
                store: true,
                supplier: !!supplier,
                marketing: showMarketing,
                finance: showFinance,
              }}
            />
          </div>
          <div className="opacity-80">
            <SkuLifecycleControls
              skuId={id}
              lifecycleStatus={card.lifecycleStatus}
              warnings={archiveWarnings}
            />
          </div>
        </div>

        <StageHero
          eyebrow={t("skuEyebrow")}
          title={sku.name}
          subline={t("skuSubline")}
          ctas={ctas}
          whisper={null}
        />

        {card.lifecycleStatus === "archived" && (
          <p
            role="status"
            className="mt-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950"
          >
            {t("archivedSkuBanner")}
          </p>
        )}

        {uniqueCoaching.length > 0 && (
          <section className="mt-3 rounded-md border border-stone/50 bg-surface-subtle/80 px-3 py-2.5">
            <h2 className="text-xs font-semibold text-stone-dark">
              {t("skuCoachingTitle")}
            </h2>
            <ul className="mt-1.5 list-disc space-y-0.5 ps-4 text-xs text-stone-dark">
              {uniqueCoaching.map((c) => (
                <li key={c} dir="auto">
                  {c}
                </li>
              ))}
            </ul>
          </section>
        )}

        <SkuSectionFocus skuId={id} coldFocusSection={primarySectionId} />

        <nav
          aria-label={t("sectionNavAria")}
          className="mt-3 flex flex-wrap items-center gap-1.5"
        >
          {(
            [
              { id: "product", label: t("sectionProduct"), show: true },
              {
                id: "store",
                label: t("sectionStore"),
                show: showStore,
              },
              {
                id: "supplier",
                label: t("sectionSupplier"),
                show: !!supplier,
              },
              {
                id: "marketing",
                label: t("sectionMarketing"),
                show: showMarketing && !!marketing,
              },
              {
                id: "finance",
                label: t("sectionFinance"),
                show: showFinance && !!finance,
              },
            ] as const
          )
            .filter((s) => s.show)
            .map((s) => {
              const isPrimary = primarySectionId === s.id;
              return (
                <a
                  key={s.id}
                  href={`#${s.id}`}
                  className={
                    isPrimary
                      ? "rounded-full border border-sea/35 bg-sea/5 px-2.5 py-0.5 text-[11px] font-medium text-sea transition hover:bg-sea/10"
                      : "rounded-full border border-stone/45 bg-transparent px-2.5 py-0.5 text-[11px] font-medium text-stone-dark/80 transition hover:border-sea/30 hover:text-sea"
                  }
                >
                  {s.label}
                </a>
              );
            })}
        </nav>

        <section
          id="product"
          className={`mt-6 scroll-mt-6 ${sectionToneClass("product")}`}
        >
          <h2 className="mb-3 font-display text-lg text-ink">
            {t("sectionProduct")}
          </h2>
          <SkuCard sku={sku} actual={actual} />
        </section>

        {showStore && (
          <section
            id="store"
            className={`mt-8 scroll-mt-6 ${sectionToneClass("store")}`}
          >
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-sea/80">
              {t("storeParallelKicker")}
            </p>
            <h2 className="mb-3 font-display text-lg text-ink">
              {t("sectionStore")}
            </h2>
            <div className="rounded-lg border border-stone/60 bg-surface-subtle px-4 py-4">
              <p className="text-sm text-stone-dark">{t("storeSectionHint")}</p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <p className="text-sm font-medium text-ink">
                  {t("storePct", { pct: storeReadyPercent })}
                </p>
                <Link
                  href={`/store?sku=${id}`}
                  className="text-sm font-medium text-sea underline-offset-2 hover:underline"
                >
                  {t("openStoreSetup")} →
                </Link>
              </div>
            </div>
          </section>
        )}

        {supplier && (
          <section
            id="supplier"
            className={`mt-8 scroll-mt-6 ${sectionToneClass("supplier")}`}
          >
            <h2 className="mb-3 font-display text-lg text-ink">
              {t("sectionSupplier")}
            </h2>
            <SupplierPanel view={supplier} />
          </section>
        )}

        {showMarketing && marketing && (
          <section
            id="marketing"
            className={`mt-8 scroll-mt-6 ${sectionToneClass("marketing")}`}
          >
            <h2 className="mb-3 font-display text-lg text-ink">
              {t("sectionMarketing")}
            </h2>
            <MarketingPanel view={marketing} surface="sku" />
          </section>
        )}

        {showFinance && finance && (
          <section
            id="finance"
            className={`mt-8 scroll-mt-6 ${sectionToneClass("finance")}`}
          >
            <h2 className="mb-3 font-display text-lg text-ink">
              {t("sectionFinance")}
            </h2>
            <FinancePanel view={finance} preferredSkuId={id} />
          </section>
        )}
      </main>
    </div>
  );
}
