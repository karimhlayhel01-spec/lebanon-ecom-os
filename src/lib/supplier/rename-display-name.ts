/**
 * Founder-facing supplier display rename after sample request.
 * SoT remains supplier_options.name — no separate hub display field.
 */

import { clampSupplierDisplayName } from "@/lib/supplier/live/company-name";

export type RenameSupplierDisplayNameError =
  | "not_found"
  | "too_early"
  | "empty"
  | "error";

export type RenameSupplierDisplayNameEval =
  | { ok: true; name: string }
  | { ok: false; error: RenameSupplierDisplayNameError };

/**
 * Pure gate + name normalize for founder rename.
 * Allow only when the supplier is owned and has ≥1 sample_records row.
 */
export function evaluateRenameSupplierDisplayName(args: {
  supplierOwned: boolean;
  hasSampleRecord: boolean;
  nextNameRaw: string;
}): RenameSupplierDisplayNameEval {
  if (!args.supplierOwned) return { ok: false, error: "not_found" };
  if (!args.hasSampleRecord) return { ok: false, error: "too_early" };
  const name = clampSupplierDisplayName(args.nextNameRaw);
  if (name.length < 2) return { ok: false, error: "empty" };
  return { ok: true, name };
}
