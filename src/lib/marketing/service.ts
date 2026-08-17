import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db, ensureMigrated, schema } from "@/db";
import { newId, nowIso } from "@/lib/ids";
import {
  LEGACY_MONTHLY_REFRESH_STAGE,
  MARKETING_CAPACITY_TIERS,
  PRE_LAUNCH_MAX_DAILY_AD_SPEND,
  normalizeMarketingStage,
  type MarketingCapacityTier,
  type MarketingStage,
} from "@/lib/constants";
import { createApprovalRequest, decideApproval } from "@/lib/approvals/engine";
import { getJourney, founderEditMarketingKit } from "@/lib/memory/repos";
import { getSkuView, getSkuViewById } from "@/lib/sku/service";
import {
  getSkuJourney,
  listLiveSkus,
  patchSkuJourneyFlags,
} from "@/lib/sku/journey";
import { assertSkuOwned } from "@/lib/sku/ownership";
import { parseGenerateKitSkuScope } from "@/lib/sku/require-sku-id";
import {
  buildIntroLesson,
  ensureIntroLessonComplete,
  type IntroLessonPayload,
  type IntroLessonSection,
} from "@/lib/marketing/intro-lesson";
import { getMarketingLlmProvider } from "@/lib/marketing/intro-llm";
import { isGeminiConfigured } from "@/lib/discovery/explain/llm";
import {
  buildCreatives,
  type BuildCreativesInput,
  type Creative,
} from "@/lib/marketing/creatives";
import {
  chunkCreativesForGemini,
  creativesKitPayloadFromFill,
  continueFillStillLeftover,
  leftoverRetryChunks,
  mergeLeftoverFills,
  parseCreativesKitItems,
  resolveContinueFillAllowList,
  resolveWeeklyKitWeek,
  weeklyRefreshGenerateArgs,
  serializeCreativesKit,
  shouldChunkCreativesKit,
  type CreativesKitSource,
} from "@/lib/marketing/creatives-ai";
import {
  checkMarketingGeminiAllowance,
  isMarketingGeminiCapReached,
  recordMarketingGeminiCalls,
} from "@/lib/marketing/marketing-gemini-usage";
import { resolveBatchArrivalEta } from "@/lib/supplier/batch-eta";
import type { BatchArrivalEtaView } from "@/lib/supplier/batch-eta";
import {
  resolveDefaultFocusStage,
  resolveMarketingJourneyFlags,
  resolveUnlockedStages,
  type MarketingStageInfo,
} from "@/lib/marketing/focus";
import {
  needsMarginAckForPaidUi,
  resolveSkuPlanningMargins,
} from "@/lib/marketing/margin-gate";
import { getCurrentActual } from "@/lib/finance/service";
import type { SkuCardView } from "@/lib/sku/service";
import {
  listCreativePackChoices,
  listPhotoPacksForSku,
  type CreativePackChoice,
  type PhotoPackOption,
} from "@/lib/marketing/visual-packs";
import { listCreativeVisualFiles } from "@/lib/marketing/visual-gen";
import { isMarketingVisualGenReady } from "@/lib/marketing/visual-flags";
import type { CreativeVisualFileView } from "@/lib/marketing/visual-pack-ui";

export type { MarketingStageInfo };

/**
 * Marketing — stage-aware kits.
 *
 * Stage gating follows the journey:
 *   sample approved      → intro          (organic lesson — not creatives)
 *   batch ordered        → pre-launch     (organic + max $5/day paid)
 *   batch arrived/ready  → launch         (real paid budget, gated ack)
 *   after launch         → weekly refresh (ongoing; stage id weekly_refresh)
 *
 * Intro stores a product-tailored beginner LESSON. Other stages store EN + AR
 * niche creatives (hook-first, WhatsApp CTA — never COD-as-wow). Counts:
 * pre_launch lighter (4/6/8); launch + weekly_refresh full tier (6/10/14).
 * Kits are creative/lesson plans only — NOT Topic A money advice (Finance).
 * Founder-facing and stage id both use weekly refresh (`weekly_refresh`).
 */

export type { IntroLessonPayload, IntroLessonSection, Creative };
export {
  buildCreatives,
  creativeCountFor,
  creativesHaveCodPitch,
  creativesContentKey,
  normalizeCreative,
  preLaunchHasForbiddenPitch,
  weekPhase,
} from "@/lib/marketing/creatives";

