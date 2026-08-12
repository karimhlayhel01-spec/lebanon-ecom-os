/**
 * AI fill for creative kit text fields (Wave 4 Phase 3).
 * Skeleton (ids/format/week/schedule) stays from buildCreatives; Gemini fills copy.
 */

import {
  creativesHaveCodPitch,
  normalizeCreative,
  preLaunchHasForbiddenPitch,
  type BuildCreativesInput,
  type Creative,
} from "@/lib/marketing/creatives";
import { nicheFor, usefulHookLine } from "@/lib/marketing/brief";

export type CreativesKitSource = "gemini" | "template";

export type CreativesKitPayload = {
  kind: "creatives";
  source: CreativesKitSource;
  creatives: Creative[];
};

export type CreativeTextFill = {
  id: string;
  hookEn: string;
  hookAr: string;
  angleEn: string;
  angleAr: string;
  captionEn: string;
  captionAr: string;
  shots: string[];
  seriesLabelEn: string;
  seriesLabelAr: string;
  whyEn: string;
  whyAr: string;
};

export type CreativesValidateError =
  | "invalid_shape"
  | "id_mismatch"
  | "too_short"
  | "cod_pitch"
  | "pre_launch_forbidden"
  | "missing_product_name";

const TEXT_MIN = 8;

function isNonEmpty(s: unknown, min = TEXT_MIN): s is string {
  return typeof s === "string" && s.trim().length >= min;
}

export function buildCreativesFactsPack(input: BuildCreativesInput) {
  const name = input.name.trim() || "your product";
  const category = input.category.trim();
  const niche = nicheFor(category);
  const hook = usefulHookLine(input.hooks, name);
  return {
    productName: name,
    category: category || "unknown",
    stage: input.stage,
    capacityTier: input.capacityTier,
    weekCount: input.weekCount ?? null,
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

/**
 * Merge AI text fills onto skeleton creatives (structure locked).
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
    if (
      !isNonEmpty(f.hookEn) ||
      !isNonEmpty(f.hookAr) ||
      !isNonEmpty(f.angleEn) ||
      !isNonEmpty(f.angleAr) ||
      !isNonEmpty(f.captionEn) ||
      !isNonEmpty(f.captionAr) ||
      !isNonEmpty(f.seriesLabelEn, 3) ||
      !isNonEmpty(f.seriesLabelAr, 3) ||
      !isNonEmpty(f.whyEn) ||
      !isNonEmpty(f.whyAr)
    ) {
      return { ok: false, error: "too_short" };
    }
    if (!Array.isArray(f.shots) || f.shots.filter((s) => typeof s === "string" && s.trim()).length < 2) {
      return { ok: false, error: "too_short" };
    }
    out.push({
      ...sk,
      hookEn: f.hookEn.trim(),
      hookAr: f.hookAr.trim(),
      angleEn: f.angleEn.trim(),
      angleAr: f.angleAr.trim(),
      captionEn: f.captionEn.trim(),
      captionAr: f.captionAr.trim(),
      seriesLabelEn: f.seriesLabelEn.trim(),
      seriesLabelAr: f.seriesLabelAr.trim(),
      whyEn: f.whyEn.trim(),
      whyAr: f.whyAr.trim(),
      shots: f.shots
        .filter((s): s is string => typeof s === "string")
        .map((s) => s.trim())
        .filter(Boolean),
    });
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
  if (creativesHaveCodPitch(creatives)) {
    return { ok: false, error: "cod_pitch" };
  }
  if (stage === "pre_launch" && preLaunchHasForbiddenPitch(creatives)) {
    return { ok: false, error: "pre_launch_forbidden" };
  }
  return { ok: true };
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
      shots: r.shots.filter((s): s is string => typeof s === "string"),
    });
  }
  return out;
}

export function serializeCreativesKit(payload: CreativesKitPayload): string {
  return JSON.stringify(payload);
}

export function parseCreativesKitItems(raw: unknown): {
  creatives: Creative[];
  source: CreativesKitSource | null;
} | null {
  if (Array.isArray(raw)) {
    const creatives = raw
      .map(normalizeCreative)
      .filter((c): c is Creative => c !== null);
    return { creatives, source: null };
  }
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.kind === "creatives" && Array.isArray(o.creatives)) {
    const creatives = o.creatives
      .map(normalizeCreative)
      .filter((c): c is Creative => c !== null);
    const source =
      o.source === "gemini" || o.source === "template" ? o.source : null;
    return { creatives, source };
  }
  return null;
}
