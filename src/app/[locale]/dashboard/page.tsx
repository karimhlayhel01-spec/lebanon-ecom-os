import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { requireOnboardedContext } from "@/lib/workspace";
import { getDiscoveryView } from "@/lib/discovery/service";
import { getSkuView } from "@/lib/sku/service";
import { getFinancePanel } from "@/lib/finance/service";
import { getOrchestration } from "@/lib/orchestrator/service";
import { startDiscoveryAction } from "@/actions/discovery";
import { AppHeader } from "@/components/dashboard/AppHeader";
import { CompactSku } from "@/components/dashboard/CompactSku";
import { StageHero, type HeroCta } from "@/components/dashboard/StageHero";
import { JourneyStrip, type JourneyStep } from "@/components/dashboard/JourneyStrip";
import { StatusCard } from "@/components/dashboard/StatusCard";
import { WeekSnapshot } from "@/components/dashboard/WeekSnapshot";
import { DiscoveryBoard } from "@/components/discovery/DiscoveryBoard";
import { OrchestratorPanel } from "@/components/orchestrator/OrchestratorPanel";
import { getDashboardStatus } from "@/lib/dashboard/status";
import { isPreviewMode } from "@/lib/preview/config"; // PREVIEW (removable)
import { PreviewBanner } from "@/components/preview/PreviewBanner"; // PREVIEW (removable)
import type { AppLocale } from "@/i18n/routing";

type Props = {
  params: Promise<{ locale: string }>;
};

function stageStep(state: string): JourneyStep {
  switch (state) {
    case "discovery":
      return "discovery";
    case "supplier_sample":
      return "accepted";
    case "sample_approved":
    case "store_setup":
      return "sample";
    case "batch_ordered":
      return "batch";
    case "batch_arrived_ready":
      return "arrived";
    case "selling":
      return "selling";
    default:
      return "discovery";
  }
}

