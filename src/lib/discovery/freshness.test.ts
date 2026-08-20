import { readFileSync } from "fs";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { DISCOVERY_SCORE_STALE_AFTER_DAYS_DEFAULT } from "@/lib/constants";
import {
  resolveScoreFreshness,
  resolveScoreStaleAfterDays,
  scoreFreshnessNote,
} from "@/lib/discovery/freshness";
import { rankWave2Shortlist } from "@/lib/discovery/scoring/rank";
import type { CatalogProduct } from "@/lib/discovery/catalog";
import type { ScoreRow } from "@/lib/discovery/scores";

const NOW = new Date("2026-08-07T12:00:00.000Z");

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

afterEach(() => {
  delete process.env.DISCOVERY_SCORE_STALE_AFTER_DAYS;
});

describe("resolveScoreFreshness", () => {
  it("reports a same-day read as fresh with zero age", () => {
    const f = resolveScoreFreshness({
      lastScoredAt: daysAgo(0),
      now: NOW,
      staleAfterDays: 7,
    });
    expect(f).toMatchObject({ state: "fresh", ageDays: 0 });
  });

  it("counts whole days since the last successful read", () => {
    const f = resolveScoreFreshness({
      lastScoredAt: daysAgo(3),
      now: NOW,
      staleAfterDays: 7,
    });
    expect(f).toMatchObject({ state: "fresh", ageDays: 3 });
  });

  it("calls a read stale at the window boundary, not one day past it", () => {
    expect(
      resolveScoreFreshness({
        lastScoredAt: daysAgo(6),
        now: NOW,
        staleAfterDays: 7,
      }).state,
    ).toBe("fresh");
    expect(
      resolveScoreFreshness({
        lastScoredAt: daysAgo(7),
        now: NOW,
        staleAfterDays: 7,
      }).state,
    ).toBe("stale");
  });

  it("reports a never-scored row as never, not as fresh", () => {
    const f = resolveScoreFreshness({
      lastScoredAt: null,
      now: NOW,
      staleAfterDays: 7,
    });
    expect(f).toMatchObject({ state: "never", ageDays: null });
  });

  it("fails closed to never on an undatable timestamp", () => {
    // An unparseable stamp must not read as "measured just now".
    const f = resolveScoreFreshness({
      lastScoredAt: "not-a-date",
      now: NOW,
      staleAfterDays: 7,
    });
    expect(f.state).toBe("never");
  });

  it("floors clock skew instead of reporting a future read", () => {
    const f = resolveScoreFreshness({
      lastScoredAt: new Date(NOW.getTime() + 60_000).toISOString(),
      now: NOW,
      staleAfterDays: 7,
    });
    expect(f).toMatchObject({ state: "fresh", ageDays: 0 });
  });

  it("16-day read is fresh at the default 30-day window; 30 days is stale", () => {
    const sixteen = resolveScoreFreshness({
      lastScoredAt: daysAgo(16),
      now: NOW,
      staleAfterDays: 30,
    });
    expect(sixteen).toMatchObject({
      state: "fresh",
      ageDays: 16,
      staleAfterDays: 30,
    });
    expect(scoreFreshnessNote(sixteen)).toEqual({
      key: "scoreFreshnessDays",
      values: { days: 16, window: 30 },
    });

    const thirty = resolveScoreFreshness({
      lastScoredAt: daysAgo(30),
      now: NOW,
      staleAfterDays: 30,
    });
    expect(thirty).toMatchObject({
      state: "stale",
      ageDays: 30,
      staleAfterDays: 30,
    });
    expect(scoreFreshnessNote(thirty)).toEqual({
      key: "scoreFreshnessStale",
      values: { days: 30, window: 30 },
    });
  });

  it("keeps the age of the last successful read after a failed refresh", () => {
    // applyFailedScoreRefresh leaves lastScoredAt alone (last-known scores are
    // still on screen), so the card must report the age of that data.
    const f = resolveScoreFreshness({
      lastScoredAt: daysAgo(9),
      now: NOW,
      staleAfterDays: 7,
    });
    expect(f).toMatchObject({ state: "stale", ageDays: 9 });
  });
});