export function capacityTierFor(hoursPerWeek: number): MarketingCapacityTier {
  if (hoursPerWeek >= 20) return 14;
  if (hoursPerWeek >= 10) return 10;
  return 6;
}

// ---------------------------------------------------------------------------
// Stage resolution + read model
// ---------------------------------------------------------------------------

export type MarketingKitView = {
  id: string;
  stage: MarketingStage;
  capacityTier: number;
  /** Discriminator for UI branching — intro lessons vs creative kits. */
  kind: "creatives" | "intro_lesson";
  creatives: Creative[];
  lesson: IntroLessonPayload | null;
  /** How creative/lesson bodies were produced (Wave 4). */
  source: "gemini" | "template" | "partial" | null;
  /** Last creatives fill fail reason (banner). */
  fillError: string | null;
  /** Template cards kept on a partial fill. */
  templateCount: number;
  /** Leftover skeleton ids for Try AI fill again on partial. */
  templateIds: string[];
  createdAt: string;
};

export type MarketingPanelView = {
  currentStage: MarketingStage;
  capacityTier: MarketingCapacityTier;
  stages: MarketingStageInfo[];
  kits: MarketingKitView[];
  maxDailyPaid: number;
  whatsappSet: boolean;
  launchAckNeeded: boolean;
  /** Batch arrival ETA from Supplier (or default 1 month). */
  batchArrivalEta: BatchArrivalEtaView;
  /** Selected SKU id, or null for whole-shop kit. */
  selectedSkuId: string | null;
  /** Live SKUs for the picker. */
  liveSkus: Array<{ id: string; name: string }>;
  /** True when ≥3 live SKUs — whole-shop kit option available. */
  shopKitAvailable: boolean;
  /** True when viewing the whole-shop kit (skuId null). */
  isShopKit: boolean;
  /** Active SKU category (shop kit → multi). */
  selectedCategory: string;
  /** True when GEMINI_API_KEY (or Discovery Gemini alias) is set on the server. */
  geminiConfigured: boolean;
  /**
   * True when this workspace is at/over MARKETING_GEMINI_MONTHLY_CAP for the
   * current UTC month (Intro + creatives; not Store).
   */
  geminiCapReached: boolean;
  /**
   * Known planning/actual margins miss 70%/35% bars — top note uses fail copy.
   * Informational only; never blocks generate.
   */
  needsMarginAck: boolean;
  /** Per-SKU named photo packs. Empty on whole-shop kits. */
  photoPacks: PhotoPackOption[];
  /** Saved pack pick per kit card. Empty on whole-shop kits. */
  creativePackChoices: CreativePackChoice[];
  /** Generated still/clip on a card (owned file). Empty on whole-shop kits. */
  creativeVisuals: CreativeVisualFileView[];
  /** Flag on + Higgsfield keys present. Cap checked at click. */
  visualGenReady: boolean;
};

async function resolveMarginsForKitContext(args: {
  workspaceId: string;
  isShopKit: boolean;
  sku: SkuCardView | null;
  monthlyFollowOnBudget: number;
}): Promise<{ before: number | null; after: number | null }> {
  if (args.isShopKit) {
    const actual = await getCurrentActual(args.workspaceId);
    return {
      before: actual?.before ?? null,
      after: actual?.after ?? null,
    };
  }
  if (!args.sku) return { before: null, after: null };
  const pair = resolveSkuPlanningMargins({
    quotedCosts: args.sku.quotedCosts,
    moneySnapshot: args.sku.moneySnapshot,
    monthlyFollowOnBudget: args.monthlyFollowOnBudget,
  });
  return { before: pair.before, after: pair.after };
}

