/**
 * AI fill for creative kit text fields (Wave 4 Phase 3).
 * Skeleton (ids/format/week/schedule) stays from buildCreatives; Gemini fills copy.
 */

import {
  creativesHaveCodPitch,
  launchWeekPhase,
  normalizeCreative,
  preLaunchHasForbiddenPitch,
  shotLooksActionable,
  type BuildCreativesInput,
  type Creative,
} from "@/lib/marketing/creatives";
import { nicheFor, usefulHookLine } from "@/lib/marketing/brief";

export type CreativesKitSource = "gemini" | "template" | "partial";

export type CreativesKitPayload = {
  kind: "creatives";
  source: CreativesKitSource;
  creatives: Creative[];
  /** Last chunk/one-shot fail reason (founder banner). Omitted on full Gemini. */
  fillError?: string | null;
  /** Cards that kept skeleton copy when source is partial. */
  templateCount?: number;
  /** Leftover skeleton ids (Try AI fill again on partial). */
  templateIds?: string[];
  /** weekly_refresh selling-week number (legacy missing → treat as 1). */
  weeklyWeek?: number;
};

/** Max creatives per Gemini call when week groups are larger than this. */
export const CREATIVES_GEMINI_CHUNK_MAX = 4;

export function shouldChunkCreativesKit(
  stage: BuildCreativesInput["stage"],
  creativeCount: number,
): boolean {
  if (stage === "launch" || stage === "weekly_refresh") {
    return creativeCount > 0;
  }
  // Pre-launch stays one-shot unless the kit is larger than a typical 4/6.
  return stage === "pre_launch" && creativeCount > 6;
}

function splitMax(list: Creative[], max: number): Creative[][] {
  if (list.length <= max) return list.length ? [list] : [];
  const out: Creative[][] = [];
  for (let i = 0; i < list.length; i += max) {
    out.push(list.slice(i, i + max));
  }
  return out;
}

/** Prefer weekIndex groups; split any group larger than CREATIVES_GEMINI_CHUNK_MAX. */
export function chunkCreativesForGemini(skeleton: Creative[]): Creative[][] {
  if (skeleton.length === 0) return [];
  const weekPhased = skeleton.some((c) => c.weekIndex > 0);
  if (weekPhased) {
    const weeks = new Map<number, Creative[]>();
    for (const c of skeleton) {
      const key = c.weekIndex > 0 ? c.weekIndex : 0;
      const list = weeks.get(key) ?? [];
      list.push(c);
      weeks.set(key, list);
    }
    return [...weeks.entries()]
      .sort((a, b) => a[0] - b[0])
      .flatMap(([, list]) => splitMax(list, CREATIVES_GEMINI_CHUNK_MAX));
  }
  return splitMax(skeleton, CREATIVES_GEMINI_CHUNK_MAX);
}

export function mergeCreativeChunk(
  kit: Creative[],
  chunkFilled: Creative[],
): Creative[] {
  const byId = new Map(chunkFilled.map((c) => [c.id, c]));
  return kit.map((c) => byId.get(c.id) ?? c);
}

/** Max cards per leftover Gemini call. First-pass chunks stay max 4. */
export const CREATIVES_LEFTOVER_RETRY_MAX = 1;

export function leftoverRetryChunks(leftovers: Creative[]): Creative[][] {
  return splitMax(leftovers, CREATIVES_LEFTOVER_RETRY_MAX);
}

/** Merge accepted leftover fills only — never replace cards outside leftoverIds. */
export function mergeLeftoverFills(
  existing: Creative[],
  accepted: Creative[],
  leftoverIds: readonly string[],
): Creative[] {
  const allowed = new Set(leftoverIds);
  return mergeCreativeChunk(
    existing,
    accepted.filter((c) => allowed.has(c.id)),
  );
}

