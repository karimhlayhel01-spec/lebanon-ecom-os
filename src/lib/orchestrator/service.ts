import { eq } from "drizzle-orm";
import { db, ensureMigrated, schema } from "@/db";
import { getJourney } from "@/lib/memory/repos";

/**
 * Orchestrator — decides the founder's next best actions and coaching.
 *
 * It reads the Shared Business Memory and derives:
 *  - Next CTA(s): one or more actions for the current journey state. After
 *    `sample_approved`, batch and store CTAs run in PARALLEL (store never blocks
 *    batch).
 *  - Coaching cards: contextual tips, ordered by the fixed priority ladder
 *    safety → margins → budget/experience → risk → likes.
 *
 * CTAs respect approvals implicitly: a CTA is only offered when its journey
 * state / gate preconditions are already satisfied.
 */

export type OrchestratorCta = {
  id: string;
  anchor: string; // dashboard section id to jump to
  tone: "primary" | "parallel" | "side";
};

export type CoachingCard = {
  id: string;
  priority: number; // 0 safety … 4 likes
  tone: "safety" | "margins" | "budget" | "risk" | "likes";
};

export type Orchestration = {
  stateKey: string;
  parallel: boolean;
  ctas: OrchestratorCta[];
  coaching: CoachingCard[];
};

const PRIORITY = {
  safety: 0,
  margins: 1,
  budget: 2,
  risk: 3,
  likes: 4,
} as const;

export async function getOrchestration(
  workspaceId: string,
): Promise<Orchestration | null> {
  ensureMigrated();
  const [journey, side, workspace, suppliers] = await Promise.all([
    getJourney(workspaceId),
    db
      .select()
      .from(schema.sideStatuses)
      .where(eq(schema.sideStatuses.workspaceId, workspaceId))
      .get(),
    db
      .select()
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, workspaceId))
      .get(),
    db
      .select({
        role: schema.supplierOptions.role,
        moq: schema.supplierOptions.moq,
        unitPrice: schema.supplierOptions.unitPrice,
      })
      .from(schema.supplierOptions)
      .where(eq(schema.supplierOptions.workspaceId, workspaceId))
      .all(),
  ]);
  if (!journey) return null;

  const state = journey.primaryState;
  const ctas: OrchestratorCta[] = [];
  let parallel = false;

  if (state === "paused") {
    ctas.push({ id: "resume", anchor: "top", tone: "primary" });
  } else if (state === "blocked") {
    ctas.push({ id: "unblock", anchor: "top", tone: "primary" });
  } else if (state === "discovery") {
    ctas.push({ id: "discovery", anchor: "discovery", tone: "primary" });
  } else if (state === "supplier_sample") {
    if (side?.sampleStatus === "in_flight") {
      ctas.push({ id: "sampleDecision", anchor: "supplier", tone: "primary" });
    } else if (side?.sampleStatus === "rejected") {
      ctas.push({ id: "sampleRetry", anchor: "supplier", tone: "primary" });
    } else {
      ctas.push({ id: "requestSample", anchor: "supplier", tone: "primary" });
    }
  } else if (state === "sample_approved" || state === "store_setup") {
    // Parallel: order the batch and set up the store side-by-side.
    parallel = true;
    if (!side?.costQuotesSaved) {
      ctas.push({ id: "costQuotes", anchor: "supplier", tone: "primary" });
    }
    ctas.push({ id: "orderBatch", anchor: "supplier", tone: side?.costQuotesSaved ? "primary" : "parallel" });
    ctas.push({ id: "storeSetup", anchor: "store", tone: "parallel" });
    ctas.push({ id: "marketingIntro", anchor: "marketing", tone: "side" });
  } else if (state === "batch_ordered") {
    parallel = true;
    ctas.push({ id: "markArrived", anchor: "supplier", tone: "primary" });
    ctas.push({ id: "preLaunch", anchor: "marketing", tone: "parallel" });
    if (!side?.storeReady) {
      ctas.push({ id: "storeSetup", anchor: "store", tone: "side" });
    }
  } else if (state === "batch_arrived_ready") {
    parallel = true;
    ctas.push({ id: "startSelling", anchor: "finance", tone: "primary" });
    ctas.push({ id: "launchKit", anchor: "marketing", tone: "parallel" });
  } else if (state === "selling") {
    parallel = true;
    ctas.push({ id: "logWeek", anchor: "finance", tone: "primary" });
    ctas.push({ id: "refreshKit", anchor: "marketing", tone: "parallel" });
  }

  // -------------------------------------------------------------------------
  // Coaching (ordered by the fixed priority ladder)
  // -------------------------------------------------------------------------
  const coaching: CoachingCard[] = [];
  const hasSku = !!workspace?.activeSkuId;
  const preBatch = ["supplier_sample", "sample_approved", "store_setup"].includes(
    state,
  );
  const anyOverLimit = suppliers.some(
    (s) => (s.unitPrice + 2) * s.moq > 10000,
  );

  // safety
  if (preBatch) {
    coaching.push({ id: "sampleFirst", priority: PRIORITY.safety, tone: "safety" });
  }
  if (state === "selling" || side?.storeReady) {
    coaching.push({ id: "codRisk", priority: PRIORITY.safety, tone: "safety" });
  }
  // margins
  if (hasSku) {
    coaching.push({ id: "protectMargins", priority: PRIORITY.margins, tone: "margins" });
  }
  if (
    (state === "sample_approved" || state === "store_setup") &&
    !side?.costQuotesSaved
  ) {
    coaching.push({
      id: "costQuotesPending",
      priority: PRIORITY.margins,
      tone: "margins",
    });
  }
  // budget / experience
  if (preBatch || state === "batch_ordered") {
    coaching.push({ id: "startSmall", priority: PRIORITY.budget, tone: "budget" });
  }
  // risk
  if (anyOverLimit && (state === "sample_approved" || state === "store_setup")) {
    coaching.push({ id: "over10k", priority: PRIORITY.risk, tone: "risk" });
  }
  // likes (soft)
  if (state === "discovery") {
    coaching.push({ id: "likesSoft", priority: PRIORITY.likes, tone: "likes" });
  }

  coaching.sort((a, b) => a.priority - b.priority);

  return { stateKey: state, parallel, ctas, coaching };
}
