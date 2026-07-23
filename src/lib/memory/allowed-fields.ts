/**
 * Allowed-field edit policy for the Shared Business Memory.
 *
 * The memory is *system-written*: agents and server actions own most fields.
 * Founders may only edit an explicit allow-list of fields per entity. Any
 * attempt to edit a field outside the allow-list is rejected before it reaches
 * the database. This keeps the memory a trustworthy single source of truth.
 */

export const FOUNDER_EDITABLE_FIELDS = {
  workspace: ["name", "language"],
  onboardingProfile: [
    "budgetUsd",
    "monthlyFollowOnBudget",
    "hoursPerWeek",
    "experience",
    "uiLanguage",
    "storageDescription",
    "storageLimits",
    "riskTolerance",
    "categoryLikes",
    "codComfort",
    "shopifyStatus",
    "maxLandedCost",
    "deliveryBandDays",
    "sampleClearanceReady",
  ],
  skuCard: ["founderNotes"],
  storeReadiness: [
    "checklist",
    "storeUrl",
    "whatsappNumber",
    "courierChoice",
  ],
  marketingKit: ["items"],
} as const satisfies Record<string, readonly string[]>;

export type MemoryEntity = keyof typeof FOUNDER_EDITABLE_FIELDS;

export type FounderEditableField<E extends MemoryEntity> =
  (typeof FOUNDER_EDITABLE_FIELDS)[E][number];

export function isFounderEditable(
  entity: MemoryEntity,
  field: string,
): boolean {
  return (FOUNDER_EDITABLE_FIELDS[entity] as readonly string[]).includes(field);
}

export type AllowedFieldCheck =
  | { ok: true }
  | { ok: false; disallowed: string[] };

/** Returns the fields in `patch` that a founder is NOT allowed to edit. */
export function checkFounderEditable(
  entity: MemoryEntity,
  patch: Record<string, unknown>,
): AllowedFieldCheck {
  const disallowed = Object.keys(patch).filter(
    (field) => !isFounderEditable(entity, field),
  );
  return disallowed.length === 0 ? { ok: true } : { ok: false, disallowed };
}

export class FounderEditError extends Error {
  readonly disallowed: string[];
  constructor(entity: MemoryEntity, disallowed: string[]) {
    super(
      `Founder edit rejected for "${entity}": fields not editable — ${disallowed.join(
        ", ",
      )}`,
    );
    this.name = "FounderEditError";
    this.disallowed = disallowed;
  }
}

/**
 * Returns a patch containing only the founder-editable fields present in the
 * input, throwing {@link FounderEditError} if any disallowed field is present.
 * Fields set to `undefined` are ignored so callers can pass partials freely.
 * The value types of the input patch are preserved.
 */
export function enforceFounderEdit<
  E extends MemoryEntity,
  P extends Record<string, unknown>,
>(entity: E, patch: P): Partial<P> {
  const defined = Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  ) as Partial<P>;
  const check = checkFounderEditable(
    entity,
    defined as Record<string, unknown>,
  );
  if (!check.ok) {
    throw new FounderEditError(entity, check.disallowed);
  }
  return defined;
}