export function creativesKitPayloadFromFill(args: {
  creatives: Creative[];
  geminiIds: ReadonlySet<string>;
  lastError?: string;
  weeklyWeek?: number;
}): CreativesKitPayload {
  const templateIds = args.creatives
    .filter((c) => !args.geminiIds.has(c.id))
    .map((c) => c.id);
  const source = resolveCreativesKitFillSource(
    args.creatives.length - templateIds.length,
    args.creatives.length,
  );
  const weeklyWeek =
    typeof args.weeklyWeek === "number" && Number.isFinite(args.weeklyWeek)
      ? Math.max(1, Math.round(args.weeklyWeek))
      : undefined;
  return {
    kind: "creatives",
    source,
    creatives: args.creatives,
    fillError: source === "gemini" ? undefined : args.lastError,
    templateCount: templateIds.length > 0 ? templateIds.length : undefined,
    templateIds: templateIds.length > 0 ? templateIds : undefined,
    weeklyWeek,
  };
}

/** Current weekly kit week: payload.weeklyWeek ?? max weekIndex ?? 1. */
export function resolveWeeklyKitWeek(args: {
  weeklyWeek?: number | null;
  creatives: { weekIndex: number }[];
}): number {
  if (
    typeof args.weeklyWeek === "number" &&
    Number.isFinite(args.weeklyWeek) &&
    args.weeklyWeek >= 1
  ) {
    return Math.round(args.weeklyWeek);
  }
  let max = 0;
  for (const c of args.creatives) {
    if (typeof c.weekIndex === "number" && c.weekIndex > max) {
      max = c.weekIndex;
    }
  }
  return max >= 1 ? max : 1;
}

/** First generate → 1. Regenerate → same week. Move → week + 1. */
export function resolveNextWeeklyWeek(args: {
  hasExistingKit: boolean;
  weeklyAdvance?: boolean;
  weeklyWeek?: number | null;
  creatives: { weekIndex: number }[];
}): number {
  if (!args.hasExistingKit) return 1;
  const current = resolveWeeklyKitWeek({
    weeklyWeek: args.weeklyWeek,
    creatives: args.creatives,
  });
  return args.weeklyAdvance ? current + 1 : current;
}

/** hookEn + angleEn from the kit being replaced (Move only). */
export function previousWeekHooksFromCreatives(
  creatives: Array<{ hookEn?: string; angleEn?: string }>,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const c of creatives) {
    for (const line of [c.hookEn, c.angleEn]) {
      const t = line?.trim();
      if (!t) continue;
      const key = t.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(t);
    }
  }
  return out;
}

/**
 * weekly_refresh generate args.
 * Regenerate: same week, no previousWeekHooks.
 * Move: next week + previous hooks from the kit being replaced.
 */
export function weeklyRefreshGenerateArgs(args: {
  weeklyAdvance?: boolean;
  existingWeeklyWeek?: number | null;
  existingCreatives: Array<{
    hookEn?: string;
    angleEn?: string;
    weekIndex?: number;
  }>;
}): { weeklyWeek: number; previousWeekHooks?: string[] } {
  const hasExistingKit = args.existingCreatives.length > 0;
  const weeklyWeek = resolveNextWeeklyWeek({
    hasExistingKit,
    weeklyAdvance: args.weeklyAdvance,
    weeklyWeek: args.existingWeeklyWeek ?? null,
    creatives: args.existingCreatives.map((c) => ({
      weekIndex: typeof c.weekIndex === "number" ? c.weekIndex : 0,
    })),
  });
  if (!args.weeklyAdvance || !hasExistingKit) {
    return { weeklyWeek };
  }
  const previousWeekHooks = previousWeekHooksFromCreatives(
    args.existingCreatives,
  );
  return previousWeekHooks.length
    ? { weeklyWeek, previousWeekHooks }
    : { weeklyWeek };
}

/**
 * Leftover ids continueFill may touch. Null = not_partial (do not guess).
 * partial + stored templateIds → those ids only.
 * template (complete fail) → every saved creative id.
 */
export function resolveContinueFillAllowList(args: {
  source: CreativesKitSource | null;
  templateIds: readonly string[];
  creativeIds: readonly string[];
}): string[] | null {
  if (args.source === "partial" && args.templateIds.length > 0) {
    const known = new Set(args.creativeIds);
    return args.templateIds.filter((id) => known.has(id));
  }
  if (args.source === "template" && args.creativeIds.length > 0) {
    return [...args.creativeIds];
  }
  return null;
}

