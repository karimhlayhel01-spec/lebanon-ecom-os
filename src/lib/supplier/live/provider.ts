/**
 * Wave 3 — single bind point for live supplier leads (docs/WAVE-3.md).
 * Mirrors Discovery’s provider seam: jobs/ensure call this; UI never live-searches.
 */

import { isSupplierLiveLeadsEnabled } from "@/lib/supplier/live-flags";
import {
  gatherImportLeadsWithSerper,
  gatherLocalLeadsWithSerper,
} from "@/lib/supplier/live/serper-leads";
import type {
  GatherSupplierLeadsInput,
  GatherSupplierLeadsResult,
  SupplierLead,
} from "@/lib/supplier/live/types";

export type SupplierLeadProvider = {
  readonly id: "serper" | "noop";
  gatherLeads(input: GatherSupplierLeadsInput): Promise<GatherSupplierLeadsResult>;
};

const noopProvider: SupplierLeadProvider = {
  id: "noop",
  async gatherLeads() {
    return { leads: [], queriesUsed: 0, noop: true };
  },
};

/**
 * Production bind point. When SUPPLIER_LIVE_LEADS is off → noop.
 * When on → Serper (reuse SERPER_API_KEY) for Import + Local; missing key → noop.
 */
export function getSupplierLeadProvider(
  env: Record<string, string | undefined> = process.env,
): SupplierLeadProvider {
  if (!isSupplierLiveLeadsEnabled(env)) return noopProvider;
  const key = env.SERPER_API_KEY?.trim();
  if (!key) return noopProvider;
  return {
    id: "serper",
    gatherLeads: (input) =>
      input.source === "local"
        ? gatherLocalLeadsWithSerper(input, key)
        : gatherImportLeadsWithSerper(input, key),
  };
}

export type { GatherSupplierLeadsInput, GatherSupplierLeadsResult, SupplierLead };