describe("resolveScoreStaleAfterDays", () => {
  it("defaults to 30 when unset", () => {
    expect(DISCOVERY_SCORE_STALE_AFTER_DAYS_DEFAULT).toBe(30);
    expect(resolveScoreStaleAfterDays({})).toBe(
      DISCOVERY_SCORE_STALE_AFTER_DAYS_DEFAULT,
    );
  });

  it("honours a configured window", () => {
    expect(
      resolveScoreStaleAfterDays({ DISCOVERY_SCORE_STALE_AFTER_DAYS: "3" }),
    ).toBe(3);
  });

  it("falls back rather than reading garbage as never-stale", () => {
    for (const raw of ["0", "-4", "abc"]) {
      expect(
        resolveScoreStaleAfterDays({ DISCOVERY_SCORE_STALE_AFTER_DAYS: raw }),
      ).toBe(DISCOVERY_SCORE_STALE_AFTER_DAYS_DEFAULT);
    }
  });
});

describe("scoreFreshnessNote", () => {
  it("renders fresh / stale / never with distinct founder copy keys", () => {
    const today = scoreFreshnessNote(
      resolveScoreFreshness({ lastScoredAt: daysAgo(0), now: NOW, staleAfterDays: 30 }),
    );
    const dated = scoreFreshnessNote(
      resolveScoreFreshness({ lastScoredAt: daysAgo(3), now: NOW, staleAfterDays: 30 }),
    );
    const stale = scoreFreshnessNote(
      resolveScoreFreshness({ lastScoredAt: daysAgo(30), now: NOW, staleAfterDays: 30 }),
    );
    const never = scoreFreshnessNote(
      resolveScoreFreshness({ lastScoredAt: null, now: NOW, staleAfterDays: 30 }),
    );

    expect(today.key).toBe("scoreFreshnessToday");
    expect(dated).toEqual({ key: "scoreFreshnessDays", values: { days: 3, window: 30 } });
    expect(stale).toEqual({ key: "scoreFreshnessStale", values: { days: 30, window: 30 } });
    expect(never.key).toBe("scoreFreshnessNever");
    expect(new Set([today.key, dated.key, stale.key, never.key]).size).toBe(4);
  });

  it("names the configured window so stale copy can state it", () => {
    const note = scoreFreshnessNote(
      resolveScoreFreshness({ lastScoredAt: daysAgo(10), now: NOW, staleAfterDays: 2 }),
    );
    expect(note.values.window).toBe(2);
  });
});

describe("freshness copy", () => {
  const messages = Object.fromEntries(
    (["en", "ar"] as const).map((locale) => [
      locale,
      (
        JSON.parse(
          readFileSync(
            path.join(process.cwd(), `messages/${locale}.json`),
            "utf8",
          ),
        ) as { Discovery: Record<string, string> }
      ).Discovery,
    ]),
  );

  const KEYS = [
    "scoreFreshnessLabel",
    "scoreFreshnessToday",
    "scoreFreshnessDays",
    "scoreFreshnessStale",
    "scoreFreshnessNever",
  ] as const;

  it("ships every state in EN and AR with no English fallback in AR", () => {
    for (const key of KEYS) {
      expect(messages.en[key]?.length ?? 0).toBeGreaterThan(3);
      expect(messages.ar[key]?.length ?? 0).toBeGreaterThan(3);
      expect(messages.ar[key]).not.toBe(messages.en[key]);
      // AR copy must be Arabic script, not a transliterated English string.
      expect(messages.ar[key]).toMatch(/[\u0600-\u06FF]/);
    }
  });

  it("formats fresh / stale copy in both locales, including AR dual and plural", async () => {
    const { IntlMessageFormat } = await import("intl-messageformat");
    for (const locale of ["en", "ar"] as const) {
      for (const days of [1, 2, 3, 11, 30]) {
        const dated = new IntlMessageFormat(
          messages[locale].scoreFreshnessDays,
          locale,
        ).format({ days });
        const stale = new IntlMessageFormat(
          messages[locale].scoreFreshnessStale,
          locale,
        ).format({ days, window: 30 });
        expect(String(dated).length).toBeGreaterThan(3);
        expect(String(stale)).toContain("30");
      }
    }
  });

  it("says estimate-only for a never-measured read, matching §6.1 honesty", () => {
    expect(messages.en.scoreFreshnessNever).toMatch(/estimate only/i);
    // Same voice as the §6.1 estimate honesty note ("تقدير فقط").
    expect(messages.ar.scoreFreshnessNever).toContain("تقدير فقط");
    expect(messages.en.scoreFreshnessNever).not.toMatch(/\d/);
  });
});

