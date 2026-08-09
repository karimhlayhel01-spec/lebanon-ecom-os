import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  aggregateDiscoveryMetrics,
  candidateMetricDedupeKey,
  compareFailureDedupeKey,
  compareRunDedupeKey,
  DISCOVERY_METRIC_KINDS,
  explainFailureDedupeKey,
  filterEventsInWindow,
  sessionMetricDedupeKey,
  shortlistOutcomeDedupeKey,
  type DiscoveryMetricEvent,
  type DiscoveryMetricKind,
} from "@/lib/discovery/metrics/events";

const root = path.join(process.cwd(), "src");

function read(rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

function event(
  kind: DiscoveryMetricKind,
  overrides: Partial<DiscoveryMetricEvent> = {},
): DiscoveryMetricEvent {
  return {
    kind,
    sessionId: "session-1",
    errorCode: null,
    createdAt: "2026-08-05T12:00:00.000Z",
    ...overrides,
  };
}

describe("metric dedupe keys", () => {
  it("covers every counter the §7 measurement loop asks for", () => {
    expect([...DISCOVERY_METRIC_KINDS]).toEqual([
      "shortlist_shown",
      "shortlist_empty",
      "shortlist_empty_no_scores",
      "accept",
      "reject",
      "edit_onboarding_shown",
      "why_explain_opened",
      "compare_run",
      "explain_failed",
      "compare_failed",
    ]);
  });

  it("gives a session one shortlist outcome, so re-renders cannot add another", () => {
    // Both outcome kinds share one key: a session either had something to show
    // or it did not, and a revalidate must not record that twice.
    expect(shortlistOutcomeDedupeKey("session-1")).toBe(
      shortlistOutcomeDedupeKey("session-1"),
    );
    expect(shortlistOutcomeDedupeKey("session-1")).not.toBe(
      shortlistOutcomeDedupeKey("session-2"),
    );
    expect(shortlistOutcomeDedupeKey("session-1")).not.toContain(
      "shortlist_shown",
    );
  });

  it("keys card events by candidate, so a retried action counts once", () => {
    expect(candidateMetricDedupeKey("cand-1", "accept")).toBe(
      candidateMetricDedupeKey("cand-1", "accept"),
    );
    expect(candidateMetricDedupeKey("cand-1", "accept")).not.toBe(
      candidateMetricDedupeKey("cand-1", "reject"),
    );
    expect(candidateMetricDedupeKey("cand-1", "why_explain_opened")).not.toBe(
      candidateMetricDedupeKey("cand-2", "why_explain_opened"),
    );
  });

  it("keys a compare run by its selection, ignoring mark order", () => {
    expect(compareRunDedupeKey(["b", "a"])).toBe(compareRunDedupeKey(["a", "b"]));
    expect(compareRunDedupeKey(["a", "a", "b"])).toBe(
      compareRunDedupeKey(["a", "b"]),
    );
    expect(compareRunDedupeKey(["a", "b"])).not.toBe(
      compareRunDedupeKey(["a", "c"]),
    );
  });

  it("separates failures by error code but not by retry", () => {
    expect(explainFailureDedupeKey("cand-1", "ungrounded")).toBe(
      explainFailureDedupeKey("cand-1", "ungrounded"),
    );
    expect(explainFailureDedupeKey("cand-1", "ungrounded")).not.toBe(
      explainFailureDedupeKey("cand-1", "rate_limited"),
    );
    expect(compareFailureDedupeKey(["a", "b"], "misaligned")).not.toBe(
      compareFailureDedupeKey(["a", "b"], "incomplete"),
    );
  });

  it("never collides across kinds for the same session", () => {
    const keys = [
      shortlistOutcomeDedupeKey("s"),
      sessionMetricDedupeKey("s", "edit_onboarding_shown"),
      candidateMetricDedupeKey("s", "accept"),
      candidateMetricDedupeKey("s", "reject"),
      candidateMetricDedupeKey("s", "why_explain_opened"),
      compareRunDedupeKey(["s"]),
      explainFailureDedupeKey("s", "api_error"),
      compareFailureDedupeKey(["s"], "api_error"),
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("filterEventsInWindow", () => {
  it("keeps events on both inclusive bounds and drops the rest", () => {
    const events = [
      event("accept", { createdAt: "2026-08-01T00:00:00.000Z" }),
      event("accept", { createdAt: "2026-08-05T00:00:00.000Z" }),
      event("accept", { createdAt: "2026-08-10T00:00:00.000Z" }),
      event("accept", { createdAt: "2026-08-11T00:00:00.000Z" }),
    ];
    const kept = filterEventsInWindow(events, {
      from: "2026-08-01T00:00:00.000Z",
      to: "2026-08-10T00:00:00.000Z",
    });
    expect(kept).toHaveLength(3);
  });

  it("drops undatable rows instead of counting them in every window", () => {
    expect(
      filterEventsInWindow([event("accept", { createdAt: "nope" })], {
        from: "2026-08-01T00:00:00.000Z",
      }),
    ).toHaveLength(0);
  });
});

describe("aggregateDiscoveryMetrics", () => {
  it("computes empty, accept, and edit-onboarding rates over the window", () => {
    const summary = aggregateDiscoveryMetrics([
      event("shortlist_shown"),
      event("shortlist_shown"),
      event("shortlist_shown"),
      event("shortlist_empty"),
      event("edit_onboarding_shown"),
      event("accept"),
      event("reject"),
      event("reject"),
      event("reject"),
    ]);

    expect(summary.sessionsViewed).toBe(4);
    expect(summary.decisions).toBe(4);
    expect(summary.emptyRate).toBe(0.25);
    expect(summary.acceptRate).toBe(0.25);
    expect(summary.editOnboardingRate).toBe(0.25);
  });

  it("reports null rather than 0% when nothing was measured", () => {
    const summary = aggregateDiscoveryMetrics([]);
    expect(summary.emptyRate).toBeNull();
    expect(summary.acceptRate).toBeNull();
    expect(summary.editOnboardingRate).toBeNull();
    expect(summary.events).toBe(0);
  });

  it("only counts events inside the window", () => {
    const summary = aggregateDiscoveryMetrics(
      [
        event("shortlist_shown", { createdAt: "2026-07-01T00:00:00.000Z" }),
        event("shortlist_empty", { createdAt: "2026-08-05T00:00:00.000Z" }),
      ],
      { from: "2026-08-01T00:00:00.000Z", to: "2026-08-07T00:00:00.000Z" },
    );
    expect(summary.sessionsViewed).toBe(1);
    expect(summary.emptyRate).toBe(1);
  });

  it("splits explain and compare failures by error code", () => {
    const summary = aggregateDiscoveryMetrics([
      event("explain_failed", { errorCode: "ungrounded" }),
      event("explain_failed", { errorCode: "ungrounded" }),
      event("explain_failed", { errorCode: "rate_limited" }),
      event("compare_failed", { errorCode: "misaligned" }),
      event("compare_failed", { errorCode: null }),
    ]);
    expect(summary.failuresByCode.explain).toEqual({
      ungrounded: 2,
      rate_limited: 1,
    });
    expect(summary.failuresByCode.compare).toEqual({
      misaligned: 1,
      unknown: 1,
    });
  });

  it("ignores an unrecognised kind instead of inventing a counter", () => {
    const summary = aggregateDiscoveryMetrics([
      event("accept"),
      event("not_a_kind" as DiscoveryMetricKind),
    ]);
    expect(summary.totals.accept).toBe(1);
    expect(Object.keys(summary.totals).sort()).toEqual(
      [...DISCOVERY_METRIC_KINDS].sort(),
    );
  });
});

describe("metrics isolation", () => {
  it("writes only the append-only events table", () => {
    const store = read("lib/discovery/metrics/store.ts");
    expect(store).toContain("schema.discoveryMetricEvents");
    expect(store).toContain("onConflictDoNothing");
    for (const forbidden of [
      "discoveryProductScores",
      "productCandidates",
      "approvalRequests",
      "skuCards",
      "sideStatuses",
      "discoverySessions",
      "journeyStates",
      ".update(",
      ".delete(",
    ]) {
      expect(store, `metrics store must not touch ${forbidden}`).not.toContain(
        forbidden,
      );
    }
  });

  it("never lets a metrics write break a founder action", () => {
    const store = read("lib/discovery/metrics/store.ts");
    const record = store.slice(
      store.indexOf("export async function recordDiscoveryMetric"),
      store.indexOf("export async function loadDiscoveryMetricEvents"),
    );
    expect(record).toContain("try {");
    expect(record).toContain("} catch {");
  });

  it("is never read by scoring, ranking, or accept gates", () => {
    for (const file of [
      "lib/discovery/scoring/rank.ts",
      "lib/discovery/scoring/composite.ts",
      "lib/discovery/dual-gate.ts",
      "lib/discovery/scores.ts",
      "lib/discovery/jobs/score-refresh.ts",
      "lib/discovery/jobs/intake.ts",
    ]) {
      const src = read(file);
      expect(src, `${file} must not read metrics`).not.toContain(
        "metrics/events",
      );
      expect(src, `${file} must not read metrics`).not.toContain(
        "metrics/store",
      );
    }
  });

  it("accept and reject each record one deduped counter", () => {
    const service = read("lib/discovery/service.ts");
    expect(service).toContain(
      'candidateMetricDedupeKey(candidateId, "reject")',
    );
    expect(service).toContain(
      'candidateMetricDedupeKey(candidate.id, "accept")',
    );
    expect(service).toContain("shortlistOutcomeDedupeKey(freshSession.id)");
  });

  it("explain and compare record opens plus typed failure codes", () => {
    const actions = read("actions/discovery.ts");
    expect(actions).toContain('kind: "why_explain_opened"');
    expect(actions).toContain('kind: "explain_failed"');
    expect(actions).toContain('kind: "compare_run"');
    expect(actions).toContain('kind: "compare_failed"');
    expect(actions).toContain("errorCode: result.error");
  });

  it("the CLI only reads — it never records", () => {
    const cli = readFileSync(
      path.join(process.cwd(), "scripts/discovery-metrics.ts"),
      "utf8",
    );
    expect(cli).toContain("loadDiscoveryMetricEvents");
    expect(cli).toContain("aggregateDiscoveryMetrics");
    expect(cli).not.toContain("recordDiscoveryMetric");
  });
});
