/**
 * Store page copy versions — baseline + up to 3 Gemini AI snapshots (Wave 4 Phase 2 addendum).
 * Only `source === "gemini"` consumes an AI slot. Failed LLM / template refresh do not.
 */

import type {
  DiscoverabilityPack,
  StorePageCopyPayload,
  StorePageCopySource,
} from "@/lib/store/page-copy";
import { parseDiscoverabilityPack } from "@/lib/store/page-copy";

export const MAX_AI_STORE_PAGE_COPY_VERSIONS = 3;

export type StorePageCopyVersionKind = "baseline" | "ai";

export type StorePageCopyVersion = {
  kind: StorePageCopyVersionKind;
  /** baseline | gemini | template (template never stored as AI slot). */
  source: "baseline" | StorePageCopySource;
  createdAt: string;
  contentDraftEn: string;
  contentDraftAr: string;
  policiesDraft: string;
  discoverability: DiscoverabilityPack | null;
};

export type StorePageCopyVersionsState = {
  activeIndex: number;
  versions: StorePageCopyVersion[];
};

export type StorePageCopyVersionSummary = {
  index: number;
  kind: StorePageCopyVersionKind;
  source: StorePageCopyVersion["source"];
  createdAt: string;
  /** 1-based AI ordinal when kind === "ai". */
  aiOrdinal: number | null;
};

export function countAiVersions(state: StorePageCopyVersionsState): number {
  return state.versions.filter((v) => v.kind === "ai").length;
}

export function aiImprovesLeft(state: StorePageCopyVersionsState): number {
  return Math.max(0, MAX_AI_STORE_PAGE_COPY_VERSIONS - countAiVersions(state));
}

export function emptyVersionsState(): StorePageCopyVersionsState {
  return { activeIndex: 0, versions: [] };
}

export function parsePageCopyVersions(
  raw: string | null | undefined,
): StorePageCopyVersionsState {
  if (!raw?.trim()) return emptyVersionsState();
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return emptyVersionsState();
    const o = parsed as Record<string, unknown>;
    if (!Array.isArray(o.versions)) return emptyVersionsState();
    const versions: StorePageCopyVersion[] = [];
    for (const row of o.versions) {
      if (!row || typeof row !== "object") continue;
      const v = row as Record<string, unknown>;
      const kind = v.kind === "ai" ? "ai" : v.kind === "baseline" ? "baseline" : null;
      if (!kind) continue;
      if (
        typeof v.contentDraftEn !== "string" ||
        typeof v.contentDraftAr !== "string" ||
        typeof v.policiesDraft !== "string" ||
        typeof v.createdAt !== "string"
      ) {
        continue;
      }
      const source =
        v.source === "gemini" ||
        v.source === "template" ||
        v.source === "baseline"
          ? v.source
          : kind === "baseline"
            ? "baseline"
            : "gemini";
      let discoverability: DiscoverabilityPack | null = null;
      if (v.discoverability && typeof v.discoverability === "object") {
        discoverability = v.discoverability as DiscoverabilityPack;
      }
      versions.push({
        kind,
        source,
        createdAt: v.createdAt,
        contentDraftEn: v.contentDraftEn,
        contentDraftAr: v.contentDraftAr,
        policiesDraft: v.policiesDraft,
        discoverability,
      });
    }
    let activeIndex =
      typeof o.activeIndex === "number" && Number.isFinite(o.activeIndex)
        ? Math.floor(o.activeIndex)
        : 0;
    if (versions.length === 0) return emptyVersionsState();
    if (activeIndex < 0 || activeIndex >= versions.length) activeIndex = 0;
    // Ensure baseline stays first if present.
    const baselineIdx = versions.findIndex((v) => v.kind === "baseline");
    if (baselineIdx > 0) {
      const [b] = versions.splice(baselineIdx, 1);
      versions.unshift(b!);
      if (activeIndex === baselineIdx) activeIndex = 0;
      else if (activeIndex < baselineIdx) {
        /* unchanged */
      } else activeIndex -= 1;
    }
    return { activeIndex, versions };
  } catch {
    return emptyVersionsState();
  }
}

export function serializePageCopyVersions(
  state: StorePageCopyVersionsState,
): string {
  return JSON.stringify(state);
}