export function resolveCreativesKitFillSource(
  geminiCount: number,
  total: number,
): CreativesKitSource {
  if (total <= 0 || geminiCount <= 0) return "template";
  if (geminiCount >= total) return "gemini";
  return "partial";
}

/** i18n key for a calm founder reason — never dump the raw enum as the only text. */
export function creativesFillReasonI18nKey(
  error: string | null | undefined,
): string | null {
  switch (error) {
    case "shots_too_thin":
      return "kitAiReasonShots";
    case "too_short":
      return "kitAiReasonShort";
    case "cod_pitch":
      return "kitAiReasonCod";
    case "pre_launch_forbidden":
      return "kitAiReasonPreLaunch";
    case "missing_product_name":
      return "kitAiReasonName";
    case "api_error":
      return "kitAiReasonApi";
    case "empty":
    case "parse_error":
    case "invalid_shape":
    case "id_mismatch":
      return "kitAiReasonIncomplete";
    default:
      return null;
  }
}

function parseCreativesKitSource(raw: unknown): CreativesKitSource | null {
  if (raw === "gemini" || raw === "template" || raw === "partial") return raw;
  return null;
}

export type CreativeTextFill = {
  id: string;
  hookEn: string;
  hookAr: string;
  angleEn: string;
  angleAr: string;
  captionEn: string;
  captionAr: string;
  shots: string[];
  howToShootEn: string;
  howToShootAr: string;
  seriesLabelEn: string;
  seriesLabelAr: string;
  whyEn: string;
  whyAr: string;
};

export type CreativesValidateError =
  | "invalid_shape"
  | "id_mismatch"
  | "too_short"
  | "shots_too_thin"
  | "cod_pitch"
  | "pre_launch_forbidden"
  | "missing_product_name";

const TEXT_MIN = 8;
export const SHOT_MIN = 28;
const HOW_TO_MIN = 24;

function isNonEmpty(s: unknown, min = TEXT_MIN): s is string {
  return typeof s === "string" && s.trim().length >= min;
}

function shotsAreActionable(shots: string[]): boolean {
  const cleaned = shots.map((s) => s.trim()).filter(Boolean);
  if (cleaned.length < 3 || cleaned.length > 5) return false;
  return cleaned.every(
    (s) => s.length >= SHOT_MIN && shotLooksActionable(s),
  );
}

export function buildCreativesFactsPack(input: BuildCreativesInput) {
  const name = input.name.trim() || "your product";
  const category = input.category.trim();
  const niche = nicheFor(category);
  const hook = usefulHookLine(input.hooks, name);
  const weeklyWeek =
    input.stage === "weekly_refresh"
      ? Math.max(1, Math.round(input.weeklyWeek ?? 1))
      : null;
  const weekPhase =
    input.stage === "weekly_refresh"
      ? launchWeekPhase(weeklyWeek ?? 1)
      : null;
  const previousWeekHooks = (input.previousWeekHooks ?? [])
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    productName: name,
    category: category || "unknown",
    stage: input.stage,
    capacityTier: input.capacityTier,
    weekCount: input.weekCount ?? null,
    weeklyWeek,
    weekPhase,
    ...(previousWeekHooks.length ? { previousWeekHooks } : {}),
    hookLine: hook,
    niche: {
      worldEn: niche.worldEn,
      worldAr: niche.worldAr,
      seriesShortEn: niche.seriesShortEn,
      seriesShortAr: niche.seriesShortAr,
    },
    rules: {
      noCodWow: true,
      noRoasOrFinanceAdvice: true,
      preLaunchSoftOnly: input.stage === "pre_launch",
      whatsappOrderOk:
        input.stage === "launch" || input.stage === "weekly_refresh",
    },
  };
}

