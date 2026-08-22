/**
 * WAVE-2 §14.13 — outbound listing href from a stored pool URL only.
 * Same http(s) allow-list as pool photos. Never invent a Google search.
 * No fetch / SerpAPI / Serper / Gemini.
 */

import { sanitizeHttpUrl } from "@/lib/discovery/normalize";

export function listingHrefFromStoredSourceUrl(
  raw: string | null | undefined,
): string | null {
  return sanitizeHttpUrl(raw);
}
