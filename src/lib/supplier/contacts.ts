/**
 * Founder-entered supplier email + WhatsApp (path or spare).
 * Never auto-filled from Serper / Assess / listing scrape.
 * Gate matches rename: owned + ≥1 sample_records for that supplierId.
 */

export const SUPPLIER_CONTACT_MAX = 120;

export type SaveSupplierContactsError =
  | "not_found"
  | "too_early"
  | "invalid_email"
  | "error";

export type SaveSupplierContactsEval =
  | {
      ok: true;
      contactEmail: string | null;
      contactWhatsapp: string | null;
    }
  | { ok: false; error: SaveSupplierContactsError };

/** Basic email shape — not full RFC. Empty → null. */
export function normalizeContactEmail(
  raw: string | null | undefined,
): { ok: true; value: string | null } | { ok: false; error: "invalid_email" } {
  const trimmed = (raw ?? "").trim().slice(0, SUPPLIER_CONTACT_MAX);
  if (!trimmed) return { ok: true, value: null };
  // Simple: local@domain with a dot in the domain.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return { ok: false, error: "invalid_email" };
  }
  return { ok: true, value: trimmed };
}

/**
 * Keep digits and a single leading +. Empty → null.
 * Does not invent a country code.
 */
export function normalizeContactWhatsapp(
  raw: string | null | undefined,
): string | null {
  const trimmed = (raw ?? "").trim().slice(0, SUPPLIER_CONTACT_MAX);
  if (!trimmed) return null;
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;
  const value = (hasPlus ? `+${digits}` : digits).slice(0, SUPPLIER_CONTACT_MAX);
  return value || null;
}

/** Digits-only for wa.me — null when no usable number. */
export function whatsappDigitsForLink(
  whatsapp: string | null | undefined,
): string | null {
  const digits = (whatsapp ?? "").replace(/\D/g, "");
  return digits.length > 0 ? digits : null;
}

export function buildWhatsAppChatUrl(
  whatsapp: string | null | undefined,
): string | null {
  const digits = whatsappDigitsForLink(whatsapp);
  if (!digits) return null;
  return `https://wa.me/${digits}`;
}

/**
 * Pure gate + normalize for founder contact save.
 * Both fields may be cleared to null in one write.
 */
export function evaluateSaveSupplierContacts(args: {
  supplierOwned: boolean;
  hasSampleRecord: boolean;
  emailRaw: string | null | undefined;
  whatsappRaw: string | null | undefined;
}): SaveSupplierContactsEval {
  if (!args.supplierOwned) return { ok: false, error: "not_found" };
  if (!args.hasSampleRecord) return { ok: false, error: "too_early" };

  const email = normalizeContactEmail(args.emailRaw);
  if (!email.ok) return email;

  return {
    ok: true,
    contactEmail: email.value,
    contactWhatsapp: normalizeContactWhatsapp(args.whatsappRaw),
  };
}