export default async function DashboardPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const ctx = await requireOnboardedContext(locale);

  const t = await getTranslations("Dashboard");
  const disc = await getTranslations("Discovery");

  const workspace = ctx.workspace;
  const journey = ctx.journey;
  const side = ctx.side!;
  const primaryState = journey?.primaryState ?? "discovery";
  const isPaused = primaryState === "paused";

  const inDiscovery = primaryState === "discovery" && !isPaused;
  const discovery = inDiscovery
    ? await getDiscoveryView(workspace.id, locale as AppLocale)
    : null;

  const skuView =
    !inDiscovery && side.productAccepted
      ? await getSkuView(workspace.id)
      : null;

  const sampleApproved =
    side.sampleStatus === "approved" ||
    [
      "sample_approved",
      "store_setup",
      "batch_ordered",
      "batch_arrived_ready",
      "selling",
    ].includes(primaryState);
  const isSelling = primaryState === "selling";
  const showFinance = side.batchArrivedReady || isSelling;
  const financeView = showFinance ? await getFinancePanel(workspace.id) : null;

  const orchestration = await getOrchestration(workspace.id);

  // Stage from which we drive the hero (paused reflects the paused-from state).
  const heroState = isPaused
    ? (journey?.pausedFromState ?? "discovery")
    : primaryState;

  // Status is post-discovery only (also hidden when paused-from-discovery).
  const showStatus = heroState !== "discovery" && side.productAccepted;
  const statusView = showStatus
    ? await getDashboardStatus({
        workspaceId: workspace.id,
        locale: locale as AppLocale,
        primaryState: heroState,
        productAccepted: side.productAccepted,
        sampleStatus: side.sampleStatus,
        batchOrdered: side.batchOrdered,
        batchArrivedReady: side.batchArrivedReady,
        sideMarketingStage: side.marketingStage,
      })
    : null;

  const storeWhisper =
    side.storeReadyPercent < 100
      ? { label: t("heroStoreWhisper", { pct: side.storeReadyPercent }), href: "/store" }
      : null;

  const hero: {
    eyebrow: string;
    title: string;
    subline: string;
    ctas: HeroCta[];
    whisper: { label: string; href: string } | null;
  } = (() => {
    if (isPaused) {
      return {
        eyebrow: t("heroPausedEyebrow"),
        title: t("heroPausedTitle"),
        subline: t("heroPausedSub"),
        ctas: [],
        whisper: null,
      };
    }
    switch (primaryState) {
      case "discovery":
        return {
          eyebrow: t("heroDiscoveryEyebrow"),
          title: t("heroDiscoveryTitle"),
          subline: t("heroDiscoverySub"),
          ctas: [
            {
              href: "#discovery",
              label: discovery ? t("ctaContinueDiscovery") : t("ctaStartDiscovery"),
              tone: "primary",
            },
          ],
          whisper: null,
        };
      case "supplier_sample": {
        const label =
          side.sampleStatus === "in_flight" || side.sampleStatus === "requested"
            ? t("ctaSampleDecision")
            : side.sampleStatus === "rejected"
              ? t("ctaSampleRetry")
              : t("ctaRequestSample");
        return {
          eyebrow: t("heroSampleEyebrow"),
          title: t("heroSampleTitle"),
          subline: t("heroSampleSub"),
          ctas: [{ href: "/supplier", label, tone: "primary" }],
          whisper: null,
        };
      }
      case "sample_approved":
      case "store_setup": {
        // Cost quotes are the obvious next step until saved: promote them to the
        // primary CTA (deep-link to Supplier #cost-quotes) and keep batch as a
        // parallel action — never removed (marking batch stays allowed).
        const quotesSaved = side.costQuotesSaved;
        const storeCta: HeroCta = {
          href: "/store",
          label: t("ctaStoreSetup"),
          tone: "parallel",
        };
        const batchCta: HeroCta = {
          href: "/supplier",
          label: t("ctaOrderBatch"),
          tone: quotesSaved ? "primary" : "parallel",
        };
        return {
          eyebrow: t("heroSetupEyebrow"),
          title: t("heroSetupTitle"),
          subline: quotesSaved ? t("heroSetupSub") : t("heroSetupSubCosts"),
          ctas: quotesSaved
            ? [batchCta, storeCta]
            : [
                {
                  href: "/supplier#cost-quotes",
                  label: t("ctaEnterCosts"),
                  tone: "primary",
                },
                batchCta,
                storeCta,
              ],
          whisper: {
            label: t("heroMarketingIntroWhisper"),
            href: "/marketing?stage=intro_pdf",
          },
        };
      }
      case "batch_ordered":
        return {
          eyebrow: t("heroOrderedEyebrow"),
          title: t("heroOrderedTitle"),
          subline: t("heroOrderedSub"),
          ctas: [
            { href: "/supplier", label: t("ctaMarkArrived"), tone: "primary" },
            {
              href: "/marketing?stage=pre_launch",
              label: t("ctaPreLaunch"),
              tone: "parallel",
            },
          ],
          whisper: storeWhisper,
        };
      case "selling":
        return {
          eyebrow: t("heroSellingEyebrow"),
          title: t("heroSellingTitle"),
          subline: t("heroSellingSub"),
          ctas: [
            { href: "/finance", label: t("ctaLogWeek"), tone: "primary" },
            {
              href: "/marketing?stage=monthly_refresh",
              label: t("ctaMonthlyRefresh"),
              tone: "parallel",
            },
          ],
          whisper: null,
        };
      case "batch_arrived_ready":
      default:
        return {
          eyebrow: t("heroBatchEyebrow"),
          title: t("heroBatchTitle"),
          subline: t("heroBatchSub"),
          ctas: [
            { href: "/finance", label: t("ctaStartSelling"), tone: "primary" },
            {
              href: "/marketing?stage=launch",
              label: t("ctaLaunchMarketing"),
              tone: "parallel",
            },
          ],
          whisper: storeWhisper,
        };
    }
  })();

  const tools: Array<{ href: "/sku" | "/supplier" | "/store" | "/marketing"; label: string }> =
    side.productAccepted
      ? [
          { href: "/sku", label: t("toolSku") },
          { href: "/supplier", label: t("toolSupplier") },
          ...(sampleApproved
            ? ([
                { href: "/store", label: t("toolStore") },
                { href: "/marketing", label: t("toolMarketing") },
              ] as const)
            : []),
        ]
      : [];

  return (
    <div className="min-h-screen">
      <AppHeader isPaused={isPaused} />

      <main id="top" className="mx-auto w-full max-w-6xl px-6 py-8">
        {isPreviewMode() && <PreviewBanner />}

        <StageHero
          eyebrow={hero.eyebrow}
          title={hero.title}
          subline={hero.subline}
          ctas={hero.ctas}
          whisper={hero.whisper}
        />

        {tools.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-stone-dark">
              {t("toolsLabel")}
            </span>
            {tools.map((tool) => (
              <Link
                key={tool.href}
                href={tool.href}
                className="rounded-full border border-stone bg-surface px-3 py-1 text-xs font-medium text-ink transition hover:bg-sand"
              >
                {tool.label}
              </Link>
            ))}
          </div>
        )}

        <div className="mt-5 grid gap-5 lg:grid-cols-3">
          <section className="animate-rise space-y-5 lg:col-span-2">
            {inDiscovery ? (
              discovery ? (
                <div id="discovery">
                  <DiscoveryBoard view={discovery} />
                </div>
              ) : (
                <div id="discovery" className="surface-card p-6 text-center">
                  <h2 className="font-display text-lg text-ink">{disc("title")}</h2>
                  <p className="mx-auto mt-2 max-w-md text-sm text-stone-dark">
                    {disc("startHint")}
                  </p>
                  <form action={startDiscoveryAction} className="mt-4">
                    <button
                      type="submit"
                      className="rounded-md bg-cedar px-5 py-2.5 text-sm font-semibold text-foam shadow-sm transition hover:bg-cedar-deep"
                    >
                      {disc("startCta")}
                    </button>
                  </form>
                </div>
              )
            ) : skuView ? (
              <>
                {isSelling && financeView && <WeekSnapshot view={financeView} />}
                <CompactSku
                  sku={skuView}
                  actual={financeView?.currentActual ?? null}
                  quiet
                />
              </>
            ) : (
              <div className="surface-card p-5">
                <h2 className="font-display text-lg text-ink">{t("nextCta")}</h2>
                <p className="mt-2 text-sm text-stone-dark">
                  {t("nextCtaPlaceholder")}
                </p>
              </div>
            )}
          </section>

          <aside className="animate-rise-delay space-y-5">
            {statusView && <StatusCard view={statusView} />}
            <JourneyStrip current={stageStep(heroState)} />
            {orchestration && !isPaused && (
              <OrchestratorPanel view={orchestration} coachingOnly />
            )}
          </aside>
        </div>
      </main>
    </div>
  );
}