function parseKitItems(raw: string): {
  kind: "creatives" | "intro_lesson";
  creatives: Creative[];
  lesson: IntroLessonPayload | null;
  source: "gemini" | "template" | "partial" | null;
  fillError: string | null;
  templateCount: number;
  templateIds: string[];
  weeklyWeek: number;
} {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      (parsed as IntroLessonPayload).kind === "intro_lesson" &&
      Array.isArray((parsed as IntroLessonPayload).sections)
    ) {
      const lesson = ensureIntroLessonComplete(parsed as IntroLessonPayload);
      return {
        kind: "intro_lesson",
        creatives: [],
        lesson,
        source: lesson.source ?? null,
        fillError: null,
        templateCount: 0,
        templateIds: [],
        weeklyWeek: 0,
      };
    }
    const creativesKit = parseCreativesKitItems(parsed);
    if (creativesKit) {
      return {
        kind: "creatives",
        creatives: creativesKit.creatives,
        lesson: null,
        source: creativesKit.source,
        fillError: creativesKit.fillError,
        templateCount: creativesKit.templateCount,
        templateIds: creativesKit.templateIds,
        weeklyWeek: creativesKit.weeklyWeek,
      };
    }
  } catch {
    /* ignore */
  }
  return {
    kind: "creatives",
    creatives: [],
    lesson: null,
    source: null,
    fillError: null,
    templateCount: 0,
    templateIds: [],
    weeklyWeek: 0,
  };
}

