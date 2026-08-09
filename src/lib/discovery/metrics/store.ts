/**
 * WAVE-2 §7 "Measure" — append-only persistence for Discovery counters.
 *
 * This module writes exactly one table: `discovery_metric_events`. It must
 * never touch scores, candidates, approvals, or journey rows — measuring the
 * funnel may not change the funnel.
 *
 * Recording is best-effort by design: a metrics write that fails must never
 * break a founder action, so callers get `false` instead of a thrown error.
 */

import { and, eq, gte, lte } from "drizzle-orm";
import { db, ensureMigrated, schema } from "@/db";
import { newId, nowIso } from "@/lib/ids";
import {
  type DiscoveryMetricEvent,
  type DiscoveryMetricKind,
  type DiscoveryMetricWindow,
} from "@/lib/discovery/metrics/events";

export type RecordDiscoveryMetricInput = {
  workspaceId: string;
  kind: DiscoveryMetricKind;
  /** Identity of the event; a repeat of the same key is silently dropped. */
  dedupeKey: string;
  sessionId?: string | null;
  /** Typed action error code only — never founder-facing text or PII. */
  errorCode?: string | null;
  at?: string;
};

/**
 * Append one event, ignoring a repeat of the same `dedupeKey`. The dedupe is a
 * unique index rather than a read-then-write so two concurrent renders cannot
 * both find "not recorded yet" and both insert.
 *
 * Returns whether the call completed, not whether a row was added — a deduped
 * event and a written event are both a success from the caller's side.
 */
export async function recordDiscoveryMetric(
  input: RecordDiscoveryMetricInput,
): Promise<boolean> {
  try {
    await ensureMigrated();
    const at = input.at ?? nowIso();
    await db
      .insert(schema.discoveryMetricEvents)
      .values({
        id: newId(),
        workspaceId: input.workspaceId,
        sessionId: input.sessionId ?? null,
        kind: input.kind,
        errorCode: input.errorCode ?? null,
        dedupeKey: input.dedupeKey,
        createdAt: at,
      })
      .onConflictDoNothing({
        target: schema.discoveryMetricEvents.dedupeKey,
      });
    return true;
  } catch {
    // Measurement is never worth failing a founder action for.
    return false;
  }
}

/**
 * Load events for aggregation. Bounds are inclusive ISO timestamps; omit both
 * for everything recorded so far.
 */
export async function loadDiscoveryMetricEvents(
  window: DiscoveryMetricWindow = {},
  workspaceId?: string,
): Promise<DiscoveryMetricEvent[]> {
  await ensureMigrated();
  const filters = [
    window.from
      ? gte(schema.discoveryMetricEvents.createdAt, window.from)
      : undefined,
    window.to
      ? lte(schema.discoveryMetricEvents.createdAt, window.to)
      : undefined,
    workspaceId
      ? eq(schema.discoveryMetricEvents.workspaceId, workspaceId)
      : undefined,
  ].filter((f): f is NonNullable<typeof f> => f !== undefined);

  const rows = await db
    .select({
      kind: schema.discoveryMetricEvents.kind,
      sessionId: schema.discoveryMetricEvents.sessionId,
      errorCode: schema.discoveryMetricEvents.errorCode,
      createdAt: schema.discoveryMetricEvents.createdAt,
    })
    .from(schema.discoveryMetricEvents)
    .where(filters.length > 0 ? and(...filters) : undefined);

  return rows.map((r) => ({
    kind: r.kind as DiscoveryMetricKind,
    sessionId: r.sessionId,
    errorCode: r.errorCode,
    createdAt: r.createdAt,
  }));
}
