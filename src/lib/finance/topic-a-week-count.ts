/**
 * side_statuses.topicAWeekCount mirrors Topic A row count.
 * Source of truth = COUNT(topic_a_entries), never read-then-plus-one.
 */
export function topicAWeekCountFromRowCount(rowCount: number): number {
  if (!Number.isFinite(rowCount)) return 0;
  return Math.max(0, Math.floor(rowCount));
}