export function applyOneCreativeFill(
  skeleton: Creative,
  fill: CreativeTextFill,
):
  | { ok: true; creative: Creative }
  | { ok: false; error: CreativesValidateError } {
  if (
    !isNonEmpty(fill.hookEn) ||
    !isNonEmpty(fill.hookAr) ||
    !isNonEmpty(fill.angleEn) ||
    !isNonEmpty(fill.angleAr) ||
    !isNonEmpty(fill.captionEn) ||
    !isNonEmpty(fill.captionAr) ||
    !isNonEmpty(fill.seriesLabelEn, 3) ||
    !isNonEmpty(fill.seriesLabelAr, 3) ||
    !isNonEmpty(fill.whyEn) ||
    !isNonEmpty(fill.whyAr) ||
    !isNonEmpty(fill.howToShootEn, HOW_TO_MIN) ||
    !isNonEmpty(fill.howToShootAr, HOW_TO_MIN)
  ) {
    return { ok: false, error: "too_short" };
  }
  if (!Array.isArray(fill.shots) || !shotsAreActionable(fill.shots)) {
    return { ok: false, error: "shots_too_thin" };
  }
  return {
    ok: true,
    creative: {
      ...skeleton,
      hookEn: fill.hookEn.trim(),
      hookAr: fill.hookAr.trim(),
      angleEn: fill.angleEn.trim(),
      angleAr: fill.angleAr.trim(),
      captionEn: fill.captionEn.trim(),
      captionAr: fill.captionAr.trim(),
      seriesLabelEn: fill.seriesLabelEn.trim(),
      seriesLabelAr: fill.seriesLabelAr.trim(),
      whyEn: fill.whyEn.trim(),
      whyAr: fill.whyAr.trim(),
      howToShootEn: fill.howToShootEn.trim(),
      howToShootAr: fill.howToShootAr.trim(),
      shots: fill.shots
        .filter((s): s is string => typeof s === "string")
        .map((s) => s.trim())
        .filter(Boolean),
    },
  };
}

/**
 * Merge AI text fills onto skeleton creatives (structure locked).
 * All-or-nothing — one thin shot rejects the whole set.
 */
export function applyCreativeTextFills(
  skeleton: Creative[],
  fills: CreativeTextFill[],
):
  | { ok: true; creatives: Creative[] }
  | { ok: false; error: CreativesValidateError } {
  if (!Array.isArray(fills) || fills.length !== skeleton.length) {
    return { ok: false, error: "invalid_shape" };
  }
  const byId = new Map(fills.map((f) => [f.id, f]));
  const out: Creative[] = [];
  for (const sk of skeleton) {
    const f = byId.get(sk.id);
    if (!f) return { ok: false, error: "id_mismatch" };
    const applied = applyOneCreativeFill(sk, f);
    if (!applied.ok) return applied;
    out.push(applied.creative);
  }
  return { ok: true, creatives: out };
}

export function validateFilledCreatives(
  creatives: Creative[],
  stage: BuildCreativesInput["stage"],
  productName: string,
):
  | { ok: true }
  | { ok: false; error: CreativesValidateError } {
  if (!creatives.length) return { ok: false, error: "invalid_shape" };
  const name = productName.trim() || "your product";
  const named = creatives.some(
    (c) =>
      c.hookEn.includes(name) ||
      c.angleEn.includes(name) ||
      c.captionEn.includes(name),
  );
  if (!named) return { ok: false, error: "missing_product_name" };
  for (const c of creatives) {
    if (!shotsAreActionable(c.shots)) {
      return { ok: false, error: "shots_too_thin" };
    }
    if (
      !c.howToShootEn.trim() ||
      c.howToShootEn.trim().length < HOW_TO_MIN ||
      !c.howToShootAr.trim() ||
      c.howToShootAr.trim().length < HOW_TO_MIN
    ) {
      return { ok: false, error: "too_short" };
    }
  }
  if (creativesHaveCodPitch(creatives)) {
    return { ok: false, error: "cod_pitch" };
  }
  if (stage === "pre_launch" && preLaunchHasForbiddenPitch(creatives)) {
    return { ok: false, error: "pre_launch_forbidden" };
  }
  return { ok: true };
}