export async function getMarketingPanel(
  workspaceId: string,
  skuId?: string | null,
): Promise<MarketingPanelView | null> {
  await ensureMigrated();
  const live = await listLiveSkus(workspaceId);
  if (live.length === 0) return null;

  const shopKitAvailable = live.length >= 3;
  const isShopKit = skuId === null && shopKitAvailable;

  let sku =
    skuId && skuId.length > 0
      ? await getSkuViewById(workspaceId, skuId)
      : isShopKit
        ? null
        : await getSkuView(workspaceId);

  // Explicit skuId that doesn't resolve → miss (no activeSkuId steal).
  if (typeof skuId === "string" && skuId.length > 0 && !sku) return null;

  // Default to active / first live when no explicit pick (reads / hub Tools).
  if (!isShopKit && !sku) {
    sku = await getSkuView(workspaceId);
    if (!sku && live[0]) {
      sku = await getSkuViewById(workspaceId, live[0].id);
    }
  }
  if (!isShopKit && !sku) return null;

  const selectedSkuId = isShopKit ? null : sku!.id;
  const skuJourney = selectedSkuId
    ? await getSkuJourney(selectedSkuId)
    : null;

  const [side, journey, onboarding, store, kitRows] = await Promise.all([
    db
      .select()
      .from(schema.sideStatuses)
      .where(eq(schema.sideStatuses.workspaceId, workspaceId))
      .then((rows) => rows[0]),
    getJourney(workspaceId),
    db
      .select()
      .from(schema.onboardingProfiles)
      .where(eq(schema.onboardingProfiles.workspaceId, workspaceId))
      .then((rows) => rows[0]),
    db
      .select()
      .from(schema.storeReadiness)
      .where(eq(schema.storeReadiness.workspaceId, workspaceId))
      .then((rows) => rows[0]),
    isShopKit
      ? db
          .select()
          .from(schema.marketingKits)
          .where(
            and(
              eq(schema.marketingKits.workspaceId, workspaceId),
              isNull(schema.marketingKits.skuId),
            ),
          )
          .orderBy(asc(schema.marketingKits.createdAt))
          
      : db
          .select()
          .from(schema.marketingKits)
          .where(eq(schema.marketingKits.skuId, selectedSkuId!))
          .orderBy(asc(schema.marketingKits.createdAt)),
  ]);

  const journeyFlags = resolveMarketingJourneyFlags({
    skuJourney: skuJourney
      ? {
          primaryState: skuJourney.primaryState,
          pausedFromState: skuJourney.pausedFromState,
          sampleStatus: skuJourney.sampleStatus,
          batchOrdered: skuJourney.batchOrdered,
          batchArrivedReady: skuJourney.batchArrivedReady,
          marketingStage: skuJourney.marketingStage,
          batchArrivalEta: skuJourney.batchArrivalEta,
        }
      : null,
    // Legacy single-SKU only — never mix sideStatuses into a real skuJourney.
    legacy: skuJourney
      ? null
      : {
          primaryState: journey?.primaryState ?? "",
          sampleStatus: side?.sampleStatus ?? null,
          batchOrdered: side?.batchOrdered ?? false,
          batchArrivedReady: side?.batchArrivedReady ?? false,
          marketingStage: side?.marketingStage ?? null,
          batchArrivalEta: side?.batchArrivalEta ?? null,
        },
  });

  const {
    primaryState,
    sampleApproved,
    batchOrdered,
    batchArrivedReady,
    marketingStage: skuMarketingStage,
  } = journeyFlags;

  // One kit per stage in the read model (legacy stacks collapse to newest).
  const kits: MarketingKitView[] = [];
  const latestByStage = new Map<MarketingStage, MarketingKitView>();
  for (const k of kitRows) {
    const items = parseKitItems(k.items);
    const stage = normalizeMarketingStage(k.stage);
    latestByStage.set(stage, {
      id: k.id,
      stage,
      capacityTier: Number(k.capacityTier),
      kind: items.kind,
      creatives: items.creatives,
      lesson: items.lesson,
      source: items.source,
      fillError: items.fillError,
      templateCount: items.templateCount,
      templateIds: items.templateIds,
      createdAt: k.createdAt,
    });
  }
  for (const kit of latestByStage.values()) kits.push(kit);
  const hasLaunchKit = kits.some(
    (k) => k.stage === "launch" || k.stage === "weekly_refresh",
  );

  const stages = resolveUnlockedStages({
    sampleApproved: isShopKit ? true : sampleApproved,
    batchOrdered: isShopKit ? true : batchOrdered,
    batchArrivedReady: isShopKit ? true : batchArrivedReady,
    hasLaunchKit,
  });

  const currentStage = resolveDefaultFocusStage({
    primaryState: isShopKit ? "selling" : primaryState,
    sampleApproved: isShopKit ? true : sampleApproved,
    batchOrdered: isShopKit ? true : batchOrdered,
    batchArrivedReady: isShopKit ? true : batchArrivedReady,
    stages,
    sideStage: isShopKit ? "none" : skuMarketingStage,
  });

  const launchAckNeeded = !kits.some((k) => k.stage === "launch");
  const batchArrivalEta = resolveBatchArrivalEta(
    journeyFlags.batchArrivalEta,
  );

  const margins = await resolveMarginsForKitContext({
    workspaceId,
    isShopKit,
    sku: sku ?? null,
    monthlyFollowOnBudget: onboarding?.monthlyFollowOnBudget ?? 0,
  });
  const needsMarginAck = needsMarginAckForPaidUi({
    marginBefore: margins.before,
    marginAfter: margins.after,
  });

  const geminiCapReached = await isMarketingGeminiCapReached(workspaceId);

  let photoPacks: PhotoPackOption[] = [];
  let creativePackChoices: CreativePackChoice[] = [];
  let creativeVisuals: CreativeVisualFileView[] = [];
  if (!isShopKit && selectedSkuId) {
    const listed = await listPhotoPacksForSku(workspaceId, selectedSkuId);
    photoPacks = listed.ok ? listed.value : [];
    creativePackChoices = await listCreativePackChoices(
      workspaceId,
      selectedSkuId,
      kits.map((k) => k.id),
    );
    creativeVisuals = await listCreativeVisualFiles(
      workspaceId,
      selectedSkuId,
      kits.map((k) => k.id),
    );
  }

  return {
    currentStage,
    capacityTier: capacityTierFor(onboarding?.hoursPerWeek ?? 8),
    stages,
    kits,
    maxDailyPaid: PRE_LAUNCH_MAX_DAILY_AD_SPEND,
    whatsappSet: !!store?.whatsappNumber,
    launchAckNeeded,
    batchArrivalEta,
    selectedSkuId,
    liveSkus: live.map((s) => ({ id: s.id, name: s.name })),
    shopKitAvailable,
    isShopKit,
    selectedCategory: isShopKit ? "multi" : (sku?.basics.category ?? ""),
    geminiConfigured: isGeminiConfigured(),
    geminiCapReached,
    needsMarginAck,
    photoPacks,
    creativePackChoices,
    creativeVisuals,
    visualGenReady: isMarketingVisualGenReady(),
  };
}

// ---------------------------------------------------------------------------
// Generate / refresh / edit
// ---------------------------------------------------------------------------

export type GenerateKitResult =
  | { ok: true }
  | { ok: false; error: "not_found" | "stage_locked" | "needs_launch_ack" };

export type ContinueCreativesFillResult =
  | { ok: true }
  | { ok: false; error: "not_found" | "not_partial" | "still_leftover" };

