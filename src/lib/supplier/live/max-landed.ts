/**
 * WAVE-3 — hide live supplier leads that cannot fit onboarding max landed.
 * No invent pad to cover holes. No Gemini FX.
 */

import { MAX_LANDED_SOFT_OVERAGE } from "@/lib/constants";
import type { SupplierLead } from "@/lib/supplier/live/types";

export type MaxLandedGate = {
  maxLandedCost: number;
  intlShip: number;
  clearanceTaxes: number;
  localCourier: number;
};

export function maxLandedGateFromOnboarding(
  maxLandedCost: number | null | undefined,
  money: {
    intlShip: number;
    clearanceTaxes: number;
    localCourier: number;
  },
): MaxLandedGate | null {
  if (maxLandedCost == null || !(maxLandedCost > 0)) return null;
  return {
    maxLandedCost,
    intlShip: money.intlShip,
    clearanceTaxes: money.clearanceTaxes,
    localCourier: money.localCourier,
  };
}

/** True when a known USD unit can sit under the founder cap (soft 1.2× on landed). */
export function leadFitsMaxLanded(input: {
  unitUsd: number;
  maxLandedCost: number;
  intlShip: number;
  clearanceTaxes: number;
  localCourier: number;
}): boolean {
  const { unitUsd, maxLandedCost, intlShip, clearanceTaxes, localCourier } =
    input;
  if (!(unitUsd > 0)) return false;
  if (!(maxLandedCost > 0)) return true;
  if (unitUsd > maxLandedCost) return false;
  const landed = unitUsd + intlShip + clearanceTaxes + localCourier;
  return landed <= maxLandedCost * MAX_LANDED_SOFT_OVERAGE;
}

function isAliExpressUrl(url: string | null | undefined): boolean {
  return (url ?? "").toLowerCase().includes("aliexpress.com");
}

/** AliExpress listing (platform or URL). Used for unknown-price keep. */
export function isAliExpressLead(lead: {
  platform?: string | null;
  sourceUrl?: string | null;
}): boolean {
  return lead.platform === "aliexpress" || isAliExpressUrl(lead.sourceUrl);
}

/**
 * WAVE-3 §3.4 AliExpress-first keep.
 * Drop only known-over-cap. Keep unknown AliExpress. Hide unknown Alibaba.
 */
export function keepImportLiveLead(
  lead: SupplierLead,
  gate: MaxLandedGate | null | undefined,
): boolean {
  const unit = lead.unitPriceHint;
  const known = unit != null && unit > 0;
  if (known) {
    if (!gate) return true;
    return leadFitsMaxLanded({ unitUsd: unit, ...gate });
  }
  return isAliExpressLead(lead);
}

export function gateLiveLeadsByMaxLanded(
  leads: readonly SupplierLead[],
  gate: MaxLandedGate | null | undefined,
): { kept: SupplierLead[]; hiddenOverCap: number } {
  const kept: SupplierLead[] = [];
  let hiddenOverCap = 0;
  for (const lead of leads) {
    if (!keepImportLiveLead(lead, gate)) {
      hiddenOverCap += 1;
      continue;
    }
    kept.push(lead);
  }
  return { kept, hiddenOverCap };
}

/** Assess extracted a USD unit over the founder cap — hide the Import live seat. */
export function importSeatShouldHideForMaxLanded(input: {
  source: string;
  leadSource: string | null | undefined;
  status: string;
  hasSample: boolean;
  unitUsd: number | null;
  gate: MaxLandedGate | null;
}): boolean {
  if (input.source !== "import") return false;
  if (input.leadSource !== "live_search") return false;
  if (input.status !== "available") return false;
  if (input.hasSample) return false;
  if (input.unitUsd == null || !(input.unitUsd > 0) || !input.gate) return false;
  return !leadFitsMaxLanded({ unitUsd: input.unitUsd, ...input.gate });
}