export function validateOneFilledCreative(
  creative: Creative,
  stage: BuildCreativesInput["stage"],
  productName: string,
):
  | { ok: true }
  | { ok: false; error: CreativesValidateError } {
  return validateFilledCreatives([creative], stage, productName);
}

/**
 * Keep cards that pass locks; rejects stay on the skeleton.
 * Does not discard a whole chunk because one shot list was thin.
 */
export function acceptCreativeFillsPerCard(
  skeleton: Creative[],
  fills: CreativeTextFill[],
  stage: BuildCreativesInput["stage"],
  productName: string,
): {
  accepted: Creative[];
  rejectedIds: string[];
  lastError: CreativesValidateError | null;
} {
  const byId = new Map(
    Array.isArray(fills) ? fills.map((f) => [f.id, f]) : [],
  );
  const accepted: Creative[] = [];
  const rejectedIds: string[] = [];
  let lastError: CreativesValidateError | null = null;

  for (const sk of skeleton) {
    const f = byId.get(sk.id);
    if (!f) {
      rejectedIds.push(sk.id);
      lastError = "id_mismatch";
      continue;
    }
    const applied = applyOneCreativeFill(sk, f);
    if (!applied.ok) {
      rejectedIds.push(sk.id);
      lastError = applied.error;
      continue;
    }
    const validated = validateOneFilledCreative(
      applied.creative,
      stage,
      productName,
    );
    if (!validated.ok) {
      rejectedIds.push(sk.id);
      lastError = validated.error;
      continue;
    }
    accepted.push(applied.creative);
  }
  return { accepted, rejectedIds, lastError };
}

export function parseCreativeTextFills(raw: unknown): CreativeTextFill[] | null {
  if (!raw || typeof raw !== "object") return null;
  const sections = (raw as { creatives?: unknown }).creatives;
  if (!Array.isArray(sections)) return null;
  const out: CreativeTextFill[] = [];
  for (const row of sections) {
    if (!row || typeof row !== "object") return null;
    const r = row as Record<string, unknown>;
    if (typeof r.id !== "string") return null;
    if (
      typeof r.hookEn !== "string" ||
      typeof r.hookAr !== "string" ||
      typeof r.angleEn !== "string" ||
      typeof r.angleAr !== "string" ||
      typeof r.captionEn !== "string" ||
      typeof r.captionAr !== "string" ||
      typeof r.seriesLabelEn !== "string" ||
      typeof r.seriesLabelAr !== "string" ||
      typeof r.whyEn !== "string" ||
      typeof r.whyAr !== "string" ||
      typeof r.howToShootEn !== "string" ||
      typeof r.howToShootAr !== "string" ||
      !Array.isArray(r.shots)
    ) {
      return null;
    }
    out.push({
      id: r.id,
      hookEn: r.hookEn,
      hookAr: r.hookAr,
      angleEn: r.angleEn,
      angleAr: r.angleAr,
      captionEn: r.captionEn,
      captionAr: r.captionAr,
      seriesLabelEn: r.seriesLabelEn,
      seriesLabelAr: r.seriesLabelAr,
      whyEn: r.whyEn,
      whyAr: r.whyAr,
      howToShootEn: r.howToShootEn,
      howToShootAr: r.howToShootAr,
      shots: r.shots.filter((s): s is string => typeof s === "string"),
    });
  }
  return out;
}