async function runCreativesGeminiPasses(args: {
  workspaceId: string;
  input: BuildCreativesInput;
  kit: Creative[];
  /** When set, skip the first week-chunk pass and retry only these leftover ids. */
  onlyIds?: string[];
  /** All leftover ids (not yet Gemini). Defaults to onlyIds so one-card fill does not mark the rest as Gemini. */
  leftoverIds?: string[];
}): Promise<{
  creatives: Creative[];
  geminiIds: Set<string>;
  lastError?: string;
}> {
  const { workspaceId, input, kit, onlyIds, leftoverIds } = args;
  let creatives = kit;
  const leftoverOnly = new Set(onlyIds ?? []);
  const stillLeftover = new Set(leftoverIds ?? onlyIds ?? []);
  const geminiIds = new Set(
    onlyIds || leftoverIds
      ? kit.filter((c) => !stillLeftover.has(c.id)).map((c) => c.id)
      : [],
  );
  let lastError: string | undefined;
  const llm = getMarketingLlmProvider();

  const runChunks = async (chunks: Creative[][]) => {
    for (const chunk of chunks) {
      const allowance = await checkMarketingGeminiAllowance(workspaceId);
      if (!allowance.ok) {
        lastError = "monthly_cap";
        break;
      }
      const filled = await llm.improveCreativesKit(input, chunk, {
        retryNote: undefined,
      });
      if (filled.ok) {
        const chunkIds = chunk.map((c) => c.id);
        creatives = mergeLeftoverFills(creatives, filled.creatives, chunkIds);
        for (const c of filled.creatives) {
          if (chunkIds.includes(c.id)) geminiIds.add(c.id);
        }
        await recordMarketingGeminiCalls({ workspaceId, calls: 1 });
        if (filled.rejectedIds.length) {
          lastError = filled.lastError ?? lastError;
        }
      } else {
        lastError = filled.error;
        if (filled.error === "missing_key") break;
      }
    }
  };

  if (!onlyIds) {
    const chunks = shouldChunkCreativesKit(input.stage, kit.length)
      ? chunkCreativesForGemini(kit)
      : [kit];
    await runChunks(chunks);
  }

  const leftovers = creatives.filter((c) =>
    onlyIds ? leftoverOnly.has(c.id) && !geminiIds.has(c.id) : !geminiIds.has(c.id),
  );
  if (
    leftovers.length > 0 &&
    lastError !== "missing_key" &&
    lastError !== "monthly_cap"
  ) {
    await runChunks(leftoverRetryChunks(leftovers));
  }

  return { creatives, geminiIds, lastError };
}

