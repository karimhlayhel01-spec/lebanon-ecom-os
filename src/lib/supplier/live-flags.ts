/**
 * Wave 3 Supplier env flags — live leads + Gmail (docs/WAVE-3.md).
 * Kept separate from journey `flags.ts` (per-SKU FSM resolution).
 */

function isTruthyEnvFlag(v: string | undefined): boolean {
  return v === "1" || v === "true";
}

/**
 * Allow one-shot live marketplace lead fill on ensureSuppliers / refresh.
 * Default off — Supplier panel must not burn search on every visit (Approach A).
 */
export function isSupplierLiveLeadsEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return isTruthyEnvFlag(env.SUPPLIER_LIVE_LEADS);
}

/** Optional Phase 3b — confirmed Gmail send via Zapier/MCP (not compose URL). */
export function isSupplierGmailSendEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return isTruthyEnvFlag(env.SUPPLIER_GMAIL_SEND);
}
