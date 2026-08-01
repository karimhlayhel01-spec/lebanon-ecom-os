/**
 * Temporary DEMO journey reset — gated by DEMO_RESET=1|true.
 * Testing + live demos only. Not Wave 2 / MCP / API / AI automation.
 */
export function isDemoResetEnabled(): boolean {
  const v = process.env.DEMO_RESET;
  return v === "1" || v === "true";
}