export async function generateKit(
  workspaceId: string,
  stageInput: MarketingStage | string,
  launchBudgetAck: boolean,
  skuId?: string | null,
  opts?: { weeklyAdvance?: boolean },
): Promise<GenerateKitResult> {
  await ensureMigrated();
  const stage = normalizeMarketingStage(stageInput);
  const scope = parseGenerateKitSkuScope(skuId);
  if (!scope.ok) return { ok: false, error: "not_found" };

  if (scope.skuId !== null) {
    const owned = await assertSkuOwned(workspaceId, scope.skuId);
    if (!owned.ok) return { ok: false, error: "not_found" };
  }

  const panel = await getMarketingPanel(workspaceId, scope.skuId);
  if (!panel) return { ok: false, error: "not_found" };

  const isShopKit = panel.isShopKit;
  const sku = isShopKit
    ? null
    : panel.selectedSkuId
      ? await getSkuViewById(workspaceId, panel.selectedSkuId)
      : null;
  if (!isShopKit && !sku) return { ok: false, error: "not_found" };
  // Explicit SKU scope must not resolve to a different product via read fallbacks.
  if (scope.skuId !== null && panel.selectedSkuId !== scope.skuId) {
    return { ok: false, error: "not_found" };
  }

  const info = panel.stages.find((s) => s.stage === stage);
  if (!info || !info.unlocked) return { ok: false, error: "stage_locked" };

  // Launch and weekly refresh require a budget-rules acknowledgement
  // the first time, via side-only start_launch_marketing.
  const needsAck =
    (stage === "launch" || stage === "weekly_refresh") &&
    panel.launchAckNeeded;
  if (needsAck) {
    if (!launchBudgetAck) return { ok: false, error: "needs_launch_ack" };
    const approval = await createApprovalRequest(
      workspaceId,
      "start_launch_marketing",
      { data: { stage }, skuId: panel.selectedSkuId },
    );
    if (approval) {
      await decideApproval(approval.id, {
        type: "approve",
        acknowledgements: ["budget_rules_ack"],
      });
    }
  }

  // Intro AI is per-SKU only — never whole-shop Intro (Wave 4).
  if (stage === "intro_pdf" && isShopKit) {
    return { ok: false, error: "not_found" };
  }

  // At most one kit per workspace + SKU + stage — replace, never stack.
  // Intro may regenerate (Wave 4) so founders can retry AI fill after template fallback.
  // Dual-read legacy monthly_refresh rows when writing weekly_refresh.
  const stageClause =
    stage === "weekly_refresh"
      ? inArray(schema.marketingKits.stage, [
          "weekly_refresh",
          LEGACY_MONTHLY_REFRESH_STAGE,
        ])
      : eq(schema.marketingKits.stage, stage);

  const existingQuery = isShopKit
    ? and(
        eq(schema.marketingKits.workspaceId, workspaceId),
        isNull(schema.marketingKits.skuId),
        stageClause,
      )
    : and(
        eq(schema.marketingKits.workspaceId, workspaceId),
        eq(schema.marketingKits.skuId, sku!.id),
        stageClause,
      );

  const existing = await db
    .select()
    .from(schema.marketingKits)
    .where(existingQuery)
    .orderBy(asc(schema.marketingKits.createdAt))
    ;

  const now = nowIso();
  const varianceSeed =
    Date.now() ^ (existing.length > 0 ? existing.length * 7919 : 1);
  const creativeStage =
    stage === "pre_launch" ||
    stage === "launch" ||
    stage === "weekly_refresh"
      ? stage
      : null;
  const eta = panel.batchArrivalEta;

  const productName = isShopKit
    ? "Whole shop"
    : sku!.name;
  const category = isShopKit ? "multi" : sku!.basics.category;
  const hooks = isShopKit
    ? ["@hooks.localAngle"]
    : sku!.marketingHooks.hooks;
  const differentiation = isShopKit
    ? "multi-SKU shop"
    : sku!.basics.differentiation;

  let kitSource: CreativesKitSource | undefined;
  let introFillError: string | undefined;
  let itemsJson: string;
  let creativeCount = 0;

  if (stage === "intro_pdf") {
    const introInput = {
      name: productName,
      category,
      differentiation,
      hooks,
    };
    // Approach A: Gemini on Generate lesson only; fail closed → template.
    // Phase 7: monthly Marketing Gemini cap (not Store).
    const allowance = await checkMarketingGeminiAllowance(workspaceId);
    if (!allowance.ok) {
      const lesson = buildIntroLesson(introInput);
      kitSource = "template";
      introFillError = "monthly_cap";
      itemsJson = JSON.stringify(lesson);
    } else {
      const llm = getMarketingLlmProvider();
      const filled = await llm.fillIntroLessonBodies(introInput);
      let lesson: IntroLessonPayload;
      if (filled.ok) {
        lesson = filled.lesson;
        kitSource = "gemini";
        await recordMarketingGeminiCalls({ workspaceId, calls: 1 });
      } else {
        lesson = buildIntroLesson(introInput);
        kitSource = "template";
        introFillError = filled.error;
      }
      itemsJson = JSON.stringify(lesson);
    }
  } else if (creativeStage) {
    const existingItems = existing[existing.length - 1]
      ? parseKitItems(existing[existing.length - 1]!.items)
      : null;
    const weeklyArgs =
      creativeStage === "weekly_refresh"
        ? weeklyRefreshGenerateArgs({
            weeklyAdvance: opts?.weeklyAdvance,
            existingWeeklyWeek: existingItems?.weeklyWeek || null,
            existingCreatives:
              existingItems?.kind === "creatives"
                ? existingItems.creatives
                : [],
          })
        : null;
    const weeklyWeek = weeklyArgs?.weeklyWeek;
    const creativeInput = {
      name: productName,
      category,
      hooks,
      stage: creativeStage,
      capacityTier: panel.capacityTier,
      varianceSeed,
      weekCount: creativeStage === "pre_launch" ? eta.weekCount : undefined,
      weeklyWeek,
      ...(weeklyArgs?.previousWeekHooks
        ? { previousWeekHooks: weeklyArgs.previousWeekHooks }
        : {}),
    };
    const skeleton = buildCreatives(creativeInput);
    const filled = await runCreativesGeminiPasses({
      workspaceId,
      input: creativeInput,
      kit: skeleton,
    });
    const payload = creativesKitPayloadFromFill({
      creatives: filled.creatives,
      geminiIds: filled.geminiIds,
      lastError: filled.lastError,
      weeklyWeek,
    });
    kitSource = payload.source;
    creativeCount = payload.creatives.length;
    itemsJson = serializeCreativesKit(payload);
  } else {
    itemsJson = "[]";
  }

  const capacityTier = String(panel.capacityTier);

  if (existing.length > 0) {
    const keep = existing[existing.length - 1]!;
    await db
      .update(schema.marketingKits)
      .set({
        stage,
        capacityTier,
        items: itemsJson,
        language: "both",
        updatedAt: now,
      })
      .where(eq(schema.marketingKits.id, keep.id));

    const extras = existing.slice(0, -1).map((r) => r.id);
    if (extras.length > 0) {
      await db
        .delete(schema.marketingKits)
        .where(inArray(schema.marketingKits.id, extras));
    }
  } else {
    await db.insert(schema.marketingKits).values({
      id: newId(),
      workspaceId,
      skuId: isShopKit ? null : sku!.id,
      stage,
      capacityTier,
      items: itemsJson,
      language: "both",
      createdAt: now,
      updatedAt: now,
    });
  }

  if (sku) {
    await patchSkuJourneyFlags(sku.id, { marketingStage: stage });
  }
  // Workspace sideStatuses mirror only for shop kit / single-SKU legacy —
  // multi-SKU reads use skuJourneys.marketingStage only.
  if (isShopKit || panel.liveSkus.length <= 1) {
    await db
      .update(schema.sideStatuses)
      .set({ marketingStage: stage, updatedAt: now })
      .where(eq(schema.sideStatuses.workspaceId, workspaceId));
  }

  const replaced = existing.length > 0;
  const message =
    stage === "intro_pdf"
      ? `Generated intro lesson for ${productName}`
      : `${replaced ? "Replaced" : "Generated"} ${stage} kit (${creativeCount} creatives)`;

  await db.insert(schema.orchestratorEvents).values({
    id: newId(),
    workspaceId,
    kind: "marketing_kit",
    message,
    meta: JSON.stringify({
      stage,
      kind: stage === "intro_pdf" ? "intro_lesson" : "creatives",
      replaced,
      skuId: panel.selectedSkuId,
      shopKit: isShopKit,
      ...(kitSource ? { kitSource } : {}),
      ...(introFillError ? { introFillError } : {}),
    }),
    createdAt: now,
  });

  return { ok: true };
}

