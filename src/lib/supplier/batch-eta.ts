/**
 * Batch arrival ETA — Shared Business Memory (side_statuses.batch_arrival_eta).
 * Presets → week counts for pre-launch plan kits. Default = 1 month (4 weeks).
 *
 * Visible/editable when Marketing can use ETA (sample approved or batch ordered)
 * until the batch has arrived — so Marketing “Set ETA on Supplier” never points
 * at missing UI. Anchor: `#batch-arrival-eta`.
 */

/** Founder may set/edit ETA once sample is approved (or batch ordered) until arrival. */
export function canEditBatchArrivalEta(flags: {
  sampleApproved?: boolean;
  batchOrdered: boolean;
  batchArrivedReady: boolean;
}): boolean {
  const marketingCanUseEta = !!flags.sampleApproved || flags.batchOrdered;
  return marketingCanUseEta && !flags.batchArrivedReady;
}

/**
 * First-batch arrived / ETA must target the Supplier panel's skuId.
 * Never fall back to workspace `activeSkuId` when they differ (multi-SKU footgun).
 */
export function resolvePanelScopedSkuId(args: {
  panelSkuId: string | null | undefined;
  /** Present only to document that active must not win — intentionally unused. */
  activeSkuId?: string | null;
}): string | null {
  if (typeof args.panelSkuId !== "string") return null;
  const id = args.panelSkuId.trim();
  return id.length > 0 ? id : null;
}

export const DEFAULT_ETA_WEEKS = 4;
export const MAX_ETA_WEEKS = 8;
export const MIN_ETA_WEEKS = 1;

export const ETA_PRESETS = ["2w", "1m", "2m", "custom"] as const;
export type EtaPreset = (typeof ETA_PRESETS)[number];

/** Raw JSON stored on side_statuses when the founder sets an ETA. */
export type BatchArrivalEtaStored = {
  preset: EtaPreset;
  weeks: number;
  date?: string | null;
  label?: string | null;
};

/** Resolved view for Supplier + Marketing panels. */
export type BatchArrivalEtaView = {
  weeks: number;
  /** Same as weeks after clamp — plan week count for pre-launch kits. */
  weekCount: number;
  preset: EtaPreset | "default";
  date: string | null;
  label: string | null;
  founderSet: boolean;
  summaryEn: string;
  summaryAr: string;
};

export type SetBatchArrivalEtaInput = {
  preset: EtaPreset;
  /** Required for custom when no usable date — 1–8. */
  weeks?: number;
  /** ISO date YYYY-MM-DD for custom. */
  date?: string | null;
  label?: string | null;
};

export function clampEtaWeeks(weeks: number): number {
  if (!Number.isFinite(weeks)) return DEFAULT_ETA_WEEKS;
  return Math.min(MAX_ETA_WEEKS, Math.max(MIN_ETA_WEEKS, Math.round(weeks)));
}

export function weeksForPreset(preset: Exclude<EtaPreset, "custom">): number {
  if (preset === "2w") return 2;
  if (preset === "2m") return 8;
  return 4; // 1m
}

/** Weeks from today to a YYYY-MM-DD date (ceil), clamped. */
export function weeksUntilDate(
  dateIso: string,
  now: Date = new Date(),
): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateIso.trim());
  if (!m) return DEFAULT_ETA_WEEKS;
  const target = new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    12,
    0,
    0,
  );
  const start = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    12,
    0,
    0,
  );
  const ms = target.getTime() - start.getTime();
  if (ms <= 0) return MIN_ETA_WEEKS;
  const weeks = Math.ceil(ms / (7 * 24 * 60 * 60 * 1000));
  return clampEtaWeeks(weeks);
}

export function computeEtaWeeks(input: SetBatchArrivalEtaInput): number {
  if (input.preset === "custom") {
    if (input.date?.trim()) return weeksUntilDate(input.date.trim());
    if (input.weeks != null) return clampEtaWeeks(input.weeks);
    return DEFAULT_ETA_WEEKS;
  }
  return weeksForPreset(input.preset);
}

export function toStoredEta(
  input: SetBatchArrivalEtaInput,
): BatchArrivalEtaStored {
  const weeks = computeEtaWeeks(input);
  return {
    preset: input.preset,
    weeks,
    date: input.preset === "custom" ? input.date?.trim() || null : null,
    label: input.label?.trim() || null,
  };
}

function presetSummary(
  preset: EtaPreset | "default",
  weeks: number,
  date: string | null,
  label: string | null,
): { en: string; ar: string } {
  if (label) {
    return {
      en: label,
      ar: label,
    };
  }
  if (preset === "2w") {
    return { en: "About 2 weeks", ar: "حوالي أسبوعين" };
  }
  if (preset === "1m" || preset === "default") {
    return { en: "About 1 month", ar: "حوالي شهر واحد" };
  }
  if (preset === "2m") {
    return { en: "About 2 months", ar: "حوالي شهرين" };
  }
  if (date) {
    return {
      en: `By ${date} (~${weeks} weeks)`,
      ar: `بحلول ${date} (~${weeks} أسابيع)`,
    };
  }
  return {
    en: `About ${weeks} weeks`,
    ar: `حوالي ${weeks} أسابيع`,
  };
}

export function parseStoredEta(
  raw: string | null | undefined,
): BatchArrivalEtaStored | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<BatchArrivalEtaStored>;
    if (!parsed || typeof parsed !== "object") return null;
    if (!ETA_PRESETS.includes(parsed.preset as EtaPreset)) return null;
    const weeks = clampEtaWeeks(Number(parsed.weeks) || DEFAULT_ETA_WEEKS);
    return {
      preset: parsed.preset as EtaPreset,
      weeks,
      date: typeof parsed.date === "string" ? parsed.date : null,
      label: typeof parsed.label === "string" ? parsed.label : null,
    };
  } catch {
    return null;
  }
}

/** Resolve stored JSON (or null) into a panel-ready ETA view. */
export function resolveBatchArrivalEta(
  raw: string | null | undefined,
): BatchArrivalEtaView {
  const stored = parseStoredEta(raw);
  if (!stored) {
    const weeks = DEFAULT_ETA_WEEKS;
    const summary = presetSummary("default", weeks, null, null);
    return {
      weeks,
      weekCount: weeks,
      preset: "default",
      date: null,
      label: null,
      founderSet: false,
      summaryEn: summary.en,
      summaryAr: summary.ar,
    };
  }
  const weeks = clampEtaWeeks(stored.weeks);
  const summary = presetSummary(
    stored.preset,
    weeks,
    stored.date ?? null,
    stored.label ?? null,
  );
  return {
    weeks,
    weekCount: weeks,
    preset: stored.preset,
    date: stored.date ?? null,
    label: stored.label ?? null,
    founderSet: true,
    summaryEn: summary.en,
    summaryAr: summary.ar,
  };
}

export function weekLabelEn(weekIndex: number): string {
  return `Week ${weekIndex}`;
}

export function weekLabelAr(weekIndex: number): string {
  return `الأسبوع ${weekIndex}`;
}
