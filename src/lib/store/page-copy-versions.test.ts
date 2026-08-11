import { describe, expect, it } from "vitest";
import {
  MAX_AI_STORE_PAGE_COPY_VERSIONS,
  aiImprovesLeft,
  appendAiVersion,
  countAiVersions,
  ensureBaseline,
  parsePageCopyVersions,
  selectVersion,
  serializePageCopyVersions,
  updateActiveVersionDrafts,
  versionSummaries,
  type StorePageCopyVersion,
  type StorePageCopyVersionsState,
} from "@/lib/store/page-copy-versions";
import { buildTemplateStorePageCopy } from "@/lib/store/page-copy";

function aiSnap(n: number): StorePageCopyVersion {
  const t = buildTemplateStorePageCopy({
    name: `AI Product ${n}`,
    category: "home_kitchen",
  });
  return {
    kind: "ai",
    source: "gemini",
    createdAt: `2026-08-11T0${n}:00:00.000Z`,
    contentDraftEn: t.contentDraftEn,
    contentDraftAr: t.contentDraftAr,
    policiesDraft: t.policiesDraft,
    discoverability: t.discoverability,
  };
}

describe("page-copy-versions", () => {
  it("captures baseline once and preserves it when appending AI", () => {
    let state = ensureBaseline(
      { activeIndex: 0, versions: [] },
      {
        contentDraftEn: "Baseline EN",
        contentDraftAr: "Baseline AR",
        policiesDraft: "Policies",
        discoverabilityPackRaw: "",
        createdAt: "2026-08-11T00:00:00.000Z",
      },
    );
    expect(state.versions).toHaveLength(1);
    expect(state.versions[0]!.kind).toBe("baseline");
    expect(state.versions[0]!.contentDraftEn).toBe("Baseline EN");

    const first = appendAiVersion(state, aiSnap(1));
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    state = first.state;
    expect(countAiVersions(state)).toBe(1);
    expect(state.versions[0]!.kind).toBe("baseline");
    expect(state.versions[0]!.contentDraftEn).toBe("Baseline EN");
    expect(state.activeIndex).toBe(1);

    // ensureBaseline again is idempotent
    const again = ensureBaseline(state, {
      contentDraftEn: "Should not replace",
      contentDraftAr: "x",
      policiesDraft: "y",
      discoverabilityPackRaw: "",
      createdAt: "later",
    });
    expect(again.versions[0]!.contentDraftEn).toBe("Baseline EN");
  });

  it("caps at 3 AI versions; failed non-gemini does not append", () => {
    let state = ensureBaseline(
      { activeIndex: 0, versions: [] },
      {
        contentDraftEn: "B",
        contentDraftAr: "ب",
        policiesDraft: "P",
        discoverabilityPackRaw: "",
        createdAt: "t0",
      },
    );
    for (let i = 1; i <= MAX_AI_STORE_PAGE_COPY_VERSIONS; i++) {
      const r = appendAiVersion(state, aiSnap(i));
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      state = r.state;
    }
    expect(countAiVersions(state)).toBe(3);
    expect(aiImprovesLeft(state)).toBe(0);
    expect(state.versions).toHaveLength(4); // baseline + 3

    const over = appendAiVersion(state, aiSnap(4));
    expect(over.ok).toBe(false);
    if (over.ok) return;
    expect(over.error).toBe("ai_cap");
    expect(countAiVersions(state)).toBe(3);
    expect(state.versions[0]!.kind).toBe("baseline");

    const templateAttempt = appendAiVersion(state, {
      ...aiSnap(9),
      kind: "ai",
      source: "template",
    });
    expect(templateAttempt.ok).toBe(false);
  });

  it("selects active version and updates drafts on active only", () => {
    let state: StorePageCopyVersionsState = ensureBaseline(
      { activeIndex: 0, versions: [] },
      {
        contentDraftEn: "Base",
        contentDraftAr: "أساس",
        policiesDraft: "Pol",
        discoverabilityPackRaw: "",
        createdAt: "t0",
      },
    );
    const a1 = appendAiVersion(state, aiSnap(1));
    expect(a1.ok).toBe(true);
    if (!a1.ok) return;
    state = a1.state;

    const selected = selectVersion(state, 0);
    expect(selected).not.toBeNull();
    state = selected!;
    expect(state.activeIndex).toBe(0);

    state = updateActiveVersionDrafts(state, {
      contentDraftEn: "Edited baseline",
      contentDraftAr: "معدّل",
      policiesDraft: "New pol",
    });
    expect(state.versions[0]!.contentDraftEn).toBe("Edited baseline");
    expect(state.versions[1]!.contentDraftEn).toContain("AI Product 1");

    const summaries = versionSummaries(state);
    expect(summaries[0]!.kind).toBe("baseline");
    expect(summaries[1]!.aiOrdinal).toBe(1);

    const round = parsePageCopyVersions(serializePageCopyVersions(state));
    expect(round.versions).toHaveLength(2);
    expect(round.activeIndex).toBe(0);
  });
});
