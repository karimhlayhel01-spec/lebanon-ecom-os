import { eq } from "drizzle-orm";
import { db, ensureMigrated, schema } from "@/db";
import {
  DISCOVERY_INITIAL_COUNT,
  DISCOVERY_SESSION_CAP,
} from "@/lib/constants";
import {
  createActiveDiscoverySessionFromScored,
  scoreRankCatalog,
  type ScoredProduct,
} from "@/lib/discovery/service";
import { resetWorkspaceJourney } from "@/lib/demo/reset-journey";

type OnboardingRow = typeof schema.onboardingProfiles.$inferSelect;

/**
 * Demo-tolerant overlay so a typical (or slightly tight) onboarding still
 * yields a full invent/catalog shortlist. Does not rewrite the saved profile.
 * Invent/catalog only — never calls Serper/SerpAPI.
 */
function demoScoringProfile(onboarding: OnboardingRow): OnboardingRow {
  return {
    ...onboarding,
    maxLandedCost: Math.max(onboarding.maxLandedCost, 40),
    hoursPerWeek: Math.max(onboarding.hoursPerWeek, 10),
    monthlyFollowOnBudget: Math.max(onboarding.monthlyFollowOnBudget, 300),
  };
}

/**
 * Pad a scored list to the session cap by repeating accept-ready economics.
 * Keeps the source catalog key so POOL_V2 heuristic demand (LIVE_SEARCH off)
 * still resolves. Display may repeat names — only used when the catalog
 * shortlist is thinner than DISCOVERY_SESSION_CAP for a harsh profile.
 */
export function padDemoScoredPool(
  scored: ScoredProduct[],
  target = DISCOVERY_SESSION_CAP,
): ScoredProduct[] {
  if (scored.length >= target) return scored.slice(0, target);
  if (scored.length === 0) return scored;

  const out = [...scored];
  let i = 0;
  while (out.length < target) {
    const src = scored[i % scored.length]!;
    const n = out.length + 1;
    out.push({
      ...src,
      p: {
        ...src.p,
        en: {
          ...src.p.en,
          name: `${src.p.en.name} · ${n}`,
        },
        ar: {
          ...src.p.ar,
          name: `${src.p.ar.name} · ${n}`,
        },
      },
    });
    i += 1;
  }
  return out;
}

/**
 * Build ≥ DISCOVERY_SESSION_CAP invent/catalog accept-ready products for demo.
 * Uses Wave 1 scoring (demand gate off) so POOL_V2 / missing score cache cannot
 * blank the board. LIVE_SEARCH is never consulted.
 */
export function buildDemoScoredPool(onboarding: OnboardingRow): ScoredProduct[] {
  const scored = scoreRankCatalog(demoScoringProfile(onboarding));
  return padDemoScoredPool(scored, DISCOVERY_SESSION_CAP);
}

/**
 * Open an active discovery session with productsShown = 5 and showMoreUsed = 0.
 * Requires onboarding_profiles row. Pool is invent/catalog only.
 */
export async function seedDemoDiscoverySession(
  workspaceId: string,
): Promise<{
  productsShown: number;
  poolSize: number;
  showMoreUsed: number;
}> {
  await ensureMigrated();

  const onboarding = await db
    .select()
    .from(schema.onboardingProfiles)
    .where(eq(schema.onboardingProfiles.workspaceId, workspaceId))
    .then((rows) => rows[0]);

  if (!onboarding) {
    throw new Error("demo_seed_missing_onboarding");
  }

  const scored = buildDemoScoredPool(onboarding);
  if (scored.length < DISCOVERY_INITIAL_COUNT) {
    throw new Error("demo_seed_insufficient_accept_ready");
  }

  const session = await createActiveDiscoverySessionFromScored(
    workspaceId,
    scored,
  );
  if (!session) {
    throw new Error("demo_seed_session_failed");
  }

  return {
    productsShown: session.productsShown,
    poolSize: Math.min(DISCOVERY_SESSION_CAP, scored.length),
    showMoreUsed: session.showMoreUsed,
  };
}

/**
 * Wipe journey data then seed a full invent/catalog Discovery shortlist
 * (5 visible, Show more up to 25). Keeps login + onboarding.
 */
export async function restoreDemoDiscovery(
  workspaceId: string,
): Promise<{
  productsShown: number;
  poolSize: number;
  showMoreUsed: number;
}> {
  await resetWorkspaceJourney(workspaceId);
  return seedDemoDiscoverySession(workspaceId);
}
