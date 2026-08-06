/**
 * Wave 2 Discovery job CLI — Approach A ops entrypoints.
 * Never call from Discovery page loads. Loads `.env` via `@/db` then runs jobs.
 *
 *   npx tsx scripts/discovery-jobs.ts intake
 *   npx tsx scripts/discovery-jobs.ts score
 *   npx tsx scripts/discovery-jobs.ts refresh   # intake then score
 */

import { closeDb } from "@/db";
import { runPath1IntakeJob } from "@/lib/discovery/jobs/intake";
import { runScoreRefreshJob } from "@/lib/discovery/jobs/score-refresh";
import {
  isDiscoveryLiveSearchEnabled,
  isDiscoveryPoolV2Enabled,
  isSoftCompetitionBudgetEnabled,
} from "@/lib/discovery/flags";
import {
  isGeminiConfigured,
  isSuggestionExplainEnabled,
} from "@/lib/discovery/explain/llm";
import { resolveSerpApiKey } from "@/lib/discovery/providers/serpapi";

type Command = "intake" | "score" | "refresh";

function usage(): never {
  console.error(`Usage: npx tsx scripts/discovery-jobs.ts <intake|score|refresh> [--limit=N]

  intake   — Path 1 product pool intake (seed always; live SerpAPI when flags+key)
  score    — Approach A score refresh (heuristic or live evidence under flags)
  refresh  — intake then score

  --limit=N  For score/refresh: max pool products to score in this run (ops/smoke).

Approach A: Discovery page loads must NEVER live-search — run these from CLI/cron only.
`);
  process.exit(2);
}

function parseLimit(argv: string[]): number | undefined {
  for (const a of argv) {
    const m = /^--limit=(\d+)$/.exec(a);
    if (m) return Math.max(0, Number(m[1]));
  }
  return undefined;
}

function printFlagBanner() {
  const hasKey = Boolean(resolveSerpApiKey());
  console.log("Wave 2 Discovery job flags (secrets never printed):");
  console.log(`  DISCOVERY_POOL_V2=${isDiscoveryPoolV2Enabled() ? "on" : "off"}`);
  console.log(
    `  DISCOVERY_LIVE_SEARCH=${isDiscoveryLiveSearchEnabled() ? "on" : "off"}`,
  );
  console.log(
    `  DISCOVERY_SOFT_COMPETITION_BUDGET=${isSoftCompetitionBudgetEnabled() ? "soft" : "hard-shadow"}`,
  );
  console.log(
    `  suggestion explain (POOL_V2)=${isSuggestionExplainEnabled() ? "on" : "off"}`,
  );
  console.log(`  Gemini key=${isGeminiConfigured() ? "present" : "missing"}`);
  console.log(`  SerpAPI key=${hasKey ? "present" : "missing"}`);
  console.log("");
}

async function runIntake() {
  console.log("→ runPath1IntakeJob …");
  const result = await runPath1IntakeJob();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
  return result;
}

async function runScore(limit?: number) {
  console.log(
    `→ runScoreRefreshJob${limit !== undefined ? ` (limit=${limit})` : ""} …`,
  );
  const result = await runScoreRefreshJob(
    limit !== undefined ? { limit } : undefined,
  );
  console.log(JSON.stringify(result, null, 2));
  // Partial SerpAPI failures keep last-known — hard-fail only if nothing wrote.
  if (!result.ok && result.refreshedOk === 0) process.exitCode = 1;
  return result;
}

async function main() {
  const cmd = (process.argv[2] ?? "").trim() as Command | "";
  if (cmd !== "intake" && cmd !== "score" && cmd !== "refresh") {
    usage();
  }
  const limit = parseLimit(process.argv.slice(3));

  if (!process.env.DATABASE_URL?.trim()) {
    console.error(
      "DATABASE_URL is required. Copy .env.example → .env and set Postgres.",
    );
    process.exit(1);
  }

  printFlagBanner();

  if (cmd === "intake") {
    await runIntake();
  } else if (cmd === "score") {
    await runScore(limit);
  } else {
    await runIntake();
    console.log("");
    await runScore(limit);
  }

  console.log("\nDone. Open Discovery in the app — page load will read DB only (no live search).");
  await closeDb();
  process.exit(process.exitCode ?? 0);
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
