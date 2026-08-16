import { getTranslations, setRequestLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { Link } from "@/i18n/navigation";
import { requireOnboardedContext } from "@/lib/workspace";
import { getDiscoveryView } from "@/lib/discovery/service";
import { getFinancePanel } from "@/lib/finance/service";
import {
  computeRunwayForSkuWithImportBatch,
  resolveUnitsLeftGlance,
  shouldShowUnitsLeftOnHub,
} from "@/lib/finance/sku-runway";
import { getShopOrchestration } from "@/lib/orchestrator/service";
import { normalizeReorderStatus } from "@/lib/supplier/reorder";
import {
  resolveWarmedSparesBySku,
  resolveWorkingSuppliersBySku,
} from "@/lib/supplier/working-path";
import { db, schema } from "@/db";
import { asc, eq } from "drizzle-orm";
import { startDiscoveryAction } from "@/actions/discovery";
import { AppHeader } from "@/components/dashboard/AppHeader";
import { DiscoveryBoard } from "@/components/discovery/DiscoveryBoard";
import { OrchestratorPanel } from "@/components/orchestrator/OrchestratorPanel";
import { ShopHub, type ShopSkuChip } from "@/components/shop/ShopHub";
import {
  MarketingStatusBlock,
  SupplierStatusBlock,
} from "@/components/dashboard/StatusCard";
import { JourneyStrip } from "@/components/dashboard/JourneyStrip";
import {
  listArchivedSkus,
  listLiveSkus,
  listSkuJourneysForSkus,
  mapSkuJourneysBySkuId,
  type SkuJourneyRow,
} from "@/lib/sku/journey";
import { evaluateAddSku } from "@/lib/sku/add-sku";
import {
  resolvePostLoginLanding,
  shouldShowAddSkuDiscovery,
  shouldShowShopHub,
} from "@/lib/sku/add-sku-gate";
import {
  effectiveJourneyState,
  isSkuFinanceSectionUnlocked,
  isSkuMarketingSectionUnlocked,
} from "@/lib/sku/page-sections";
import {
  resolveHubOrientationSkuId,
  resolveHubToolSkuId,
} from "@/lib/sku/tools";
import { getDashboardStatus } from "@/lib/dashboard/status";
import { primaryStateToJourneyStep } from "@/lib/dashboard/journey-step";
import {
  resolveHubVocabHighlightPhase,
} from "@/lib/vocabulary/glossary";
import type { AppLocale } from "@/i18n/routing";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function attentionForSku(
  skuId: string,
  journey: {
    primaryState: string;
    sampleStatus: string;
    batchOrdered: boolean;
    batchArrivedReady: boolean;
    costQuotesSaved: boolean;
    reorderStatus?: string;
    reorderNudge?: boolean;
  } | null,
  t: Awaited<ReturnType<typeof getTranslations<"Shop">>>,
): Array<{ label: string; href: string }> {
  if (!journey) return [];
  const chips: Array<{ label: string; href: string }> = [];
  const state = journey.primaryState;
  if (state === "supplier_sample") {
    chips.push({
      label: t("chip.sample"),
      href: `/sku/${skuId}?attn=sample#supplier`,
    });
  }
  if (
    (state === "sample_approved" || state === "store_setup") &&
    !journey.costQuotesSaved
  ) {
    chips.push({
      label: t("chip.costs"),
      href: `/sku/${skuId}?attn=costs#supplier`,
    });
  }
  if (
    (state === "sample_approved" || state === "store_setup") &&
    !journey.batchOrdered
  ) {
    chips.push({
      label: t("chip.batch"),
      href: `/sku/${skuId}?attn=batch#supplier`,
    });
  }
  if (state === "sample_approved" || state === "store_setup") {
    chips.push({
      label: t("chip.store"),
      href: "/store",
    });
  }
  if (state === "batch_ordered" && !journey.batchArrivedReady) {
    chips.push({
      label: t("chip.arrived"),
      href: `/sku/${skuId}?attn=arrived#batch-arrived`,
    });
  }
  if (state === "batch_arrived_ready") {
    chips.push({
      label: t("chip.selling"),
      href: `/sku/${skuId}?attn=selling#finance`,
    });
  }
  if (state === "selling") {
    chips.push({
      label: t("chip.topicA"),
      href: `/sku/${skuId}?attn=topicA#finance`,
    });
    if (journey.reorderStatus === "ordered") {
      chips.push({
        label: t("chip.reorderInTransit"),
        href: `/sku/${skuId}?attn=reorder#supplier`,
      });
    } else if (journey.reorderNudge) {
      chips.push({
        label: t("chip.restock"),
        href: `/sku/${skuId}?attn=reorder#supplier`,
      });
    }
  }
  return chips;
}

/** Hub Next line: first journey attention chip that deep-links into a SKU section. */
function pickHubNextDeepLink(
  attention: Array<{ label: string; href: string }>,
): { label: string; href: string } | null {
  for (const chip of attention) {
    // `/sku/[id]?attn=…#…` — skips bare `/store` and other non-focus paths.
    if (
      chip.href.startsWith("/sku/") &&
      chip.href.includes("attn=") &&
      chip.href.includes("#")
    ) {
      return chip;
    }
  }
  return null;
}

export default async function DashboardPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const sp = await searchParams;
  setRequestLocale(locale);

  const forceHub = sp.hub === "1" || sp.hub === "true";
  const addSkuFlag = sp.addSku === "1" || sp.addSku === "true";

  const ctx = await requireOnboardedContext(locale);
  const t = await getTranslations("Dashboard");
  const shopT = await getTranslations("Shop");
  const disc = await getTranslations("Discovery");

  const workspace = ctx.workspace;
  const live = await listLiveSkus(workspace.id);
  const landing = resolvePostLoginLanding(live.map((s) => ({ id: s.id })));

  const showHub = shouldShowShopHub({
    liveSkuCount: live.length,
    forceHub,
  });

  // Default landing: exactly 1 live SKU → SKU page (unless explicit Shop hub).
  if (!showHub && landing.kind === "sku") {
    redirect({ href: `/sku/${landing.skuId}`, locale });
  }

  const shopPaused = !!workspace.shopPaused;
  const side = ctx.side!;
  const journey = ctx.journey;
  const primaryState = shopPaused
    ? "paused"
    : (journey?.primaryState ?? "discovery");
  const isPaused = primaryState === "paused" || shopPaused;

  const inDiscovery = live.length === 0 && !isPaused;
  const discovery = inDiscovery
    ? await getDiscoveryView(workspace.id, locale as AppLocale)
    : null;

  const showAddDiscovery = shouldShowAddSkuDiscovery({
    liveSkuCount: live.length,
    addSkuFlag,
  });
  const addSkuDiscovery = showAddDiscovery
    ? await getDiscoveryView(workspace.id, locale as AppLocale)
    : null;

  const financeView =
    live.length > 0 ? await getFinancePanel(workspace.id) : null;
  const orchestration = await getShopOrchestration(workspace.id);
  const addSkuEval = live.length > 0 ? await evaluateAddSku(workspace.id) : null;
  const archived =
    live.length >= 1 ? await listArchivedSkus(workspace.id) : [];

  const topicRowsForRunway =
    live.length >= 1 && showHub
      ? await db
          .select({ perSkuSoldLeft: schema.topicAEntries.perSkuSoldLeft })
          .from(schema.topicAEntries)
          .where(eq(schema.topicAEntries.workspaceId, workspace.id))
          .orderBy(asc(schema.topicAEntries.weekStart))
          
      : [];

  const skuChips: ShopSkuChip[] = [];
  let financeUnlockedOnHub = false;
  /**
   * Hub journey map — one `sku_journeys` IN(…) query for all live SKUs.
   * Before: N× getSkuJourney per chip loop (+ fallbacks for tools/orientation).
   * Hub Next stays display-only from chips; Status uses light facts (not panel).
   */
  let journeyBySkuId = new Map<string, SkuJourneyRow>();
  if (live.length >= 1 && showHub) {
    journeyBySkuId = mapSkuJourneysBySkuId(
      await listSkuJourneysForSkus(live.map((s) => s.id)),
    );
    const liveIds = live.map((s) => s.id);
    const [workingSuppliers, warmedBySku] = await Promise.all([
      resolveWorkingSuppliersBySku(liveIds, journeyBySkuId),
      resolveWarmedSparesBySku(liveIds, journeyBySkuId),
    ]);

    for (const s of live) {
      const j = journeyBySkuId.get(s.id) ?? null;
      const effState = shopPaused ? "paused" : (j?.primaryState ?? "discovery");
      if (
        isSkuFinanceSectionUnlocked({
          batchArrivedReady: !!j?.batchArrivedReady,
          primaryState: j?.primaryState ?? "discovery",
          pausedFromState: j?.pausedFromState,
        })
      ) {
        financeUnlockedOnHub = true;
      }
      const reorderStatus = normalizeReorderStatus(j?.reorderStatus);
      let importBatch: {
        totalUnitsReceived?: number | null;
        unitsLeft?: number | null;
        suggestedFirstBatch?: number | null;
      } | null = null;
      try {
        importBatch = JSON.parse(s.importBatch) as {
          totalUnitsReceived?: number | null;
          unitsLeft?: number | null;
          suggestedFirstBatch?: number | null;
        };
      } catch {
        importBatch = null;
      }
      const runway = computeRunwayForSkuWithImportBatch(
        topicRowsForRunway,
        s.id,
        {
          liveSkuCount: live.length,
          importBatch,
          batchArrivedReady: !!j?.batchArrivedReady,
        },
      );
      const unitsLeftGlance = resolveUnitsLeftGlance(runway);
      const reorderNudge =
        effState === "selling" &&
        reorderStatus === "idle" &&
        runway.nudge;
      const showUnits = shouldShowUnitsLeftOnHub({
        primaryState: effState,
        unitsLeft:
          unitsLeftGlance.kind === "known" ? unitsLeftGlance.unitsLeft : null,
      });
      const spares = warmedBySku.get(s.id) ?? {
        insuranceAvailable: false,
        warmedSpareNames: [],
      };
      const working = workingSuppliers.get(s.id) ?? null;
      skuChips.push({
        id: s.id,
        name: s.name,
        primaryState: effState,
        paused: j?.primaryState === "paused" || shopPaused,
        workingSupplierName: working?.name ?? null,
        workingSupplierId: working?.id ?? null,
        insuranceAvailable: spares.insuranceAvailable,
        warmedSpareNames: spares.warmedSpareNames,
        unitsLeftGlance: showUnits ? unitsLeftGlance : null,
        attention: attentionForSku(
          s.id,
          j
            ? {
                primaryState: j.primaryState,
                sampleStatus: j.sampleStatus,
                batchOrdered: j.batchOrdered,
                batchArrivedReady: j.batchArrivedReady,
                costQuotesSaved: j.costQuotesSaved,
                reorderStatus,
                reorderNudge,
              }
            : null,
          shopT,
        ),
      });
    }
  }

  // Hub Tools: active live SKU, else first live — never dead-end with live SKUs.
  const toolsTargetSkuId = resolveHubToolSkuId(
    live.map((s) => s.id),
    workspace.activeSkuId,
  );
  const toolsJourney = toolsTargetSkuId
    ? (journeyBySkuId.get(toolsTargetSkuId) ?? null)
    : null;
  const toolsUnlocked = {
    // Always one-click (empty/locked /store when sample not approved).
    store: true,
    supplier: !!toolsTargetSkuId,
    marketing: toolsJourney
      ? isSkuMarketingSectionUnlocked({
          sampleStatus: toolsJourney.sampleStatus,
          primaryState: toolsJourney.primaryState,
          pausedFromState: toolsJourney.pausedFromState,
        })
      : false,
    finance: toolsJourney
      ? isSkuFinanceSectionUnlocked({
          batchArrivedReady: !!toolsJourney.batchArrivedReady,
          primaryState: toolsJourney.primaryState,
          pausedFromState: toolsJourney.pausedFromState,
        })
      : false,
  };

  // Hub Status + Journey: one labeled SKU (active → attention → first live).
  const orientationSkuId = resolveHubOrientationSkuId(
    skuChips.map((s) => ({
      id: s.id,
      attentionCount: s.attention.length,
    })),
    workspace.activeSkuId,
  );
  const orientationSku = orientationSkuId
    ? live.find((s) => s.id === orientationSkuId)
    : null;
  const orientationChip = orientationSkuId
    ? skuChips.find((s) => s.id === orientationSkuId)
    : null;
  const hubNextDeep = orientationChip
    ? pickHubNextDeepLink(orientationChip.attention)
    : null;
  const hubNext =
    hubNextDeep && orientationChip
      ? {
          label: hubNextDeep.label,
          skuName: orientationChip.name,
        }
      : null;
  const orientationJourney = orientationSkuId
    ? (journeyBySkuId.get(orientationSkuId) ?? null)
    : null;
  const orientationPrimary = orientationJourney
    ? effectiveJourneyState({
        primaryState: orientationJourney.primaryState,
        pausedFromState: orientationJourney.pausedFromState,
      })
    : "discovery";
  const statusView =
    orientationSku && orientationJourney
      ? await getDashboardStatus({
          workspaceId: workspace.id,
          skuId: orientationSku.id,
          skuName: orientationSku.name,
          locale: locale as AppLocale,
          primaryState: orientationPrimary,
          productAccepted: true,
          sampleStatus: orientationJourney.sampleStatus,
          batchOrdered: orientationJourney.batchOrdered,
          batchArrivedReady: orientationJourney.batchArrivedReady,
          sideMarketingStage: orientationJourney.marketingStage,
          batchArrivalEtaJson: orientationJourney.batchArrivalEta,
          reorderPathSupplierId: orientationJourney.reorderPathSupplierId,
          reorderSupplierId: orientationJourney.reorderSupplierId,
        })
      : null;
  const journeyStep = primaryStateToJourneyStep(orientationPrimary);

  // Hub Finance chip: never promise open Finance before any SKU unlocked.
  const financeChipSkuId = financeUnlockedOnHub
    ? (live.find((s) => {
        const j = journeyBySkuId.get(s.id);
        return (
          !!j &&
          isSkuFinanceSectionUnlocked({
            batchArrivedReady: !!j.batchArrivedReady,
            primaryState: j.primaryState,
            pausedFromState: j.pausedFromState,
          })
        );
      })?.id ?? toolsTargetSkuId)
    : null;

  const financeHref = financeUnlockedOnHub
    ? financeChipSkuId
      ? `/sku/${financeChipSkuId}#finance`
      : "/finance"
    : "/finance";

  const financeLabel =
    financeView?.mode === "live" && financeUnlockedOnHub
      ? t("financeLive", { n: financeView.weekCount })
      : financeUnlockedOnHub
        ? t("financePreview")
        : t("financeLocked");

  // Single hub coaching surface: ShopHub shop tips (from getShopOrchestration).
  // Do not also mount OrchestratorPanel coachingOnly on the live hub.
  const coaching: string[] = [];
  if (orchestration?.coaching?.length && !isPaused) {
    for (const c of orchestration.coaching.slice(0, 4)) {
      coaching.push(shopT(`coaching.${c.id}` as never));
    }
  }

  const hubBody =
    live.length >= 1 && showHub ? (
      <div className="animate-rise space-y-5">
        <ShopHub
          shopPaused={shopPaused}
          storeReadyPercent={side.storeReadyPercent}
          financeHref={financeHref}
          financeLabel={financeLabel}
          financeUnlocked={financeUnlockedOnHub}
          toolsTargetSkuId={toolsTargetSkuId!}
          toolsUnlocked={toolsUnlocked}
          hubNext={hubNext}
          coaching={coaching}
          skus={skuChips}
          archived={archived.map((a) => ({ id: a.id, name: a.name }))}
          addSku={{
            ok: addSkuEval?.ok ?? false,
            error: addSkuEval && !addSkuEval.ok ? addSkuEval.error : undefined,
            warning:
              addSkuEval && addSkuEval.ok ? addSkuEval.warning : undefined,
            seriousnessWarning: addSkuEval?.seriousnessWarning ?? false,
          }}
        >
          {statusView ? <SupplierStatusBlock view={statusView} /> : null}
          {statusView ? <MarketingStatusBlock view={statusView} /> : null}
          {orientationSku ? (
            <JourneyStrip
              current={journeyStep}
              skuName={orientationSku.name}
            />
          ) : null}
        </ShopHub>
        {showAddDiscovery && addSkuDiscovery && (
          <div id="discovery" className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-sea/30 bg-sea/5 px-4 py-3">
              <p className="text-sm font-medium text-ink">
                {shopT("addSkuDiscoveryBanner")}
              </p>
              <Link
                href="/dashboard?hub=1"
                className="shrink-0 text-sm font-medium text-sea underline-offset-2 hover:underline"
              >
                {shopT("addSkuDiscoveryCancel")}
              </Link>
            </div>
            <DiscoveryBoard view={addSkuDiscovery} mode="addSku" />
          </div>
        )}
      </div>
    ) : (
      <div className="animate-rise space-y-5">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-stone-dark">
            {shopT("kicker")}
          </p>
          <h1 className="font-display text-2xl text-ink">{shopT("title")}</h1>
          <p className="mt-1 max-w-xl text-sm text-stone-dark">
            {shopT("introEmpty")}
          </p>
        </div>

        {inDiscovery ? (
          discovery ? (
            <div id="discovery">
              <DiscoveryBoard view={discovery}>
                {/* Nest Coaching under the board so the Compare tray spacer
                    clears it (avoid a bare sibling under the fixed tray). */}
                {orchestration && !isPaused ? (
                  <OrchestratorPanel view={orchestration} coachingOnly />
                ) : null}
              </DiscoveryBoard>
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
        ) : (
          <div className="surface-card p-5">
            <h2 className="font-display text-lg text-ink">{t("nextCta")}</h2>
            <p className="mt-2 text-sm text-stone-dark">
              {t("nextCtaPlaceholder")}
            </p>
            <Link
              href="/dashboard#discovery"
              className="mt-3 inline-flex text-sm font-medium text-sea underline-offset-2 hover:underline"
            >
              {t("ctaStartDiscovery")}
            </Link>
          </div>
        )}

        {/* Empty shop Coaching when DiscoveryBoard is not mounting it. */}
        {orchestration && !isPaused && !(inDiscovery && discovery) ? (
          <OrchestratorPanel view={orchestration} coachingOnly />
        ) : null}
      </div>
    );

  return (
    <div className="min-h-screen">
      <AppHeader
        isPaused={isPaused}
        highlightPhase={resolveHubVocabHighlightPhase(
          live.map((s) => {
            const j = journeyBySkuId.get(s.id);
            return {
              id: s.id,
              primaryState: j?.primaryState ?? "discovery",
              pausedFromState: j?.pausedFromState,
            };
          }),
          workspace.activeSkuId,
        )}
      />

      <main id="top" className="app-shell py-8">
        {hubBody}
      </main>
    </div>
  );
}
