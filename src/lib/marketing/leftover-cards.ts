/**
 * Partial-kit leftover cards for the amber note (badge N + in-page Show).
 * Does not guess leftovers when templateIds is empty.
 */

export type LeftoverShowTarget = { id: string; badge: number };

export function leftoverShowTargets(args: {
  source: string | null | undefined;
  templateIds: string[];
  badgeById: Record<string, number>;
  geminiConfigured: boolean;
  geminiCapReached: boolean;
}): LeftoverShowTarget[] {
  if (args.source !== "partial") return [];
  if (!args.geminiConfigured || args.geminiCapReached) return [];
  if (!args.templateIds.length) return [];
  const seen = new Set<string>();
  const out: LeftoverShowTarget[] = [];
  for (const id of args.templateIds) {
    if (seen.has(id)) continue;
    const badge = args.badgeById[id];
    if (typeof badge !== "number" || badge < 1) continue;
    seen.add(id);
    out.push({ id, badge });
  }
  out.sort((a, b) => a.badge - b.badge);
  return out;
}

/** Badge list in card order — EN “4 and 9” / “4, 7, and 9”; AR uses و. */
export function formatCardNumberList(
  badges: number[],
  locale: "en" | "ar",
): string {
  if (badges.length === 0) return "";
  if (badges.length === 1) return String(badges[0]);
  if (locale === "ar") {
    if (badges.length === 2) return `${badges[0]} و ${badges[1]}`;
    return `${badges.slice(0, -1).join("، ")}، و ${badges[badges.length - 1]}`;
  }
  if (badges.length === 2) return `${badges[0]} and ${badges[1]}`;
  return `${badges.slice(0, -1).join(", ")}, and ${badges[badges.length - 1]}`;
}
