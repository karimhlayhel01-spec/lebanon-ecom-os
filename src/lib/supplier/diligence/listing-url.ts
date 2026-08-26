/**
 * Client-safe listing URL helpers for Assess listing.
 * No fetch / Serper / db — safe to import from SupplierPanel.
 */

import { isLebanonAgentPlatform } from "@/lib/supplier/lebanon-agent-seat";

export function isHttpListingUrl(url: string | null | undefined): boolean {
  if (!url?.trim()) return false;
  try {
    const u = new URL(url.trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** Assess enabled only for real http(s) listing URLs. */
export function canAssessListingUrl(
  sourceUrl: string | null | undefined,
): boolean {
  return isHttpListingUrl(sourceUrl);
}

/** Hide Assess on lebanon_agent directory seats even when the site URL is https. */
export function shouldShowAssessListing(input: {
  platform?: string | null;
  sourceUrl?: string | null;
}): boolean {
  if (isLebanonAgentPlatform(input.platform)) return false;
  return canAssessListingUrl(input.sourceUrl);
}