export function snapshotFromLive(args: {
  kind: StorePageCopyVersionKind;
  source: StorePageCopyVersion["source"];
  createdAt: string;
  contentDraftEn: string;
  contentDraftAr: string;
  policiesDraft: string;
  discoverabilityPackRaw: string;
}): StorePageCopyVersion {
  return {
    kind: args.kind,
    source: args.source,
    createdAt: args.createdAt,
    contentDraftEn: args.contentDraftEn,
    contentDraftAr: args.contentDraftAr,
    policiesDraft: args.policiesDraft,
    discoverability: parseDiscoverabilityPack(args.discoverabilityPackRaw),
  };
}

export function snapshotFromPayload(
  payload: StorePageCopyPayload,
  createdAt: string,
): StorePageCopyVersion {
  return {
    kind: payload.source === "gemini" ? "ai" : "baseline",
    source: payload.source,
    createdAt,
    contentDraftEn: payload.contentDraftEn,
    contentDraftAr: payload.contentDraftAr,
    policiesDraft: payload.policiesDraft,
    discoverability: payload.discoverability,
  };
}

/**
 * Ensure baseline exists (slot 0) from current live drafts before first AI improve.
 * Idempotent if baseline already present.
 */
export function ensureBaseline(
  state: StorePageCopyVersionsState,
  live: {
    contentDraftEn: string;
    contentDraftAr: string;
    policiesDraft: string;
    discoverabilityPackRaw: string;
    createdAt: string;
  },
): StorePageCopyVersionsState {
  if (state.versions.some((v) => v.kind === "baseline")) {
    return state;
  }
  const baseline = snapshotFromLive({
    kind: "baseline",
    source: "baseline",
    createdAt: live.createdAt,
    contentDraftEn: live.contentDraftEn,
    contentDraftAr: live.contentDraftAr,
    policiesDraft: live.policiesDraft,
    discoverabilityPackRaw: live.discoverabilityPackRaw,
  });
  return {
    activeIndex: 0,
    versions: [baseline, ...state.versions.filter((v) => v.kind === "ai")],
  };
}

export type AppendAiResult =
  | { ok: true; state: StorePageCopyVersionsState; activeIndex: number }
  | { ok: false; error: "ai_cap" };

/** Append a successful Gemini snapshot if under cap; set it active. */
export function appendAiVersion(
  state: StorePageCopyVersionsState,
  snapshot: StorePageCopyVersion,
): AppendAiResult {
  if (snapshot.source !== "gemini" || snapshot.kind !== "ai") {
    return { ok: false, error: "ai_cap" };
  }
  if (countAiVersions(state) >= MAX_AI_STORE_PAGE_COPY_VERSIONS) {
    return { ok: false, error: "ai_cap" };
  }
  const versions = [...state.versions, snapshot];
  const activeIndex = versions.length - 1;
  return { ok: true, state: { activeIndex, versions }, activeIndex };
}

export function selectVersion(
  state: StorePageCopyVersionsState,
  index: number,
): StorePageCopyVersionsState | null {
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= state.versions.length
  ) {
    return null;
  }
  return { ...state, activeIndex: index };
}

/** Persist founder edits onto the active version snapshot. */
export function updateActiveVersionDrafts(
  state: StorePageCopyVersionsState,
  drafts: {
    contentDraftEn: string;
    contentDraftAr: string;
    policiesDraft: string;
  },
): StorePageCopyVersionsState {
  if (state.versions.length === 0) return state;
  const idx = Math.min(
    Math.max(0, state.activeIndex),
    state.versions.length - 1,
  );
  const versions = state.versions.map((v, i) =>
    i === idx
      ? {
          ...v,
          contentDraftEn: drafts.contentDraftEn,
          contentDraftAr: drafts.contentDraftAr,
          policiesDraft: drafts.policiesDraft,
        }
      : v,
  );
  return { ...state, activeIndex: idx, versions };
}

export function versionSummaries(
  state: StorePageCopyVersionsState,
): StorePageCopyVersionSummary[] {
  let aiOrdinal = 0;
  return state.versions.map((v, index) => {
    const ordinal = v.kind === "ai" ? ++aiOrdinal : null;
    return {
      index,
      kind: v.kind,
      source: v.source,
      createdAt: v.createdAt,
      aiOrdinal: ordinal,
    };
  });
}

export function activeVersion(
  state: StorePageCopyVersionsState,
): StorePageCopyVersion | null {
  if (state.versions.length === 0) return null;
  const idx = Math.min(
    Math.max(0, state.activeIndex),
    state.versions.length - 1,
  );
  return state.versions[idx] ?? null;
}