describe("freshness is display only", () => {
  const product: CatalogProduct = {
    key: "freshness-probe",
    category: "home_kitchen",
    sellPrice: 60,
    productCost: 8,
    intlShip: 2,
    clearanceTaxes: 2,
    localCourier: 3,
    difficulty: 1,
    risk: 1,
    timeNeed: 4,
    workload: 1,
    storageFootprint: "small",
    oversized: false,
    tier1Marketplaces: [],
    en: { name: "Probe", summary: "s", differentiation: "d" },
    ar: { name: "Probe", summary: "s", differentiation: "d" },
  } as CatalogProduct;

  const profile = {
    maxLandedCost: 40,
    experience: "some" as const,
    riskTolerance: "medium" as const,
    hoursPerWeek: 20,
    categoryLikes: ["home_kitchen"],
    budgetUsd: 6000,
    monthlyFollowOnBudget: 600,
  };

  function scoreRowScoredAt(lastScoredAt: string | null): ScoreRow {
    return {
      id: "score-1",
      poolProductId: "pool-1",
      abroadDemandScore: 0.8,
      lebanonDemandScore: 0.6,
      competitionScore: 0.3,
      budgetFightPenalty: 0,
      compositeScore: 0.7,
      demandPath: "whitespace",
      confidence: 0.8,
      explainLine: null,
      lastScoredAt,
      lastScoreStatus: "ok",
      lastError: null,
      shadowWouldExclude: false,
      shadowExcludeReason: null,
      rawEvidenceJson: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    } as ScoreRow;
  }

  it("does not change rank, strength, or composite score", () => {
    const options = {
      systemGateEnabled: true,
      liveSearchEnabled: false,
    };
    const freshRank = rankWave2Shortlist(
      profile,
      [product],
      new Map([[product.key, scoreRowScoredAt(daysAgo(0))]]),
      new Map(),
      true,
      options,
    );
    const staleRank = rankWave2Shortlist(
      profile,
      [product],
      new Map([[product.key, scoreRowScoredAt(daysAgo(400))]]),
      new Map(),
      true,
      options,
    );
    const neverRank = rankWave2Shortlist(
      profile,
      [product],
      new Map([[product.key, scoreRowScoredAt(null)]]),
      new Map(),
      true,
      options,
    );

    expect(freshRank).toHaveLength(1);
    for (const ranked of [staleRank, neverRank]) {
      expect(ranked).toHaveLength(freshRank.length);
      expect(ranked[0].p.key).toBe(freshRank[0].p.key);
      expect(ranked[0].strength).toBe(freshRank[0].strength);
      expect(ranked[0].compositeScore).toBe(freshRank[0].compositeScore);
      expect(ranked[0].notRecommended).toBe(freshRank[0].notRecommended);
    }
  });

  it("is not imported by any scoring, ranking, or gate module", () => {
    const root = path.join(process.cwd(), "src");
    for (const file of [
      "lib/discovery/scoring/rank.ts",
      "lib/discovery/scoring/composite.ts",
      "lib/discovery/scoring/polish.ts",
      "lib/discovery/dual-gate.ts",
    ]) {
      const src = readFileSync(path.join(root, file), "utf8");
      expect(src, `${file} must not read score freshness`).not.toContain(
        "freshness",
      );
    }
  });
});
