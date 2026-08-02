/**
 * Pure helpers for SKU founder-notes save (explicit skuId — never activeSkuId).
 */

export type ParseSkuNotesFormResult =
  | { ok: true; skuId: string; notes: string }
  | { ok: false; error: "missing_sku" };

/** Require a non-empty skuId from the form; no active-SKU fallback. */
export function parseSkuNotesForm(input: {
  skuId: unknown;
  founderNotes: unknown;
}): ParseSkuNotesFormResult {
  const skuId = String(input.skuId ?? "").trim();
  if (!skuId) return { ok: false, error: "missing_sku" };
  return {
    ok: true,
    skuId,
    notes: String(input.founderNotes ?? ""),
  };
}

/**
 * Live-only notes target: owned card must be live (archived/wiped rejected).
 * Pure companion to assertSkuOwned + lifecycleStatus === "live".
 */
export function evaluateLiveSkuForNotes(args: {
  workspaceId: string;
  card: { workspaceId: string; lifecycleStatus: string } | null | undefined;
  journey: { workspaceId: string } | null | undefined;
}): { ok: true } | { ok: false; error: "not_found" | "wiped" | "foreign" | "not_live" } {
  const { workspaceId, card, journey } = args;
  if (!card || !journey) return { ok: false, error: "not_found" };
  if (card.lifecycleStatus === "wiped") return { ok: false, error: "wiped" };
  if (card.workspaceId !== workspaceId || journey.workspaceId !== workspaceId) {
    return { ok: false, error: "foreign" };
  }
  if (card.lifecycleStatus !== "live") return { ok: false, error: "not_live" };
  return { ok: true };
}
