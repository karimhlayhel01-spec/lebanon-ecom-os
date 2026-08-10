"use client";

import {
  useEffect,
  useId,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import { createPortal } from "react-dom";
import { useLocale, useTranslations } from "next-intl";
import {
  assessSupplierListingAction,
  decideSampleAction,
  markBatchArrivedAction,
  markReorderArrivedAction,
  markSampleReceivedAction,
  orderBatchAction,
  orderNextBatchAction,
  refreshImportLeadsAction,
  refreshLocalLeadsAction,
  reportSupplierCantFulfillAction,
  requestSampleAction,
  saveCostQuotesAction,
  setBatchArrivalEtaAction,
  setReorderArrivalEtaAction,
  switchReorderBackupAction,
} from "@/actions/supplier";
import { UnitsLeftGlanceBlock } from "@/components/shop/UnitsLeftGlance";
import { SupplierDisplayNameEditor } from "@/components/supplier/SupplierDisplayNameEditor";
import { SupplierContactsEditor } from "@/components/supplier/SupplierContactsEditor";
import {
  suppressSkuAutoScroll,
  suppressSkuAutoScrollAfterBatchAction,
  consumeBatchArrivalEtaDeepLinkOnce,
  markBatchArrivalEtaDeepLinkConsumed,
  skuFocusLocationKey,
} from "@/lib/sku/suppress-auto-scroll";
import {
  buildGmailComposeUrl,
  supplierEmailSubject,
} from "@/lib/supplier/email/gmail-compose";
import { buildWhatsAppChatUrl } from "@/lib/supplier/contacts";
import { canAssessListingUrl } from "@/lib/supplier/diligence/listing-url";
import type {
  AssessListingSuccess,
  DiligenceRecommendation,
} from "@/lib/supplier/diligence/types";
import { CANT_FULFILL_REASONS } from "@/lib/supplier/reorder-escape";
import {
  MAX_SPARE_SAMPLES_IN_FLIGHT,
  resolveSupplierCardSampleMode,
  supplierCardSampleCta,
  listWarmSparesForSwitch,
  type SupplierCardSampleCta,
} from "@/lib/supplier/sample-flight";
import { MARGIN_BEFORE_ADS_MIN, CLEARANCE_PARTNER_TBD } from "@/lib/constants";
import { computeMargin } from "@/lib/skills/margin";
import type { EtaPreset } from "@/lib/supplier/batch-eta";
import {
  DEFAULT_SUPPLIER_TAB,
  filterGroupsByTab,
  type SupplierTabFilter,
} from "@/lib/supplier/source";
import {
  resolveCostQuotesDisplayMode,
  toMarginInput,
  type CostQuoteInput,
} from "@/lib/supplier/quotes";
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

const subscribeNoop = () => () => {};
const getMountedClient = () => true;
const getMountedServer = () => false;

function platformLabel(platform: string | null): string {
  if (platform === "aliexpress") return "AliExpress";
  if (platform === "alibaba") return "Alibaba";
  if (platform === "local_web") return "Local web";
  return "Web";
}

/** Flat id → SupplierView for path + spare contact/rename wiring. */
function indexSuppliersById(view: SupplierPanelView): Map<string, SupplierView> {
  const map = new Map<string, SupplierView>();
  for (const g of view.groups) {
    if (g.primary) map.set(g.primary.id, g.primary);
    for (const b of g.backups) map.set(b.id, b);
  }
  return map;
}

function recommendationBadgeClass(tier: DiligenceRecommendation): string {
  if (tier === "worth_sampling") return "bg-cedar/10 text-cedar-deep";
  if (tier === "caution") return "bg-amber-50 text-amber-900";
  return "bg-sand text-stone-dark";
}

function recommendationLabelKey(
  tier: DiligenceRecommendation,
): "assessRecWorthSampling" | "assessRecCaution" | "assessRecSkip" {
  if (tier === "worth_sampling") return "assessRecWorthSampling";
  if (tier === "caution") return "assessRecCaution";
  return "assessRecSkip";
}

/** Which supplier job is the visual boss for this panel (layout only). */
type SupplierBoss =
  | "sample"
  | "costs_batch"
  | "batch_transit"
  | "reorder_idle"
  | "reorder_transit"
  | "quiet";

function resolveSupplierBoss(view: SupplierPanelView): SupplierBoss {
  // Path or warm-spare sample in flight always owns the panel.
  const inFlight = view.samples.some(
    (s) => s.status === "requested" || s.status === "received",
  );
  if (inFlight) return "sample";

  if (view.reorder.available && view.reorder.status === "ordered") {
    return "reorder_transit";
  }
  if (view.reorder.available && view.reorder.status === "idle") {
    return "reorder_idle";
  }
  if (view.batchOrdered && !view.batchArrivedReady) {
    return "batch_transit";
  }
  if (view.sampleApproved && !view.batchOrdered) {
    return "costs_batch";
  }
  if (!view.sampleApproved) {
    return "sample";
  }
  return "quiet";
}

function supplierBlockClass(
  boss: SupplierBoss,
  roles: readonly SupplierBoss[],
): string {
  if (boss === "quiet") return "supplier-block-secondary";
  return roles.includes(boss)
    ? "supplier-block-primary"
    : "supplier-block-secondary";
}

function RefreshImportLeadsControl({ skuId }: { skuId: string }) {
  const t = useTranslations("Supplier");
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function run() {
    setMessage(null);
    setError(null);
    startTransition(async () => {
      const res = await refreshImportLeadsAction(skuId);
      if (!res.ok) {
        if (res.error === "sample_in_flight") {
          setError(t("refreshImportSampleInFlight"));
          return;
        }
        if (res.error === "needs_confirm") {
          const ok = window.confirm(t("refreshImportConfirm"));
          if (!ok) {
            setError(t("refreshImportNeedsConfirm"));
            return;
          }
          const confirmed = await refreshImportLeadsAction(skuId, {
            confirmResetProgress: true,
          });
          if (!confirmed.ok) {
            setError(
              confirmed.error === "sample_in_flight"
                ? t("refreshImportSampleInFlight")
                : t("refreshImportFailed"),
            );
            return;
          }
          applySuccess(confirmed);
          return;
        }
        const key =
          res.error === "live_disabled"
            ? "refreshImportLiveDisabled"
            : res.error === "missing_key"
              ? "refreshImportMissingKey"
              : res.error === "quota"
                ? "refreshImportQuota"
                : "refreshImportFailed";
        setError(t(key));
        return;
      }
      applySuccess(res);
    });

    function applySuccess(res: {
      liveCount: number;
      heuristicCount: number;
      fallback: "none" | "partial" | "heuristic" | "empty";
    }) {
      if (res.fallback === "empty" || res.liveCount === 0) {
        setMessage(t("refreshImportEmpty"));
      } else if (res.fallback === "partial") {
        setMessage(
          t("refreshImportPartial", {
            live: res.liveCount,
            estimate: res.heuristicCount,
          }),
        );
      } else {
        setMessage(t("refreshImportLive", { live: res.liveCount }));
      }
    }
  }

  return (
    <div className="rounded-md border border-stone bg-sand/40 px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-stone-dark">{t("refreshImportHint")}</p>
        <button
          type="button"
          disabled={pending}
          onClick={() => run()}
          className="shrink-0 rounded-md border border-stone bg-surface px-3 py-1.5 text-xs font-semibold text-ink transition hover:bg-sand disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? t("refreshImportPending") : t("refreshImportButton")}
        </button>
      </div>
      {message ? (
        <p className="mt-1.5 text-xs text-ink" role="status">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="mt-1.5 text-xs text-amber-800" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function RefreshLocalLeadsControl({ skuId }: { skuId: string }) {
  const t = useTranslations("Supplier");
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function run() {
    setMessage(null);
    setError(null);
    startTransition(async () => {
      const res = await refreshLocalLeadsAction(skuId);
      if (!res.ok) {
        if (res.error === "sample_in_flight") {
          setError(t("refreshLocalSampleInFlight"));
          return;
        }
        if (res.error === "needs_confirm") {
          const ok = window.confirm(t("refreshLocalConfirm"));
          if (!ok) {
            setError(t("refreshLocalNeedsConfirm"));
            return;
          }
          const confirmed = await refreshLocalLeadsAction(skuId, {
            confirmResetProgress: true,
          });
          if (!confirmed.ok) {
            setError(
              confirmed.error === "sample_in_flight"
                ? t("refreshLocalSampleInFlight")
                : t("refreshLocalFailed"),
            );
            return;
          }
          applySuccess(confirmed);
          return;
        }
        const key =
          res.error === "live_disabled"
            ? "refreshLocalLiveDisabled"
            : res.error === "missing_key"
              ? "refreshLocalMissingKey"
              : res.error === "quota"
                ? "refreshLocalQuota"
                : "refreshLocalFailed";
        setError(t(key));
        return;
      }
      applySuccess(res);
    });

    function applySuccess(res: {
      liveCount: number;
      fallback: "none" | "partial" | "empty";
      emptyReason?: "no_local_leads";
    }) {
      if (res.fallback === "empty" || res.liveCount === 0) {
        setMessage(t("refreshLocalEmpty"));
      } else if (res.fallback === "partial") {
        setMessage(t("refreshLocalPartial", { live: res.liveCount }));
      } else {
        setMessage(t("refreshLocalLive", { live: res.liveCount }));
      }
    }
  }

  return (
    <div className="rounded-md border border-stone bg-sand/40 px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-stone-dark">{t("refreshLocalHint")}</p>
        <button
          type="button"
          disabled={pending}
          onClick={() => run()}
          className="shrink-0 rounded-md border border-stone bg-surface px-3 py-1.5 text-xs font-semibold text-ink transition hover:bg-sand disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? t("refreshLocalPending") : t("refreshLocalButton")}
        </button>
      </div>
      {message ? (
        <p className="mt-1.5 text-xs text-ink" role="status">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="mt-1.5 text-xs text-amber-800" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function LocalEmptyBanner() {
  const t = useTranslations("Supplier");
  return (
    <div
      className="rounded-md border border-stone bg-surface-subtle px-3 py-3"
      role="status"
    >
      <p className="text-sm font-medium text-ink">{t("localEmptyTitle")}</p>
      <p className="mt-1 text-xs leading-snug text-stone-dark">
        {t("localEmptyBody")}
      </p>
    </div>
  );
}

function ImportEmptyBanner() {
  const t = useTranslations("Supplier");
  return (
    <div
      className="rounded-md border border-stone bg-surface-subtle px-3 py-3"
      role="status"
    >
      <p className="text-sm font-medium text-ink">{t("importEmptyTitle")}</p>
      <p className="mt-1 text-xs leading-snug text-stone-dark">
        {t("importEmptyBody")}
      </p>
    </div>
  );
}

/** Compact note for Both tab when Import shows but Local has no seats. */
function BothTabNoLocalNote() {
  const t = useTranslations("Supplier");
  return (
    <p className="text-[11px] leading-snug text-stone-dark" role="status">
      {t("bothTabNoLocalNote")}
    </p>
  );
}

function SourceBadge({ source }: { source: "import" | "local" }) {
  const t = useTranslations("Supplier");
  return (
    <span
      className={`rounded px-1.5 py-0.5 font-medium ${
        source === "local"
          ? "bg-sea/10 text-sea"
          : "bg-sand text-stone-dark"
      }`}
    >
      {source === "local" ? t("sourceLocal") : t("sourceImport")}
    </span>
  );
}

export function SupplierPanel({ view }: { view: SupplierPanelView }) {
  const t = useTranslations("Supplier");
  const [tab, setTab] = useState<SupplierTabFilter>(DEFAULT_SUPPLIER_TAB);
  /** Read-only browse when the interactive shortlist is hidden (sample freeze / post-accept). */
  const [browseShortlist, setBrowseShortlist] = useState(false);

  const allSuppliers = view.groups.flatMap((g) =>
    [g.primary, ...g.backups].filter(Boolean),
  ) as SupplierView[];
  const suppliersById = indexSuppliersById(view);

  const showShortlist = view.showShortlist;
  const effectiveTab = view.sourceTabsFrozen ? "both" : tab;
  const visibleGroups = filterGroupsByTab(view.groups, effectiveTab);
  const anySampleInFlight = view.samples.length > 0;
  const inFlightSupplierIds = new Set(view.samples.map((s) => s.supplierId));
  const spareCapReached =
    view.sampleApproved &&
    view.spareInFlightCount >= MAX_SPARE_SAMPLES_IN_FLIGHT;

  const pathSupplierId =
    view.reorder.supplierId ?? view.approvedSampleSupplierId;
  const pathSource =
    view.reorder.supplierSource ?? view.approvedSampleSupplierSource;
  const warmSupplierIds = new Set(
    view.reorder.backups.filter((b) => b.warm).map((b) => b.id),
  );
  // Locked path for Mode B exclusion even when can’t-fulfill cleared active path.
  const lockedPathId = view.approvedSampleSupplierId ?? pathSupplierId;
  const cardMode = resolveSupplierCardSampleMode({
    sampleApproved: view.sampleApproved,
    showShortlist,
  });
  // Mode A: global blank while any in flight. Mode B: per-supplier only.
  const sampleInFlightForCards =
    cardMode === "first_sample" && anySampleInFlight;

  const chosenSupplier = pathSupplierId
    ? allSuppliers.find((s) => s.id === pathSupplierId) ?? null
    : view.sample
      ? allSuppliers.find((s) => s.id === view.sample!.supplierId) ?? null
      : null;

  const isLocalPath =
    (view.approvedSampleSupplierSource ??
      view.sample?.supplierSource ??
      view.costQuotes.quoteSource) === "local";

  /** Clearance footer mode — tab-aware while browsing; sample path wins after. */
  type ClearanceFooterMode = "local" | "import" | "both";
  const clearanceFooterMode: ClearanceFooterMode = (() => {
    if (isLocalPath) return "local";
    if (showShortlist || browseShortlist) {
      if (effectiveTab === "local") return "local";
      if (effectiveTab === "both") return "both";
      return "import";
    }
    return "import";
  })();

  function viewFullShortlist() {
    if (showShortlist) {
      document
        .getElementById("supplier-shortlist")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    setBrowseShortlist(true);
    // Scroll after paint so the read-only section exists.
    requestAnimationFrame(() => {
      document
        .getElementById("supplier-shortlist")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function afterPathSwitchQuotes() {
    setBrowseShortlist(false);
    requestAnimationFrame(() => {
      document
        .getElementById("cost-quotes")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  const boss = resolveSupplierBoss(view);
  const quotesPreferCollapsed =
    boss === "batch_transit" ||
    boss === "reorder_idle" ||
    boss === "reorder_transit" ||
    boss === "quiet" ||
    boss === "sample";

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

      {!view.sampleApproved && (
        <div className="mt-3 rounded-md border border-sea/30 bg-sea/5 px-3 py-2 text-xs text-sea">
          {t("sampleFirstBanner")}
        </div>
      )}

      {/* Sample trackers — all in-flight (no auto-scroll; hub Next scrolls section). */}
      {view.samples.length > 0 && (
        <div className={supplierBlockClass(boss, ["sample"])}>
          {view.samples.map((s) => (
            <SampleTracker
              key={s.id}
              sample={s}
              skuId={view.skuId}
              skuName={view.skuName}
              supplier={suppliersById.get(s.supplierId) ?? null}
            />
          ))}
        </div>
      )}

      {/* Full shortlist — Mode A first-pick, or Mode B insurance browse.
          Insurance browse stays full opacity so Request spare CTAs aren’t washed out
          when next-batch is stage boss (U3 secondary fade). */}
      <div
        className={
          browseShortlist && cardMode === "insurance"
            ? undefined
            : supplierBlockClass(boss, ["sample"])
        }
      >
        {showShortlist ? (
          <SupplierShortlistSection
            view={view}
            visibleGroups={visibleGroups}
            effectiveTab={effectiveTab}
            tab={tab}
            setTab={setTab}
            cardMode={cardMode}
            sampleInFlight={sampleInFlightForCards}
            inFlightSupplierIds={inFlightSupplierIds}
            spareCapReached={spareCapReached}
            pathSupplierId={lockedPathId}
            pathSource={pathSource}
            warmSupplierIds={warmSupplierIds}
            browseBanner={false}
          />
        ) : browseShortlist ? (
          <SupplierShortlistSection
            view={view}
            visibleGroups={visibleGroups}
            effectiveTab={effectiveTab}
            tab={tab}
            setTab={setTab}
            cardMode={cardMode}
            sampleInFlight={sampleInFlightForCards}
            inFlightSupplierIds={inFlightSupplierIds}
            spareCapReached={spareCapReached}
            pathSupplierId={lockedPathId}
            pathSource={pathSource}
            warmSupplierIds={warmSupplierIds}
            browseBanner
            onHide={() => setBrowseShortlist(false)}
          />
        ) : (
          chosenSupplier && (
            <ChosenSupplierSummary
              s={chosenSupplier}
              skuId={view.skuId}
              skuName={view.skuName}
              selling={view.batchArrivedReady}
              onViewShortlist={viewFullShortlist}
              insuranceAvailable={view.reorder.insuranceAvailable}
              warmedSpares={view.reorder.backups
                .filter((b) => b.warm)
                .map((b) => suppliersById.get(b.id))
                .filter((x): x is SupplierView => !!x)}
            />
          )
        )}
      </div>

      <div className={supplierBlockClass(boss, ["costs_batch"])}>
        <CostQuotesBlock
          key={`${pathSupplierId ?? "none"}-${view.costQuotes.saved}-${view.costQuotes.needsRefresh}`}
          costQuotes={view.costQuotes}
          skuId={view.skuId}
          browseShortlist={browseShortlist}
          preferCollapsed={quotesPreferCollapsed}
        />
      </div>

      {/* Batch order (parallel with store setup; never needs store readiness) */}
      {view.sampleApproved && !view.batchOrdered && (
        <div className={supplierBlockClass(boss, ["costs_batch"])}>
          <BatchOrder view={view} />
        </div>
      )}

      {/* ETA: show whenever Marketing can use it (sample approved or batch
          ordered) until arrived — keeps “Set ETA on Supplier” CTA live. */}
      {view.sampleApproved && !view.batchArrivedReady && (
        <div
          className={supplierBlockClass(boss, ["batch_transit", "costs_batch"])}
        >
          <BatchArrivalEtaBlock eta={view.batchArrivalEta} skuId={view.skuId} />
        </div>
      )}

      {view.batchOrdered && !view.batchArrivedReady && (
        <div className={supplierBlockClass(boss, ["batch_transit"])}>
          <BatchArrived skuId={view.skuId} />
        </div>
      )}

      {view.batchArrivedReady && !view.reorder.available && (
        <div className="mt-4 rounded-md border border-cedar/30 bg-cedar/10 px-3 py-2 text-sm font-medium text-cedar-deep">
          {t("batchArrivedDone")}
        </div>
      )}

      {view.reorder.available && view.reorder.status === "idle" && (
        <div className={supplierBlockClass(boss, ["reorder_idle"])}>
          <NextBatchOrder
            view={view}
            onViewShortlist={viewFullShortlist}
            onPathSwitched={afterPathSwitchQuotes}
            quietSideFlows
          />
        </div>
      )}

      {view.reorder.insuranceAvailable && !view.reorder.available && (
        <WarmBackupBlock
          view={view}
          onOpenSpareCards={viewFullShortlist}
        />
      )}

      {view.reorder.available && view.reorder.status === "ordered" && (
        <div className={supplierBlockClass(boss, ["reorder_transit"])}>
          <ReorderInTransit
            view={view}
            onViewShortlist={viewFullShortlist}
            onPathSwitched={afterPathSwitchQuotes}
          />
          <ReorderArrivalEtaBlock
            eta={view.reorder.arrivalEta}
            skuId={view.skuId}
          />
        </div>
      )}

      {clearanceFooterMode === "local" ? (
        <>
          <p className="mt-4 text-xs text-stone-dark">
            {t("clearanceLocalSoft")}
          </p>
          <p className="mt-1.5 text-xs text-stone-dark/80">
            {t("clearanceLocalVsDeliveryNote")}
          </p>
        </>
      ) : clearanceFooterMode === "both" ? (
        <p className="mt-4 text-xs text-stone-dark">
          {t("clearanceBothNote")}
        </p>
      ) : (
        <>
          <p className="mt-4 text-xs text-stone-dark">
            {t("clearance")}:{" "}
            <span className="font-medium">
              {view.clearancePartner === CLEARANCE_PARTNER_TBD
                ? t("clearancePartnerPlaceholder")
                : view.clearancePartner}
            </span>
          </p>
          <p className="mt-1.5 text-xs text-stone-dark/80">
            {t("clearanceVsDeliveryNote")}
          </p>
        </>
      )}
    </div>
  );
}

function SupplierShortlistSection({
  view,
  visibleGroups,
  effectiveTab,
  setTab,
  cardMode,
  sampleInFlight,
  inFlightSupplierIds,
  spareCapReached,
  pathSupplierId,
  pathSource,
  warmSupplierIds,
  browseBanner,
  onHide,
}: {
  view: SupplierPanelView;
  visibleGroups: Array<{
    source: "import" | "local";
    rank: number;
    primary: SupplierView | null;
    backups: SupplierView[];
  }>;
  effectiveTab: SupplierTabFilter;
  tab: SupplierTabFilter;
  setTab: (t: SupplierTabFilter) => void;
  cardMode: ReturnType<typeof resolveSupplierCardSampleMode>;
  /** Mode A global blank only. */
  sampleInFlight: boolean;
  inFlightSupplierIds: ReadonlySet<string>;
  spareCapReached: boolean;
  pathSupplierId: string | null;
  pathSource: "import" | "local" | null;
  warmSupplierIds: ReadonlySet<string>;
  browseBanner: boolean;
  onHide?: () => void;
}) {
  const t = useTranslations("Supplier");
  const tabsLocked =
    view.sourceTabsFrozen || (browseBanner && sampleInFlight);
  const unavailable = view.reorder.unavailable;
  const hasLocalGroups = view.groups.some((g) => g.source === "local");
  const hasImportGroups = view.groups.some((g) => g.source === "import");

  function ctaFor(s: SupplierView): SupplierCardSampleCta {
    return supplierCardSampleCta({
      mode: cardMode,
      sampleInFlight,
      supplierSampleInFlight: inFlightSupplierIds.has(s.id),
      spareCapReached,
      supplierId: s.id,
      role: s.role,
      pathSupplierId,
      sameSourceAsPath: !pathSource || s.source === pathSource,
      alreadyWarm:
        warmSupplierIds.has(s.id) ||
        view.approvedSupplierIds.includes(s.id),
      unavailable: !!unavailable[s.id],
    });
  }

  return (
    <div id="supplier-shortlist" className="mt-4 space-y-4">
      {browseBanner && (
        <div className="rounded-md border border-sea/30 bg-sea/5 px-3 py-2 text-xs text-sea">
          <p className="font-medium text-ink">{t("shortlistBrowseTitle")}</p>
          <p className="mt-1 text-stone-dark">
            {sampleInFlight
              ? t("shortlistBrowseFreezeNote")
              : cardMode === "insurance"
                ? t("shortlistBrowseInsuranceNote")
                : t("shortlistBrowseReadonlyNote")}
          </p>
          <p className="mt-1 text-[11px] text-stone-dark">
            {t("shortlistBrowseScopeNote")}
          </p>
          {onHide && (
            <button
              type="button"
              onClick={onHide}
              className="mt-2 text-[11px] font-semibold text-sea underline-offset-2 hover:underline"
            >
              {t("shortlistBrowseHide")}
            </button>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            ["both", "tabBoth"],
            ["import", "tabImport"],
            ["local", "tabLocal"],
          ] as const
        ).map(([id, labelKey]) => (
          <button
            key={id}
            type="button"
            disabled={tabsLocked}
            onClick={() => setTab(id)}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
              effectiveTab === id
                ? "bg-cedar text-foam"
                : "border border-stone bg-surface text-ink hover:bg-sand"
            } disabled:cursor-not-allowed disabled:opacity-60`}
          >
            {t(labelKey)}
          </button>
        ))}
        {tabsLocked && (
          <span className="text-[11px] text-stone-dark">
            {view.sourceTabsFrozen || sampleInFlight
              ? t("tabsFrozenNote")
              : t("shortlistBrowseTabsLocked")}
          </span>
        )}
      </div>

      {effectiveTab === "import" ? (
        <>
          <RefreshImportLeadsControl skuId={view.skuId} />
          {!hasImportGroups ? <ImportEmptyBanner /> : null}
        </>
      ) : null}

      {effectiveTab === "local" ? (
        <>
          <RefreshLocalLeadsControl skuId={view.skuId} />
          {visibleGroups.length === 0 ? <LocalEmptyBanner /> : null}
        </>
      ) : null}

      {effectiveTab === "both" && (
        <p className="text-[11px] text-stone-dark">{t("bothTabDensityNote")}</p>
      )}

      {effectiveTab === "both" && !hasLocalGroups ? (
        <BothTabNoLocalNote />
      ) : null}

      {effectiveTab === "both" && !hasImportGroups ? (
        <ImportEmptyBanner />
      ) : null}

      {visibleGroups.map((g) => (
        <div key={`${g.source}-${g.rank}`}>
          <h3 className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide text-stone-dark">
            <SourceBadge source={g.source} />
            <span>
              {t("group", { n: g.rank + 1 })} —{" "}
              {g.source === "local" ? t("poolLocal") : t("poolImport")}
            </span>
          </h3>
          <div className="mt-2 grid items-start gap-3 md:grid-cols-3">
            {g.primary && (
              <SupplierCard
                s={g.primary}
                sampleCta={ctaFor(g.primary)}
                softLimit={view.softLimitUsd}
                skuName={view.skuName}
              />
            )}
            {g.backups.map((b) => (
              <SupplierCard
                key={b.id}
                s={b}
                sampleCta={ctaFor(b)}
                softLimit={view.softLimitUsd}
                skuName={view.skuName}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function SupplierCard({
  s,
  sampleCta,
  softLimit,
  skuName,
}: {
  s: SupplierView;
  sampleCta: SupplierCardSampleCta;
  softLimit: number;
  skuName: string;
}) {
  const t = useTranslations("Supplier");
  const locale = useLocale();
  const [pending, startTransition] = useTransition();
  const [assessPending, startAssess] = useTransition();
  const [showEmail, setShowEmail] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [assessOpen, setAssessOpen] = useState(false);
  const [assessLoading, setAssessLoading] = useState(false);
  const [assessError, setAssessError] = useState<string | null>(null);
  const [assessResult, setAssessResult] = useState<AssessListingSuccess | null>(
    null,
  );

  // softLimit kept for API parity with parent; invent batch soft-limit not shown on card
  void softLimit;

  const ctaLabel =
    sampleCta.kind === "request_backup_sample"
      ? t("requestBackupSample")
      : t("requestSample");
  const ctaHint =
    sampleCta.kind === "request_backup_sample"
      ? t("requestBackupSampleHint")
      : t("requestSampleHint");

  const canAssess = canAssessListingUrl(s.sourceUrl);

  function openAssess() {
    if (!canAssess) return;
    setAssessOpen(true);
    setAssessError(null);
    setAssessResult(null);
    setAssessLoading(true);
    startAssess(async () => {
      const res = await assessSupplierListingAction(
        s.id,
        locale === "ar" ? "ar" : "en",
      );
      setAssessLoading(false);
      if (!res.ok) {
        const key =
          res.error === "missing_key"
            ? "assessMissingKey"
            : res.error === "missing_scrape_key"
              ? "assessMissingScrapeKey"
              : res.error === "scrape_failed"
                ? "assessScrapeFailed"
                : res.error === "quota"
                  ? "assessQuota"
                  : res.error === "no_url"
                    ? "assessNoUrl"
                    : "assessFailed";
        setAssessError(key);
        return;
      }
      setAssessResult(res);
    });
  }

  return (
    <article className="flex flex-col gap-2 rounded-lg border border-stone bg-surface-subtle p-3">
      <div className="min-w-0">
        <h4 className="text-sm font-semibold text-ink">{s.name}</h4>
        {s.leadSource === "live_search" &&
        s.externalTitle &&
        s.externalTitle.trim() !== s.name.trim() ? (
          <p
            className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-stone-dark/80"
            title={s.externalTitle}
          >
            {t("listingTitleHint", { title: s.externalTitle })}
          </p>
        ) : null}
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-stone-dark">
          <SourceBadge source={s.source} />
          {s.leadSource === "live_search" ? (
            <span className="rounded bg-sea/10 px-1.5 py-0.5 font-medium text-sea">
              {t("liveLeadBadge")}
            </span>
          ) : (
            <span className="rounded bg-sand px-1.5 py-0.5 font-medium text-stone-dark">
              {t("estimateLeadBadge")}
            </span>
          )}
        </div>
      </div>

      {s.sourceUrl ? (
        <a
          href={s.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex w-full items-center justify-center rounded-md border border-sea/40 bg-sea/5 px-3 py-2 text-center text-xs font-semibold text-sea transition hover:bg-sea/10"
        >
          {t("openListing", { platform: platformLabel(s.platform) })}
        </a>
      ) : null}

      <button
        type="button"
        disabled={!canAssess || assessPending}
        title={!canAssess ? t("assessNoUrl") : undefined}
        onClick={openAssess}
        className="inline-flex w-full items-center justify-center rounded-md bg-cedar px-3 py-2 text-center text-xs font-semibold text-foam transition hover:bg-cedar-deep disabled:cursor-not-allowed disabled:opacity-50"
      >
        {assessPending ? t("assessListingPending") : t("assessListing")}
      </button>
      {!canAssess ? (
        <p className="text-[10px] leading-snug text-stone-dark">
          {t("assessNoUrlHint")}
        </p>
      ) : null}

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
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(s.negotiationDraft);
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 2000);
                  } catch {
                    setCopied(false);
                  }
                }}
                className="rounded-md border border-stone px-2.5 py-1 text-[11px] font-medium text-ink transition hover:bg-sand"
              >
                {copied ? t("emailCopied") : t("copyEmailDraft")}
              </button>
              <a
                href={buildGmailComposeUrl({
                  subject: supplierEmailSubject(
                    skuName || s.name,
                    locale === "ar" ? "ar" : "en",
                  ),
                  body: s.negotiationDraft,
                })}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-md border border-sea/40 bg-sea/5 px-2.5 py-1 text-[11px] font-medium text-sea transition hover:bg-sea/10"
              >
                {t("openInGmail")}
              </a>
            </div>
          </>
        )}

        {sampleCta.kind !== "none" && (
          <div className="flex flex-col items-start gap-1">
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  setRequestError(null);
                  const res = await requestSampleAction(s.id);
                  if (!res.ok) {
                    if (res.error === "spare_cap") {
                      setRequestError("spareCap");
                    } else if (res.error === "sample_in_flight") {
                      setRequestError("sampleInFlight");
                    } else {
                      setRequestError("generic");
                    }
                  }
                })
              }
              className="rounded-md border border-cedar/40 bg-surface px-3 py-1.5 text-xs font-semibold text-cedar-deep transition hover:bg-cedar/5 disabled:opacity-60"
            >
              {ctaLabel}
            </button>
            <p className="max-w-sm text-[11px] text-stone-dark">{ctaHint}</p>
            {requestError === "spareCap" && (
              <p className="text-[11px] text-amber-900">
                {t("spareSamplesAtCap", { max: MAX_SPARE_SAMPLES_IN_FLIGHT })}
              </p>
            )}
            {requestError === "sampleInFlight" && (
              <p className="text-[11px] text-amber-900">
                {t("warmBackupSampleInFlight")}
              </p>
            )}
            {requestError === "generic" && (
              <p className="text-[11px] text-amber-900">{t("errorGeneric")}</p>
            )}
          </div>
        )}
      </div>

      {assessOpen ? (
        <AssessListingModal
          loading={assessLoading}
          errorKey={assessError}
          result={assessResult}
          onClose={() => {
            setAssessOpen(false);
            setAssessError(null);
            setAssessResult(null);
            setAssessLoading(false);
          }}
        />
      ) : null}
    </article>
  );
}

function AssessListingModal({
  loading,
  errorKey,
  result,
  onClose,
}: {
  loading: boolean;
  errorKey: string | null;
  result: AssessListingSuccess | null;
  onClose: () => void;
}) {
  const t = useTranslations("Supplier");
  const titleId = useId();
  const mounted = useSyncExternalStore(
    subscribeNoop,
    getMountedClient,
    getMountedServer,
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  if (!mounted) return null;

  const chips: string[] = [];
  if (result) {
    const f = result.facts;
    if (f.yearsOnPlatform != null) {
      chips.push(t("assessChipYears", { n: f.yearsOnPlatform }));
    }
    for (const s of f.verifiedSignals) chips.push(s);
    if (f.rating != null) chips.push(t("assessChipRating", { n: f.rating }));
    for (const c of f.certifications.slice(0, 4)) chips.push(c);
    if (f.moqHint != null) chips.push(t("assessChipMoq", { n: f.moqHint }));
    if (f.unitPriceHint != null) {
      chips.push(t("assessChipPrice", { n: f.unitPriceHint.toFixed(2) }));
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[90]" role="presentation">
      <button
        type="button"
        aria-label={t("assessClose")}
        className="absolute inset-0 bg-ink/40"
        onClick={onClose}
      />
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className="pointer-events-auto max-h-[min(90vh,40rem)] w-full max-w-md overflow-y-auto rounded-lg border border-stone bg-surface p-5 shadow-sm"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-3">
            <h2
              id={titleId}
              className="font-display text-lg font-semibold text-ink"
            >
              {t("assessListingTitle")}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label={t("assessClose")}
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-ink transition hover:bg-sand"
            >
              <span aria-hidden className="text-xl leading-none">
                ×
              </span>
            </button>
          </div>

          <div className="mt-3 space-y-3">
            {loading && !result && !errorKey ? (
              <p className="text-sm text-stone-dark">{t("assessListingLoading")}</p>
            ) : null}
            {errorKey ? (
              <p className="text-sm leading-relaxed text-amber-800">
                {t(errorKey as never)}
              </p>
            ) : null}
            {result ? (
              <>
                <p
                  className={`inline-flex rounded-md px-2.5 py-1 text-xs font-semibold ${recommendationBadgeClass(result.recommendation)}`}
                >
                  {t(recommendationLabelKey(result.recommendation))}
                </p>
                <p className="text-xs leading-relaxed text-stone-dark">
                  {t(result.honestyKey)}
                </p>
                {result.summary ? (
                  <div className="space-y-2 text-sm leading-relaxed text-ink whitespace-pre-wrap">
                    {result.summary}
                  </div>
                ) : (
                  <p className="text-sm leading-relaxed text-stone-dark">
                    {t("assessNarrationFailed")}
                  </p>
                )}
                {chips.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {chips.map((c) => (
                      <span
                        key={c}
                        className="rounded bg-sand px-1.5 py-0.5 text-[10px] font-medium text-stone-dark"
                      >
                        {c}
                      </span>
                    ))}
                  </div>
                ) : null}
                <p className="text-[11px] leading-snug text-stone-dark">
                  {t("assessOpenListingNote", {
                    platform: platformLabel(result.facts.platform),
                  })}
                </p>
                <p className="text-[11px] leading-snug text-stone-dark">
                  {t("assessSampleNote")}
                </p>
              </>
            ) : null}
          </div>

          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-stone px-3 py-1.5 text-sm font-medium text-ink transition hover:bg-sand"
            >
              {t("assessClose")}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Contact door for any sampled supplier (path or spare) — Wave 3 Phase 3a. */
function SupplierContactModal({
  s,
  skuId,
  skuName,
  onClose,
}: {
  s: SupplierView;
  skuId: string;
  skuName: string;
  onClose: () => void;
}) {
  const t = useTranslations("Supplier");
  const locale = useLocale();
  const titleId = useId();
  const [copied, setCopied] = useState(false);
  const [contactEmail, setContactEmail] = useState(s.contactEmail);
  const [contactWhatsapp, setContactWhatsapp] = useState(s.contactWhatsapp);
  const mounted = useSyncExternalStore(
    subscribeNoop,
    getMountedClient,
    getMountedServer,
  );

  useEffect(() => {
    setContactEmail(s.contactEmail);
    setContactWhatsapp(s.contactWhatsapp);
  }, [s.contactEmail, s.contactWhatsapp]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  if (!mounted) return null;

  const whatsappUrl = buildWhatsAppChatUrl(contactWhatsapp);

  return createPortal(
    <div className="fixed inset-0 z-[90]" role="presentation">
      <button
        type="button"
        aria-label={t("contactClose")}
        className="absolute inset-0 bg-ink/40"
        onClick={onClose}
      />
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className="pointer-events-auto max-h-[min(90vh,40rem)] w-full max-w-md overflow-y-auto rounded-lg border border-stone bg-surface p-5 shadow-sm"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-3">
            <h2
              id={titleId}
              className="font-display text-lg font-semibold text-ink"
            >
              {t("contactSupplierTitle")}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label={t("contactClose")}
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-ink transition hover:bg-sand"
            >
              <span aria-hidden className="text-xl leading-none">
                ×
              </span>
            </button>
          </div>

          <p
            className="mt-2 text-sm font-semibold text-ink [unicode-bidi:plaintext]"
            title={s.name}
          >
            {s.name}
          </p>

          <SupplierContactsEditor
            supplierId={s.id}
            skuId={skuId}
            contactEmail={contactEmail}
            contactWhatsapp={contactWhatsapp}
            onSaved={(next) => {
              setContactEmail(next.contactEmail);
              setContactWhatsapp(next.contactWhatsapp);
            }}
          />

          <div className="mt-4 space-y-3">
            {s.sourceUrl ? (
              <a
                href={s.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex w-full items-center justify-center rounded-md border border-sea/40 bg-sea/5 px-3 py-2 text-center text-xs font-semibold text-sea transition hover:bg-sea/10"
              >
                {t("openListing", { platform: platformLabel(s.platform) })}
              </a>
            ) : null}

            <p className="text-[11px] leading-relaxed text-stone-dark">
              {t("emailDraftHint")}
            </p>
            <textarea
              readOnly
              value={s.negotiationDraft}
              rows={8}
              className="w-full rounded border border-stone bg-surface p-2 text-[11px] text-stone-dark"
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(s.negotiationDraft);
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 2000);
                  } catch {
                    setCopied(false);
                  }
                }}
                className="rounded-md border border-stone px-2.5 py-1 text-[11px] font-medium text-ink transition hover:bg-sand"
              >
                {copied ? t("emailCopied") : t("copyEmailDraft")}
              </button>
              <a
                href={buildGmailComposeUrl({
                  to: contactEmail ?? undefined,
                  subject: supplierEmailSubject(
                    skuName || s.name,
                    locale === "ar" ? "ar" : "en",
                  ),
                  body: s.negotiationDraft,
                })}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-md border border-sea/40 bg-sea/5 px-2.5 py-1 text-[11px] font-medium text-sea transition hover:bg-sea/10"
              >
                {t("openInGmail")}
              </a>
              {whatsappUrl ? (
                <a
                  href={whatsappUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-md border border-cedar/40 bg-cedar/5 px-2.5 py-1 text-[11px] font-medium text-cedar-deep transition hover:bg-cedar/10"
                >
                  {t("openInWhatsapp")}
                </a>
              ) : null}
            </div>
          </div>

          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-stone px-3 py-1.5 text-sm font-medium text-ink transition hover:bg-sand"
            >
              {t("contactClose")}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ChosenSupplierSummary({
  s,
  skuId,
  skuName,
  selling,
  onViewShortlist,
  insuranceAvailable,
  warmedSpares,
}: {
  s: SupplierView;
  skuId: string;
  skuName: string;
  selling: boolean;
  onViewShortlist?: () => void;
  /** Same gate as hub — omit spares line before insurance is available. */
  insuranceAvailable: boolean;
  /** Approved same-source non-path only (`warm === true`). */
  warmedSpares: SupplierView[];
}) {
  const t = useTranslations("Supplier");
  const [contactTarget, setContactTarget] = useState<SupplierView | null>(null);

  return (
    <div className="mt-4 rounded-lg border border-cedar/30 bg-surface-subtle p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-stone-dark">
            {selling ? t("workingSupplier") : t("chosenSupplier")}
          </p>
          <div className="mt-0.5">
            <SupplierDisplayNameEditor
              supplierId={s.id}
              skuId={skuId}
              name={s.name}
              nameClassName="text-sm font-semibold text-ink"
            />
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-stone-dark">
            <SourceBadge source={s.source} />
          </div>
        </div>
      </div>

      {s.sourceUrl ? (
        <p className="mt-2 text-[11px]">
          <a
            href={s.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-sea underline-offset-2 hover:underline"
          >
            {t("openListing", { platform: platformLabel(s.platform) })}
          </a>
        </p>
      ) : null}

      <button
        type="button"
        onClick={() => setContactTarget(s)}
        className="mt-3 inline-flex w-full items-center justify-center rounded-md bg-cedar px-3 py-2 text-center text-xs font-semibold text-foam transition hover:bg-cedar-deep sm:w-auto"
      >
        {t("contactSupplier")}
      </button>

      {insuranceAvailable && (
        <div className="mt-3 space-y-2">
          {warmedSpares.length > 0 ? (
            <>
              <p className="text-[11px] font-medium text-stone-dark">
                {t("warmedSparesHeading", { count: warmedSpares.length })}
              </p>
              <ul className="space-y-2">
                {warmedSpares.map((spare) => (
                  <li
                    key={spare.id}
                    className="rounded-md border border-stone/70 bg-surface px-2.5 py-2"
                  >
                    <div className="flex flex-col items-start gap-1.5">
                      <SupplierDisplayNameEditor
                        supplierId={spare.id}
                        skuId={skuId}
                        name={spare.name}
                        nameClassName="text-xs font-semibold text-ink"
                        compact
                      />
                      <button
                        type="button"
                        onClick={() => setContactTarget(spare)}
                        className="text-[11px] font-medium text-sea underline-offset-2 hover:underline"
                      >
                        {t("contactSupplier")}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-[11px] text-stone-dark">{t("warmedSparesNoneYet")}</p>
          )}
        </div>
      )}

      <p className="mt-3 text-[11px] text-stone-dark">
        {t("shortlistHiddenNote")}
      </p>
      {onViewShortlist && (
        <button
          type="button"
          onClick={onViewShortlist}
          className="mt-2 text-[11px] font-semibold text-sea underline-offset-2 hover:underline"
        >
          {t("viewFullShortlist")}
        </button>
      )}

      {contactTarget ? (
        <SupplierContactModal
          s={contactTarget}
          skuId={skuId}
          skuName={skuName}
          onClose={() => setContactTarget(null)}
        />
      ) : null}
    </div>
  );
}

function SampleTracker({
  sample,
  skuId,
  skuName,
  supplier,
}: {
  sample: SampleView;
  skuId: string;
  skuName: string;
  /** Full option row when present — enables Contact door (draft / listing). */
  supplier: SupplierView | null;
}) {
  const t = useTranslations("Supplier");
  const [pending, startTransition] = useTransition();
  const [contactOpen, setContactOpen] = useState(false);
  const [checklist, setChecklist] = useState<Record<string, boolean>>(
    sample.checklist,
  );
  const [photoNotes, setPhotoNotes] = useState(sample.photoNotes);
  const [contactEmail, setContactEmail] = useState(sample.contactEmail);
  const [contactWhatsapp, setContactWhatsapp] = useState(
    sample.contactWhatsapp,
  );

  useEffect(() => {
    setContactEmail(sample.contactEmail);
    setContactWhatsapp(sample.contactWhatsapp);
  }, [sample.contactEmail, sample.contactWhatsapp]);

  const isRequested = sample.status === "requested";
  const isReceived = sample.status === "received";
  // Status on this sample record only — journey-level sampleApproved must not
  // paint a newly requested Path B sample as already approved.
  const isApproved = sample.status === "approved";
  const trackerId = `sample-tracker-${sample.id}`;

  return (
    <div
      id={trackerId}
      className="mt-4 scroll-mt-6 rounded-lg border border-cedar/30 bg-cedar/5 p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-stone-dark">{t("sampleTitle")}</p>
          <SupplierDisplayNameEditor
            supplierId={sample.supplierId}
            skuId={skuId}
            name={sample.supplierName}
            nameClassName="text-sm font-semibold text-ink"
          />
          <SupplierContactsEditor
            supplierId={sample.supplierId}
            skuId={skuId}
            contactEmail={contactEmail}
            contactWhatsapp={contactWhatsapp}
            compact
            onSaved={(next) => {
              setContactEmail(next.contactEmail);
              setContactWhatsapp(next.contactWhatsapp);
            }}
          />
          {supplier ? (
            <button
              type="button"
              onClick={() => setContactOpen(true)}
              className="mt-2 text-[11px] font-medium text-sea underline-offset-2 hover:underline"
            >
              {t("contactSupplier")}
            </button>
          ) : null}
        </div>
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
                  suppressSkuAutoScroll(skuId);
                  await markSampleReceivedAction(
                    sample.id,
                    checklist,
                    photoNotes,
                  );
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
                suppressSkuAutoScroll(skuId);
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
                suppressSkuAutoScroll(skuId);
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
                suppressSkuAutoScroll(skuId);
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

      {contactOpen && supplier ? (
        <SupplierContactModal
          s={{
            ...supplier,
            contactEmail,
            contactWhatsapp,
          }}
          skuId={skuId}
          skuName={skuName}
          onClose={() => setContactOpen(false)}
        />
      ) : null}
    </div>
  );
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function CostQuotesBlock({
  costQuotes,
  skuId,
  browseShortlist,
  preferCollapsed = false,
}: {
  costQuotes: CostQuotesView;
  skuId: string;
  browseShortlist: boolean;
  /** Stage is not the costs/batch job — start collapsed; expand to edit. */
  preferCollapsed?: boolean;
}) {
  const t = useTranslations("Supplier");
  const [pending, startTransition] = useTransition();
  const [expanded, setExpanded] = useState(false);
  const isLocal = costQuotes.quoteSource === "local";
  const [productCost, setProductCost] = useState(
    String(costQuotes.prefill.productCost),
  );
  const [intlShip, setIntlShip] = useState(String(costQuotes.prefill.intlShip));
  const [clearanceTaxes, setClearanceTaxes] = useState(
    String(costQuotes.prefill.clearanceTaxes),
  );
  const [supplierDelivery, setSupplierDelivery] = useState(
    String(costQuotes.prefill.supplierDelivery),
  );
  const [packaging, setPackaging] = useState(
    String(costQuotes.prefill.packaging),
  );
  const [localCourier, setLocalCourier] = useState(
    String(costQuotes.prefill.localCourier),
  );
  const [sellPrice, setSellPrice] = useState(String(costQuotes.prefill.sellPrice));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(costQuotes.saved);

  const displayMode = resolveCostQuotesDisplayMode({
    unlocked: costQuotes.unlocked,
    browseShortlist,
    needsRefresh: costQuotes.needsRefresh,
    preferCollapsed,
  });
  const showForm =
    displayMode === "form" || (displayMode === "collapsed" && expanded);

  if (displayMode === "locked") {
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

  // Quiet / browse: keep unlock/save logic; expand to edit when needed.
  if (displayMode === "collapsed" && !showForm) {
    return (
      <div
        id="cost-quotes"
        className="mt-4 rounded-lg border border-dashed border-stone bg-surface-subtle p-4"
      >
        <h3 className="text-sm font-semibold text-ink">{t("costQuotesTitle")}</h3>
        <p className="mt-1 text-xs text-stone-dark">
          {browseShortlist
            ? t("costQuotesBrowseNote")
            : t("costQuotesCollapsedNote")}
        </p>
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-2 text-xs font-medium text-sea underline-offset-2 hover:underline"
        >
          {t("costQuotesExpand")}
        </button>
      </div>
    );
  }

  const quoteInput: CostQuoteInput = isLocal
    ? {
        source: "local",
        productCost: Number(productCost),
        supplierDelivery: Number(supplierDelivery),
        packaging: Number(packaging),
        localCourier: Number(localCourier),
        sellPrice: Number(sellPrice),
      }
    : {
        source: "import",
        productCost: Number(productCost),
        intlShip: Number(intlShip),
        clearanceTaxes: Number(clearanceTaxes),
        localCourier: Number(localCourier),
        sellPrice: Number(sellPrice),
      };

  const nums = isLocal
    ? [productCost, supplierDelivery, packaging, localCourier, sellPrice]
    : [productCost, intlShip, clearanceTaxes, localCourier, sellPrice];
  const valid = nums.every((v) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0;
  });
  const preview = valid
    ? computeMargin(
        toMarginInput(quoteInput, costQuotes.monthlyFollowOnBudget),
      )
    : null;
  const belowMin =
    preview != null && preview.marginBefore < MARGIN_BEFORE_ADS_MIN;

  return (
    <div
      id="cost-quotes"
      className={`mt-4 rounded-lg border bg-surface-subtle p-4 ${
        saved && !costQuotes.needsRefresh
          ? "border-stone"
          : "border-cedar bg-cedar/5"
      }`}
    >
      {displayMode === "collapsed" && expanded && (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="mb-2 text-[11px] font-medium text-stone-dark underline-offset-2 hover:underline"
        >
          {t("costQuotesCollapse")}
        </button>
      )}
      {!saved && displayMode === "form" && (
        <p className="mb-2 inline-flex items-center gap-1.5 rounded-md bg-cedar px-2.5 py-1 text-[11px] font-semibold text-foam">
          {t("costQuotesNextStep")}
        </p>
      )}
      <h3 className="text-sm font-semibold text-ink">{t("costQuotesTitle")}</h3>
      {costQuotes.needsRefresh ? (
        <p className="mt-1 text-xs text-amber-900">{t("costQuotesPathSwitchNote")}</p>
      ) : (
        <p className="mt-1 text-xs text-stone-dark">
          {isLocal ? t("costQuotesIntroLocal") : t("costQuotesIntro")}
        </p>
      )}
      <p className="mt-1 text-[11px] text-stone-dark">
        {t("costQuotesSourceNote", {
          source: isLocal ? t("sourceLocal") : t("sourceImport"),
        })}
      </p>

      <div className="mt-3 rounded-md border border-stone bg-surface px-3 py-2.5 text-xs text-stone-dark">
        <p className="font-medium text-ink">{t("costQuotesGuideTitle")}</p>
        <ul className="mt-1.5 list-disc space-y-1 ps-4">
          {isLocal ? (
            <>
              <li>{t("costQuotesGuideDelivery")}</li>
              <li>{t("costQuotesGuidePackaging")}</li>
              <li>{t("costQuotesGuideCourier")}</li>
            </>
          ) : (
            <>
              <li>{t("costQuotesGuideFreight")}</li>
              <li>{t("costQuotesGuideClearance")}</li>
              <li>{t("costQuotesGuideCourier")}</li>
            </>
          )}
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
        {isLocal ? (
          <>
            <CostField
              label={t("costSupplierDelivery")}
              value={supplierDelivery}
              onChange={setSupplierDelivery}
              hint={t("costSupplierDeliveryHint")}
            />
            <CostField
              label={t("costPackaging")}
              value={packaging}
              onChange={setPackaging}
              hint={t("costPackagingHint")}
            />
          </>
        ) : (
          <>
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
          </>
        )}
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
            const res = await saveCostQuotesAction(quoteInput, skuId);
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
  // Prefer a supplier with an approved sample (batch is only legal with them).
  // Path B may approve a backup — any approved id is eligible, not only "working".
  const approvedSet = new Set(view.approvedSupplierIds);
  const defaultId =
    view.approvedSampleSupplierId &&
    suppliers.some((s) => s.id === view.approvedSampleSupplierId)
      ? view.approvedSampleSupplierId
      : view.sample?.supplierId &&
          suppliers.some((s) => s.id === view.sample!.supplierId)
        ? view.sample.supplierId
        : (suppliers.find((s) => approvedSet.has(s.id))?.id ??
          suppliers[0]?.id ??
          "");
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

  // Hard gate mirror: batch only when selection has an approved sample.
  const canBatchSelected = !!selected && approvedSet.has(selected.id);
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

  function selectPathBSupplier(s: SupplierView) {
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
                  [{s.source === "local" ? t("sourceLocal") : t("sourceImport")}]{" "}
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
            disabled={
              pending ||
              view.samples.some((s) => s.supplierId === selected.id)
            }
            onClick={requestSampleForSelected}
            className="mt-2 rounded-md bg-cedar px-3 py-1.5 text-[11px] font-semibold text-foam transition hover:bg-cedar-deep disabled:opacity-60"
          >
            {t("requestSampleForSelected")}
          </button>
          {view.samples.some((s) => s.supplierId === selected.id) && (
            <p className="mt-1.5 text-[11px] text-amber-900">
              {t("warmBackupSampleInFlight")}
            </p>
          )}
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
                        onClick={() => selectPathBSupplier(s)}
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
            suppressSkuAutoScrollAfterBatchAction(view.skuId);
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

function BatchArrivalEtaBlock({
  eta,
  skuId,
}: {
  eta: BatchArrivalEtaView;
  skuId: string;
}) {
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

  // Marketing “Set ETA on Supplier” → #batch-arrival-eta once (load / hashchange).
  // Remount with leftover same hash must not re-scroll (Generate kit revalidate).
  useEffect(() => {
    function scrollIfTargeted() {
      if (window.location.hash !== "#batch-arrival-eta") return;
      const locationKey = skuFocusLocationKey();
      if (!consumeBatchArrivalEtaDeepLinkOnce(skuId, locationKey)) return;
      document
        .getElementById("batch-arrival-eta")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
      markBatchArrivalEtaDeepLinkConsumed(skuId, locationKey);
    }
    const timer = window.setTimeout(scrollIfTargeted, 50);
    window.addEventListener("hashchange", scrollIfTargeted);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("hashchange", scrollIfTargeted);
    };
  }, [skuId]);

  const presets: { id: EtaPreset; labelKey: string }[] = [
    { id: "2w", labelKey: "etaPreset2w" },
    { id: "1m", labelKey: "etaPreset1m" },
    { id: "2m", labelKey: "etaPreset2m" },
    { id: "custom", labelKey: "etaPresetCustom" },
  ];

  return (
    <div
      id="batch-arrival-eta"
      className="mt-4 scroll-mt-6 rounded-lg border border-stone bg-surface-subtle p-4"
    >
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
            const res = await setBatchArrivalEtaAction(skuId, {
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

function BatchArrived({ skuId }: { skuId: string }) {
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
            suppressSkuAutoScrollAfterBatchAction(skuId);
            const res = await markBatchArrivedAction(skuId, ack);
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

function NextBatchOrder({
  view,
  onViewShortlist,
  onPathSwitched,
  quietSideFlows = false,
}: {
  view: SupplierPanelView;
  onViewShortlist?: () => void;
  onPathSwitched?: () => void;
  /** Warm spare + can’t-fulfill stay available but quieter when next-batch is boss. */
  quietSideFlows?: boolean;
}) {
  const t = useTranslations("Supplier");
  const [pending, startTransition] = useTransition();
  const reorder = view.reorder;
  const moq =
    view.groups
      .flatMap((g) => [g.primary, ...g.backups].filter(Boolean) as SupplierView[])
      .find((s) => s.id === reorder.supplierId)?.moq ?? 100;
  const [qty, setQty] = useState(moq);
  const [economicsAck, setEconomicsAck] = useState(false);
  const [stuckAcks, setStuckAcks] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const supplier = view.groups
    .flatMap((g) => [g.primary, ...g.backups].filter(Boolean) as SupplierView[])
    .find((s) => s.id === reorder.supplierId);
  const freight = view.batchBasis.intlShip + view.batchBasis.clearanceTaxes;
  const estCost = Math.round(((supplier?.unitPrice ?? 0) + freight) * qty);
  const overLimit = estCost > view.softLimitUsd;
  const blocked =
    !reorder.economics.ok && reorder.economics.error === "beginner_blocked";
  const needsAck = reorder.needsEconomicsAck;

  return (
    <div
      id="reorder"
      className="mt-4 rounded-lg border border-stone bg-surface-subtle p-4"
    >
      <h3 className="text-sm font-semibold text-ink">{t("reorderTitle")}</h3>
      <p className="mt-1 text-xs text-stone-dark">{t("reorderIntro")}</p>

      <UnitsLeftGlanceBlock glance={reorder.unitsLeftGlance} />

      {reorder.runway.nudge && (
        <p className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
          {reorder.runway.weeks != null
            ? t("reorderNudgeWeeks", {
                weeks: Math.max(0.1, Math.round(reorder.runway.weeks * 10) / 10),
              })
            : t("reorderNudgeThin")}
        </p>
      )}

      {reorder.investTone === "strengthen" && (
        <p className="mt-2 rounded-md border border-cedar/30 bg-cedar/10 px-3 py-2 text-[11px] text-cedar-deep">
          {t("reorderToneReinvest")}
        </p>
      )}
      {reorder.investTone === "warn" && (
        <p className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
          {t("reorderToneWarn")}
        </p>
      )}

      <p className="mt-3 text-xs text-stone-dark">
        {t("reorderSamePath")}:{" "}
        <span className="font-medium text-ink">
          {reorder.supplierName ?? "—"}
          {reorder.supplierSource
            ? ` (${reorder.supplierSource === "local" ? t("sourceLocal") : t("sourceImport")})`
            : ""}
        </span>
      </p>

      <label className="mt-3 block text-xs text-stone-dark">
        {t("quantity")}
        <input
          type="number"
          min={1}
          value={qty}
          onChange={(e) => setQty(Number(e.target.value))}
          className="mt-1 w-full max-w-xs rounded-md border border-stone bg-surface px-2.5 py-2 text-sm text-ink outline-none focus:border-cedar"
        />
      </label>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-stone-dark">{t("estBatch")}:</span>
        <span
          className={`font-semibold ${overLimit ? "text-amber-800" : "text-cedar-deep"}`}
        >
          ~${formatUsd(estCost)}
        </span>
      </div>

      {blocked && (
        <p className="mt-3 rounded-md border border-amber-400 bg-amber-50 px-3 py-2 text-xs text-amber-950">
          {t("reorderBeginnerBlocked")}
        </p>
      )}

      {needsAck && (
        <label className="mt-3 flex items-start gap-2 text-xs text-stone-dark">
          <input
            type="checkbox"
            checked={economicsAck}
            onChange={(e) => setEconomicsAck(e.target.checked)}
            className="mt-0.5 size-4 accent-cedar"
          />
          <span>{t("reorderEconomicsAck")}</span>
        </label>
      )}

      {overLimit && (
        <label className="mt-3 flex items-start gap-2 text-xs text-amber-900">
          <input
            type="checkbox"
            checked={stuckAcks}
            onChange={(e) => setStuckAcks(e.target.checked)}
            className="mt-0.5 size-4 accent-cedar"
          />
          <span>{t("stuckAck")}</span>
        </label>
      )}

      {error && (
        <p className="mt-2 text-xs text-amber-800">{t(error as never)}</p>
      )}

      <button
        type="button"
        disabled={
          pending ||
          blocked ||
          !reorder.canOrder ||
          (needsAck && !economicsAck) ||
          (overLimit && !stuckAcks)
        }
        onClick={() => {
          setError(null);
          startTransition(async () => {
            suppressSkuAutoScrollAfterBatchAction(view.skuId);
            const res = await orderNextBatchAction(view.skuId, qty, {
              economicsAck,
              stuckAcks,
            });
            if (!res.ok) {
              setError(
                res.error === "beginner_blocked"
                  ? "reorderBeginnerBlocked"
                  : res.error === "needs_economics_ack"
                    ? "reorderNeedsEconomicsAck"
                    : res.error === "needs_stuck_acks"
                      ? "stuckAckRequired"
                      : "errorGeneric",
              );
            }
          });
        }}
        className="mt-3 rounded-md bg-cedar px-4 py-2 text-sm font-semibold text-foam shadow-sm transition hover:bg-cedar-deep disabled:cursor-not-allowed disabled:opacity-50"
      >
        {t("reorderOrder")}
      </button>
      <p className="mt-2 text-[11px] text-stone-dark">{t("reorderOrderHint")}</p>
      <p className="mt-2 rounded-md border border-sea/30 bg-sea/5 px-2.5 py-1.5 text-[11px] font-medium text-sea">
        {t("reorderNoStoreNote")}
      </p>

      {/* Spare open CTA stays sharp; can’t-fulfill may still demote under quietSideFlows. */}
      <WarmBackupBlock view={view} onOpenSpareCards={onViewShortlist} />
      <div className={quietSideFlows ? "supplier-block-secondary" : undefined}>
        <CantFulfillBlock
          view={view}
          onOpenSpareCards={onViewShortlist}
          onPathSwitched={onPathSwitched}
        />
      </div>
    </div>
  );
}

function ReorderInTransit({
  view,
  onViewShortlist,
  onPathSwitched,
}: {
  view: SupplierPanelView;
  onViewShortlist?: () => void;
  onPathSwitched?: () => void;
}) {
  const t = useTranslations("Supplier");
  const [pending, startTransition] = useTransition();
  const [ack, setAck] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reorder = view.reorder;

  return (
    <div
      id="reorder"
      className="mt-4 rounded-lg border border-stone bg-surface-subtle p-4"
    >
      <UnitsLeftGlanceBlock glance={reorder.unitsLeftGlance} />
      <h3 className="mt-3 text-sm font-semibold text-ink">
        {t("reorderInTransitTitle")}
      </h3>
      <p className="mt-1 text-xs text-stone-dark">{t("reorderInTransitIntro")}</p>
      <p className="mt-2 text-xs text-ink">
        {reorder.supplierName ?? "—"}
        {reorder.qty != null ? ` · ${reorder.qty} ${t("units")}` : ""}
        {reorder.estCost != null ? ` · ~$${formatUsd(reorder.estCost)}` : ""}
      </p>
      <label className="mt-3 flex items-start gap-2 text-xs text-stone-dark">
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
            suppressSkuAutoScrollAfterBatchAction(view.skuId);
            const res = await markReorderArrivedAction(view.skuId, ack);
            if (!res.ok) setError("errorGeneric");
          });
        }}
        className="mt-3 rounded-md bg-cedar px-4 py-2 text-sm font-semibold text-foam shadow-sm transition hover:bg-cedar-deep disabled:cursor-not-allowed disabled:opacity-50"
      >
        {t("reorderMarkArrived")}
      </button>
      <CantFulfillBlock
        view={view}
        onOpenSpareCards={onViewShortlist}
        onPathSwitched={onPathSwitched}
      />
    </div>
  );
}

function WarmBackupBlock({
  view,
  onOpenSpareCards,
}: {
  view: SupplierPanelView;
  onOpenSpareCards?: () => void;
}) {
  const t = useTranslations("Supplier");
  const { reorder } = view;
  const spareInFlight = view.spareInFlightCount;
  const atCap = spareInFlight >= MAX_SPARE_SAMPLES_IN_FLIGHT;
  const coldLeft = reorder.backups.some((b) => !b.warm);

  if (!reorder.insuranceAvailable) return null;

  return (
    <div
      className={`mt-4 rounded-md border p-3 text-xs ${
        reorder.warmCoach
          ? "border-sea/40 bg-sea/10 text-sea"
          : "border-stone bg-surface-subtle text-stone-dark"
      }`}
    >
      <p className="font-semibold text-ink">{t("warmBackupTitle")}</p>
      <p className="mt-1 text-stone-dark">{t("warmBackupIntro")}</p>
      <p className="mt-1 text-stone-dark">{t("warmBackupAdvise")}</p>
      <p className="mt-1 text-[11px] text-stone-dark">{t("warmBackupPathNote")}</p>
      {!coldLeft ? (
        <p className="mt-2 text-stone-dark">{t("warmBackupNone")}</p>
      ) : (
        <button
          type="button"
          disabled={!onOpenSpareCards || atCap}
          onClick={() => onOpenSpareCards?.()}
          className="mt-3 rounded-md bg-cedar px-3 py-2 text-[11px] font-semibold text-foam disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t("warmBackupOpenCards")}
        </button>
      )}
      {spareInFlight > 0 && (
        <p className="mt-2 text-[11px] text-stone-dark">
          {atCap
            ? t("spareSamplesAtCap", { max: MAX_SPARE_SAMPLES_IN_FLIGHT })
            : t("spareSamplesInFlight", {
                n: spareInFlight,
                max: MAX_SPARE_SAMPLES_IN_FLIGHT,
              })}
        </p>
      )}
    </div>
  );
}

function CantFulfillBlock({
  view,
  onOpenSpareCards,
  onPathSwitched,
}: {
  view: SupplierPanelView;
  onOpenSpareCards?: () => void;
  onPathSwitched?: () => void;
}) {
  const t = useTranslations("Supplier");
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string>("other");
  const [pickOpen, setPickOpen] = useState(false);
  const [showColdLastResort, setShowColdLastResort] = useState(false);
  const [skipAck, setSkipAck] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exhausted, setExhausted] = useState(view.reorder.exhaustedBackups);
  const [contactTarget, setContactTarget] = useState<SupplierView | null>(null);
  const { reorder } = view;
  const suppliersById = indexSuppliersById(view);

  if (!reorder.available) return null;

  const warmBackups = listWarmSparesForSwitch(reorder.backups);
  const coldBackups = reorder.backups.filter((b) => !b.warm);
  const showPick = pickOpen || Object.keys(reorder.unavailable).length > 0;

  return (
    <div className="mt-4 rounded-md border border-amber-300/80 bg-amber-50/80 p-3 text-xs text-amber-950">
      <p className="font-semibold">{t("cantFulfillTitle")}</p>
      <p className="mt-1 text-amber-900/90">{t("cantFulfillIntro")}</p>
      {!open ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => setOpen(true)}
          className="mt-2 rounded-md border border-amber-400 bg-white px-3 py-1.5 text-[11px] font-semibold text-amber-950"
        >
          {t("cantFulfillCta")}
        </button>
      ) : (
        <div className="mt-2 space-y-2">
          <label className="block text-amber-900">
            {t("cantFulfillReason")}
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="mt-1 w-full rounded-md border border-amber-300 bg-white px-2 py-1.5 text-sm text-ink"
            >
              {CANT_FULFILL_REASONS.map((r) => (
                <option key={r} value={r}>
                  {t(`cantFulfillReasons.${r}` as never)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setError(null);
              startTransition(async () => {
                const res = await reportSupplierCantFulfillAction(
                  view.skuId,
                  reason,
                );
                if (!res.ok) {
                  setError("errorGeneric");
                  return;
                }
                setExhausted(res.exhausted);
                setPickOpen(true);
                setOpen(false);
              });
            }}
            className="rounded-md bg-amber-800 px-3 py-1.5 text-[11px] font-semibold text-foam disabled:opacity-50"
          >
            {t("cantFulfillConfirm")}
          </button>
        </div>
      )}

      {showPick && (
        <div className="mt-3 space-y-2 border-t border-amber-300/60 pt-3">
          <p className="font-medium text-ink">{t("cantFulfillPickTitle")}</p>
          {exhausted || reorder.exhaustedBackups ? (
            <p className="text-amber-900">{t("cantFulfillExhausted")}</p>
          ) : warmBackups.length === 0 ? (
            <div className="space-y-2">
              <p className="text-amber-900">{t("cantFulfillNoWarm")}</p>
              {onOpenSpareCards && (
                <button
                  type="button"
                  onClick={() => onOpenSpareCards()}
                  className="rounded-md bg-cedar px-3 py-1.5 text-[11px] font-semibold text-foam"
                >
                  {t("cantFulfillGoWarm")}
                </button>
              )}
              {coldBackups.length > 0 && (
                <div>
                  {!showColdLastResort ? (
                    <button
                      type="button"
                      onClick={() => setShowColdLastResort(true)}
                      className="text-[11px] font-semibold text-amber-900 underline-offset-2 hover:underline"
                    >
                      {t("cantFulfillNoSpareYet")}
                    </button>
                  ) : (
                    <div className="mt-2 space-y-2">
                      <p className="text-amber-900/90">{t("cantFulfillColdLastResortIntro")}</p>
                      <ul className="space-y-2">
                        {coldBackups.map((b) => (
                          <li
                            key={b.id}
                            className="rounded border border-amber-200 bg-white px-2.5 py-2"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="text-ink">
                                {b.name}{" "}
                                <span className="text-stone-dark">
                                  ({t("backupCold")})
                                </span>
                              </span>
                              <div className="flex flex-wrap gap-1.5">
                                <button
                                  type="button"
                                  disabled={pending}
                                  onClick={() => {
                                    setError(null);
                                    startTransition(async () => {
                                      const res = await switchReorderBackupAction(
                                        view.skuId,
                                        b.id,
                                      );
                                      if (!res.ok) {
                                        setError("errorGeneric");
                                        return;
                                      }
                                      // Cold sample does not switch path — no quotes refresh.
                                    });
                                  }}
                                  className="rounded-md border border-stone px-2.5 py-1 text-[11px] font-semibold text-ink"
                                >
                                  {t("switchColdSample")}
                                </button>
                                {reorder.experience !== "beginner" && (
                                  <button
                                    type="button"
                                    disabled={pending || !skipAck}
                                    onClick={() => {
                                      setError(null);
                                      startTransition(async () => {
                                        const res = await switchReorderBackupAction(
                                          view.skuId,
                                          b.id,
                                          { skipSampleAck: true },
                                        );
                                        if (!res.ok) {
                                          setError(
                                            res.error === "beginner_no_skip"
                                              ? "crisisSkipBeginner"
                                              : res.error === "needs_skip_ack"
                                                ? "crisisSkipNeedAck"
                                                : "errorGeneric",
                                          );
                                          return;
                                        }
                                        if (res.mode === "crisis_skip") {
                                          onPathSwitched?.();
                                        }
                                      });
                                    }}
                                    className="rounded-md bg-amber-800 px-2.5 py-1 text-[11px] font-semibold text-foam disabled:opacity-50"
                                  >
                                    {t("switchCrisisSkip")}
                                  </button>
                                )}
                              </div>
                            </div>
                          </li>
                        ))}
                      </ul>
                      {reorder.experience !== "beginner" && (
                        <label className="flex items-start gap-2 text-amber-950">
                          <input
                            type="checkbox"
                            checked={skipAck}
                            onChange={(e) => setSkipAck(e.target.checked)}
                            className="mt-0.5 size-4 accent-cedar"
                          />
                          <span>{t("crisisSkipAck")}</span>
                        </label>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <ul className="space-y-2">
              {warmBackups.map((b) => {
                const spare = suppliersById.get(b.id);
                return (
                <li
                  key={b.id}
                  className="rounded border border-amber-200 bg-white px-2.5 py-2"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <SupplierDisplayNameEditor
                        supplierId={b.id}
                        skuId={view.skuId}
                        name={spare?.name ?? b.name}
                        nameClassName="text-xs font-semibold text-ink"
                        compact
                      />
                      <span className="text-[10px] text-stone-dark">
                        ({t("backupWarm")})
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {spare ? (
                        <button
                          type="button"
                          onClick={() => setContactTarget(spare)}
                          className="rounded-md border border-sea/40 bg-sea/5 px-2.5 py-1 text-[11px] font-semibold text-sea"
                        >
                          {t("contactSupplier")}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => {
                          setError(null);
                          startTransition(async () => {
                            const res = await switchReorderBackupAction(
                              view.skuId,
                              b.id,
                            );
                            if (!res.ok) {
                              setError("errorGeneric");
                              return;
                            }
                            if (res.mode === "warm") {
                              onPathSwitched?.();
                            }
                          });
                        }}
                        className="rounded-md bg-cedar px-2.5 py-1 text-[11px] font-semibold text-foam"
                      >
                        {t("switchWarm")}
                      </button>
                    </div>
                  </div>
                </li>
                );
              })}
            </ul>
          )}
          {contactTarget ? (
            <SupplierContactModal
              s={contactTarget}
              skuId={view.skuId}
              skuName={view.skuName}
              onClose={() => setContactTarget(null)}
            />
          ) : null}
          {reorder.bridge && (
            <div className="rounded-md border border-sea/30 bg-sea/5 px-2.5 py-2 text-sea">
              <p className="font-semibold text-ink">{t("bridgeTitle")}</p>
              <p className="mt-1 text-stone-dark">{t("bridgeIntro")}</p>
              {reorder.bridge.holdAds && (
                <p className="mt-1">• {t("bridgeHoldAds")}</p>
              )}
              {reorder.bridge.stretchStock && (
                <p>• {t("bridgeStretch")}</p>
              )}
              {reorder.bridge.localBridge && (
                <p>• {t("bridgeLocal")}</p>
              )}
            </div>
          )}
          {reorder.coldSampleInFlight && !reorder.bridge && (
            <p className="text-stone-dark">{t("coldSamplePending")}</p>
          )}
        </div>
      )}
      {error && <p className="mt-2 text-amber-800">{t(error as never)}</p>}
    </div>
  );
}

function ReorderArrivalEtaBlock({
  eta,
  skuId,
}: {
  eta: BatchArrivalEtaView;
  skuId: string;
}) {
  const t = useTranslations("Supplier");
  const [pending, startTransition] = useTransition();
  const [preset, setPreset] = useState<EtaPreset>(
    eta.founderSet && eta.preset !== "default" ? eta.preset : "1m",
  );
  const [date, setDate] = useState(eta.date ?? "");
  const [label, setLabel] = useState(eta.label ?? "");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const presets: { id: EtaPreset; labelKey: string }[] = [
    { id: "2w", labelKey: "etaPreset2w" },
    { id: "1m", labelKey: "etaPreset1m" },
    { id: "2m", labelKey: "etaPreset2m" },
    { id: "custom", labelKey: "etaPresetCustom" },
  ];

  return (
    <div className="mt-4 rounded-lg border border-stone bg-surface-subtle p-4">
      <h3 className="text-sm font-semibold text-ink">{t("reorderEtaTitle")}</h3>
      <p className="mt-1 text-xs text-stone-dark">{t("reorderEtaIntro")}</p>
      <p className="mt-2 text-xs text-ink">
        <span className="font-medium">{t("etaCurrent")}: </span>
        {eta.summaryEn}
        {!eta.founderSet && (
          <span className="text-stone-dark"> — {t("etaUsingDefault")}</span>
        )}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {presets.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setPreset(p.id)}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
              preset === p.id
                ? "bg-cedar text-foam"
                : "border border-stone bg-surface text-ink hover:bg-sand"
            }`}
          >
            {t(p.labelKey as never)}
          </button>
        ))}
      </div>
      {preset === "custom" && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-stone-dark">
            {t("etaDate")}
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="mt-1 w-full rounded-md border border-stone bg-surface px-2.5 py-2 text-sm text-ink outline-none focus:border-cedar"
            />
          </label>
          <label className="text-xs text-stone-dark">
            {t("etaLabel")}
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={t("etaLabelPlaceholder")}
              className="mt-1 w-full rounded-md border border-stone bg-surface px-2.5 py-2 text-sm text-ink outline-none focus:border-cedar"
            />
          </label>
        </div>
      )}
      {saved && (
        <p className="mt-2 text-xs font-medium text-cedar-deep">{t("etaSaved")}</p>
      )}
      {error && <p className="mt-2 text-xs text-amber-800">{t(error as never)}</p>}
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setError(null);
          setSaved(false);
          startTransition(async () => {
            const res = await setReorderArrivalEtaAction(skuId, {
              preset,
              date: preset === "custom" ? date || null : null,
              label: label || null,
            });
            if (!res.ok) {
              setError("errorGeneric");
              return;
            }
            setSaved(true);
          });
        }}
        className="mt-3 rounded-md bg-cedar px-4 py-2 text-sm font-semibold text-foam shadow-sm transition hover:bg-cedar-deep disabled:cursor-not-allowed disabled:opacity-50"
      >
        {t("etaSave")}
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