function shotsFromUnknown(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.filter((s): s is string => typeof s === "string");
  }
  if (typeof raw === "string") {
    return raw
      .split(/\n+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

function stringOrFallback(raw: unknown, fallback: string): string {
  return typeof raw === "string" ? raw : fallback;
}

/**
 * Leftover / one-card only. Keeps a usable reply when wrapper / id / why /
 * seriesLabel is imperfect. Shot locks still run in acceptCreativeFillsPerCard.
 */
export function parseCreativeTextFillsLenient(
  raw: unknown,
  skeleton: Creative[],
): CreativeTextFill[] | null {
  if (!raw || typeof raw !== "object" || skeleton.length === 0) return null;
  const o = raw as Record<string, unknown>;
  let rows: unknown[];
  if (Array.isArray(o.creatives)) {
    rows = o.creatives;
  } else if (o.creatives && typeof o.creatives === "object") {
    rows = [o.creatives];
  } else if (typeof o.hookEn === "string" || typeof o.captionEn === "string") {
    rows = [o];
  } else {
    return null;
  }

  const out: CreativeTextFill[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    if (
      typeof r.hookEn !== "string" ||
      typeof r.hookAr !== "string" ||
      typeof r.angleEn !== "string" ||
      typeof r.angleAr !== "string" ||
      typeof r.captionEn !== "string" ||
      typeof r.captionAr !== "string"
    ) {
      continue;
    }
    const sk =
      skeleton.length === 1
        ? skeleton[0]!
        : skeleton.find((c) => c.id === r.id) ?? skeleton[i];
    if (!sk) continue;
    const id = skeleton.length === 1 ? skeleton[0]!.id : sk.id;
    out.push({
      id,
      hookEn: r.hookEn,
      hookAr: r.hookAr,
      angleEn: r.angleEn,
      angleAr: r.angleAr,
      captionEn: r.captionEn,
      captionAr: r.captionAr,
      shots: shotsFromUnknown(r.shots),
      howToShootEn: stringOrFallback(r.howToShootEn, sk.howToShootEn),
      howToShootAr: stringOrFallback(r.howToShootAr, sk.howToShootAr),
      seriesLabelEn: stringOrFallback(r.seriesLabelEn, sk.seriesLabelEn),
      seriesLabelAr: stringOrFallback(r.seriesLabelAr, sk.seriesLabelAr),
      whyEn: stringOrFallback(r.whyEn, sk.whyEn),
      whyAr: stringOrFallback(r.whyAr, sk.whyAr),
    });
  }
  return out.length > 0 ? out : null;
}

/** True when none of the requested leftover ids landed in geminiIds. */
export function continueFillStillLeftover(
  targetIds: readonly string[],
  geminiIds: ReadonlySet<string>,
): boolean {
  if (targetIds.length === 0) return true;
  return targetIds.every((id) => !geminiIds.has(id));
}

export function serializeCreativesKit(payload: CreativesKitPayload): string {
  return JSON.stringify(payload);
}

function parseTemplateIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const ids: string[] = [];
  for (const id of raw) {
    if (typeof id !== "string") continue;
    const trimmed = id.trim();
    if (trimmed) ids.push(trimmed);
  }
  return ids;
}

function parseWeeklyWeekField(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.max(1, Math.round(raw));
  }
  return 0;
}

export function parseCreativesKitItems(raw: unknown): {
  creatives: Creative[];
  source: CreativesKitSource | null;
  fillError: string | null;
  templateCount: number;
  templateIds: string[];
  weeklyWeek: number;
} | null {
  if (Array.isArray(raw)) {
    const creatives = raw
      .map(normalizeCreative)
      .filter((c): c is Creative => c !== null);
    return {
      creatives,
      source: null,
      fillError: null,
      templateCount: 0,
      templateIds: [],
      weeklyWeek: 0,
    };
  }
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.kind === "creatives" && Array.isArray(o.creatives)) {
    const creatives = o.creatives
      .map(normalizeCreative)
      .filter((c): c is Creative => c !== null);
    const source = parseCreativesKitSource(o.source);
    const fillError =
      typeof o.fillError === "string" && o.fillError.trim()
        ? o.fillError.trim()
        : null;
    const templateIds = parseTemplateIds(o.templateIds);
    const templateCount =
      typeof o.templateCount === "number" && Number.isFinite(o.templateCount)
        ? Math.max(0, Math.round(o.templateCount))
        : templateIds.length;
    return {
      creatives,
      source,
      fillError,
      templateCount,
      templateIds,
      weeklyWeek: parseWeeklyWeekField(o.weeklyWeek),
    };
  }
  return null;
}