/**
 * Try AI fill on leftover ids only (kit-level all leftovers, or one card).
 * Does not call buildCreatives or replace cards that already passed.
 * Full-template kits allow any saved creative id; legacy/null source is not_partial.
 */
export async function continueCreativesKitFill(
  workspaceId: string,
  kitId: string,
  templateIds: string[],
  skuId: unknown,
): Promise<ContinueCreativesFillResult> {
  await ensureMigrated();
  const scope = parseGenerateKitSkuScope(skuId);
  if (!scope.ok) return { ok: false, error: "not_found" };

  if (scope.skuId !== null) {
    const owned = await assertSkuOwned(workspaceId, scope.skuId);
    if (!owned.ok) return { ok: false, error: "not_found" };
  }

  const kit = await db
    .select()
    .from(schema.marketingKits)
    .where(eq(schema.marketingKits.id, kitId))
    .then((rows) => rows[0]);
  if (!kit || kit.workspaceId !== workspaceId) {
    return { ok: false, error: "not_found" };
  }
  if (scope.skuId === null) {
    if (kit.skuId !== null) return { ok: false, error: "not_found" };
  } else if (kit.skuId !== scope.skuId) {
    return { ok: false, error: "not_found" };
  }

  const stage = normalizeMarketingStage(kit.stage);
  if (
    stage !== "pre_launch" &&
    stage !== "launch" &&
    stage !== "weekly_refresh"
  ) {
    return { ok: false, error: "not_found" };
  }

  const prev = parseKitItems(kit.items);
  if (prev.kind !== "creatives" || prev.creatives.length === 0) {
    return { ok: false, error: "not_found" };
  }
  const allowed = resolveContinueFillAllowList({
    source: prev.source,
    templateIds: prev.templateIds,
    creativeIds: prev.creatives.map((c) => c.id),
  });
  if (!allowed || allowed.length === 0) {
    return { ok: false, error: "not_partial" };
  }
  const allowedSet = new Set(allowed);
  const targetIds = templateIds.filter(
    (id) => typeof id === "string" && allowedSet.has(id),
  );
  if (targetIds.length === 0) return { ok: false, error: "not_partial" };

  const panel = await getMarketingPanel(workspaceId, scope.skuId);
  if (!panel) return { ok: false, error: "not_found" };
  const isShopKit = panel.isShopKit;
  const sku = isShopKit
    ? null
    : panel.selectedSkuId
      ? await getSkuViewById(workspaceId, panel.selectedSkuId)
      : null;
  if (!isShopKit && !sku) return { ok: false, error: "not_found" };
  if (scope.skuId !== null && panel.selectedSkuId !== scope.skuId) {
    return { ok: false, error: "not_found" };
  }

  const productName = isShopKit ? "Whole shop" : sku!.name;
  const category = isShopKit ? "multi" : sku!.basics.category;
  const hooks = isShopKit ? ["@hooks.localAngle"] : sku!.marketingHooks.hooks;
  const weeklyWeek =
    stage === "weekly_refresh"
      ? resolveWeeklyKitWeek({
          weeklyWeek: prev.weeklyWeek || null,
          creatives: prev.creatives,
        })
      : undefined;
  const creativeInput: BuildCreativesInput = {
    name: productName,
    category,
    hooks,
    stage,
    capacityTier: panel.capacityTier,
    varianceSeed: 1,
    weekCount: stage === "pre_launch" ? panel.batchArrivalEta.weekCount : undefined,
    weeklyWeek,
  };

  const filled = await runCreativesGeminiPasses({
    workspaceId,
    input: creativeInput,
    kit: prev.creatives,
    onlyIds: targetIds,
    leftoverIds: allowed,
  });
  const payload = creativesKitPayloadFromFill({
    creatives: filled.creatives,
    geminiIds: filled.geminiIds,
    lastError: filled.lastError,
    weeklyWeek,
  });

  const now = nowIso();
  await db
    .update(schema.marketingKits)
    .set({
      items: serializeCreativesKit(payload),
      updatedAt: now,
    })
    .where(eq(schema.marketingKits.id, kit.id));

  await db.insert(schema.orchestratorEvents).values({
    id: newId(),
    workspaceId,
    kind: "marketing_kit",
    message: `Continued AI fill for ${productName} (${targetIds.length} leftover cards)`,
    meta: JSON.stringify({
      stage,
      kind: "creatives",
      continued: true,
      skuId: panel.selectedSkuId,
      shopKit: isShopKit,
      kitSource: payload.source,
      leftoverCount: targetIds.length,
    }),
    createdAt: now,
  });

  if (continueFillStillLeftover(targetIds, filled.geminiIds)) {
    return { ok: false, error: "still_leftover" };
  }
  return { ok: true };
}

export async function saveKitCreatives(
  workspaceId: string,
  kitId: string,
  creatives: Creative[],
): Promise<{ ok: boolean; error?: string }> {
  await ensureMigrated();
  const kit = await db
    .select()
    .from(schema.marketingKits)
    .where(eq(schema.marketingKits.id, kitId))
    .then((rows) => rows[0]);
  if (!kit || kit.workspaceId !== workspaceId) {
    return { ok: false, error: "not_found" };
  }
  // Preserve wrapped kit + source so AI/template honesty survives founder edits.
  const prev = parseKitItems(kit.items);
  const source =
    prev.source === "gemini" ||
    prev.source === "template" ||
    prev.source === "partial"
      ? prev.source
      : "template";
  await founderEditMarketingKit(kitId, {
    items: serializeCreativesKit({
      kind: "creatives",
      source,
      creatives,
      fillError: prev.fillError,
      templateCount: prev.templateCount || undefined,
      templateIds: prev.templateIds.length ? prev.templateIds : undefined,
      weeklyWeek: prev.weeklyWeek || undefined,
    }),
  });
  return { ok: true };
}

export { MARKETING_CAPACITY_TIERS };
