/**
 * Wave 2 §7 "Measure" — read the Discovery funnel rates over a window.
 *
 * Read-only ops tool: it never writes, and nothing it prints is fed back into
 * scoring. Thresholds are tuned by a human looking at these numbers.
 *
 *   npx tsx scripts/discovery-metrics.ts             # last 30 days
 *   npx tsx scripts/discovery-metrics.ts --days=7
 *   npx tsx scripts/discovery-metrics.ts --json
 */

import { closeDb } from "@/db";
import {
  aggregateDiscoveryMetrics,
  type DiscoveryMetricsSummary,
} from "@/lib/discovery/metrics/events";
import { loadDiscoveryMetricEvents } from "@/lib/discovery/metrics/store";

const DEFAULT_WINDOW_DAYS = 30;

function usage(): never {
  console.error(`Usage: npx tsx scripts/discovery-metrics.ts [--days=N] [--json]

  --days=N   Window size in days, counted back from now (default ${DEFAULT_WINDOW_DAYS}).
  --json     Print the raw summary instead of the readable report.

Reports WAVE-2 §7 empty rate, accept rate, and edit-onboarding rate. Counters
are append-only and never influence scoring, rank, or accept gates.
`);
  process.exit(2);
}

function parseDays(argv: string[]): number {
  for (const a of argv) {
    const m = /^--days=(\d+)$/.exec(a);
    if (m) {
      const n = Number(m[1]);
      if (n > 0) return n;
      usage();
    }
  }
  return DEFAULT_WINDOW_DAYS;
}

/** "—" when the denominator was empty: no data is not the same as 0%. */
function formatRate(rate: number | null): string {
  return rate == null ? "—" : `${(rate * 100).toFixed(1)}%`;
}

function formatFailures(byCode: Record<string, number>): string {
  const entries = Object.entries(byCode).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return "none";
  return entries.map(([code, n]) => `${code}=${n}`).join(", ");
}

function printReport(summary: DiscoveryMetricsSummary, days: number) {
  const t = summary.totals;
  console.log(`Wave 2 Discovery metrics — last ${days} day(s)`);
  console.log(`  window: ${summary.window.from} → ${summary.window.to}`);
  console.log(`  events recorded: ${summary.events}`);
  console.log("");
  console.log("Rates (§7):");
  console.log(
    `  empty rate            ${formatRate(summary.emptyRate)}  (${t.shortlist_empty}/${summary.sessionsViewed} sessions opened with nothing to show)`,
  );
  console.log(
    `  no-scores empty rate  ${formatRate(summary.noScoresEmptyRate)}  (${t.shortlist_empty_no_scores}/${summary.sessionsViewed} of those were a scoring outage, not a profile)`,
  );
  console.log(
    `  accept rate           ${formatRate(summary.acceptRate)}  (${t.accept}/${summary.decisions} accept-or-reject decisions)`,
  );
  console.log(
    `  edit-onboarding rate  ${formatRate(summary.editOnboardingRate)}  (${t.edit_onboarding_shown}/${summary.sessionsViewed} sessions shown the Edit onboarding note)`,
  );
  console.log("");
  console.log("Counters:");
  console.log(`  shortlist shown       ${t.shortlist_shown}`);
  console.log(`  empty shortlist       ${t.shortlist_empty}`);
  console.log(`  empty — no scores     ${t.shortlist_empty_no_scores}`);
  console.log(`  accept                ${t.accept}`);
  console.log(`  reject                ${t.reject}`);
  console.log(`  edit onboarding shown ${t.edit_onboarding_shown}`);
  console.log(`  why-explain opened    ${t.why_explain_opened}`);
  console.log(`  compare run           ${t.compare_run}`);
  console.log("");
  console.log("Failures by error code:");
  console.log(
    `  explain (${t.explain_failed}): ${formatFailures(summary.failuresByCode.explain)}`,
  );
  console.log(
    `  compare (${t.compare_failed}): ${formatFailures(summary.failuresByCode.compare)}`,
  );
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.some((a) => a === "--help" || a === "-h")) usage();
  const unknown = argv.find(
    (a) => a !== "--json" && !/^--days=\d+$/.test(a),
  );
  if (unknown) usage();

  if (!process.env.DATABASE_URL?.trim()) {
    console.error(
      "DATABASE_URL is required. Copy .env.example → .env and set Postgres.",
    );
    process.exit(1);
  }

  const days = parseDays(argv);
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  const window = { from: from.toISOString(), to: to.toISOString() };

  const events = await loadDiscoveryMetricEvents(window);
  const summary = aggregateDiscoveryMetrics(events, window);

  if (argv.includes("--json")) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    printReport(summary, days);
  }

  await closeDb();
  process.exit(0);
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err);
  try {
    await closeDb();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
