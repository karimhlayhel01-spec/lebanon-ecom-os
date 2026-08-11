/**
 * Temporary DEMO journey reset — gated by DEMO_RESET=1|true.
 * Testing + live demos only. Not Wave 2 / MCP / API / AI automation.
 *
 * Production safety: DEMO_RESET alone is not enough when NODE_ENV=production.
 * Also require DEMO_RESET_ALLOW_PRODUCTION=1|true (explicit opt-in).
 */

function isTruthyEnvFlag(v: string | undefined): boolean {
  return v === "1" || v === "true";
}

export function isDemoResetEnabled(): boolean {
  if (!isTruthyEnvFlag(process.env.DEMO_RESET)) return false;
  if (process.env.NODE_ENV !== "production") return true;
  return isTruthyEnvFlag(process.env.DEMO_RESET_ALLOW_PRODUCTION);
}

/** Wipe-to-empty is for local/dev only — never offer it in production. */
export function isDemoWipeEmptyEnabled(): boolean {
  return isDemoResetEnabled() && process.env.NODE_ENV !== "production";
}
