/**
 * WAVE-2 §14 Other-text classifier — keyword fixtures, not Gemini.
 * Maps to one INDUSTRY_OPTIONS id, none (out of OS), or unmapped (rank hint only).
 */

import type { IndustryOptionId } from "@/lib/constants";

export type OtherIndustryKind = "industry" | "none" | "unmapped";

export type OtherIndustryResult =
  | { kind: "industry"; id: IndustryOptionId }
  | { kind: "none" }
  | { kind: "unmapped" };

function norm(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}

const NONE_NEEDLES = [
  "used car",
  "used cars",
  "car dealership",
  "dealership",
  "bakery",
  "cooked food",
  "restaurant",
  "sofa",
  "sofas",
  "furniture",
  "wedding dress",
  "wedding dresses",
  "bulky apparel",
  "apartment",
  "apartments",
  "rent an apartment",
  "real estate",
] as const;

const MAP_NEEDLES: readonly { id: IndustryOptionId; needles: readonly string[] }[] =
  [
    {
      id: "home_kitchen",
      needles: [
        "painting",
        "paintings",
        "canvas print",
        "canvas prints",
        "diamond painting",
        "diamond-painting",
        "poster",
        "posters",
      ],
    },
  ];

/**
 * Classify founder Other text. Empty → unmapped (caller should not treat as none
 * unless Other is the only selection — see resolveOtherRetrieveIndustry).
 */
export function classifyOtherIndustry(raw: string): OtherIndustryResult {
  const t = norm(raw);
  if (!t) return { kind: "unmapped" };
  if (NONE_NEEDLES.some((n) => t.includes(n))) return { kind: "none" };
  for (const row of MAP_NEEDLES) {
    if (row.needles.some((n) => t.includes(n))) {
      return { kind: "industry", id: row.id };
    }
  }
  return { kind: "unmapped" };
}

/**
 * What category to retrieve for Other.
 * - mapped industry → that id
 * - none, or unmapped with no industry chips → null (don’t-deal)
 * - unmapped with chips → null here (caller retrieves the chips; Other is rank hint)
 */
export function resolveOtherRetrieveIndustry(
  otherText: string,
  selectedIndustryIds: readonly IndustryOptionId[],
): IndustryOptionId | null {
  const classified = classifyOtherIndustry(otherText);
  if (classified.kind === "industry") return classified.id;
  if (classified.kind === "none") return null;
  if (selectedIndustryIds.length > 0) return null;
  return null;
}

export function isOtherDontDeal(
  otherText: string,
  selectedIndustryIds: readonly IndustryOptionId[],
): boolean {
  const classified = classifyOtherIndustry(otherText);
  if (classified.kind === "industry") return false;
  if (classified.kind === "none") return true;
  return selectedIndustryIds.length === 0 && otherText.trim().length > 0;
}
