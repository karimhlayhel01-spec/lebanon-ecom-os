"use client";

import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { saveSupplierContactsAction } from "@/actions/supplier";
import { suppressSkuAutoScroll } from "@/lib/sku/suppress-auto-scroll";
import { SUPPLIER_CONTACT_MAX } from "@/lib/supplier/contacts";

/**
 * Founder email + WhatsApp after sample request (path or spare).
 * Shared by Shop hub Status (path only), SampleTracker, and Contact door —
 * not shortlist cards until a sample is requested.
 */
export function SupplierContactsEditor({
  supplierId,
  skuId,
  contactEmail,
  contactWhatsapp,
  compact = false,
  onSaved,
}: {
  supplierId: string;
  skuId: string;
  contactEmail: string | null;
  contactWhatsapp: string | null;
  compact?: boolean;
  onSaved?: (next: {
    contactEmail: string | null;
    contactWhatsapp: string | null;
  }) => void;
}) {
  const t = useTranslations("Supplier");
  const [editing, setEditing] = useState(false);
  const [emailDraft, setEmailDraft] = useState(contactEmail ?? "");
  const [whatsappDraft, setWhatsappDraft] = useState(contactWhatsapp ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (editing) return;
    setEmailDraft(contactEmail ?? "");
    setWhatsappDraft(contactWhatsapp ?? "");
  }, [contactEmail, contactWhatsapp, editing]);

  const hasAny = !!(contactEmail || contactWhatsapp);

  function startEdit() {
    setEmailDraft(contactEmail ?? "");
    setWhatsappDraft(contactWhatsapp ?? "");
    setError(null);
    setEditing(true);
  }

  function cancel() {
    setEmailDraft(contactEmail ?? "");
    setWhatsappDraft(contactWhatsapp ?? "");
    setError(null);
    setEditing(false);
  }

  function save() {
    setError(null);
    startTransition(async () => {
      suppressSkuAutoScroll(skuId);
      const res = await saveSupplierContactsAction(supplierId, {
        email: emailDraft,
        whatsapp: whatsappDraft,
      });
      if (!res.ok) {
        setError(
          res.error === "too_early"
            ? "contactsTooEarly"
            : res.error === "invalid_email"
              ? "contactsInvalidEmail"
              : res.error === "not_found"
                ? "contactsNotFound"
                : "errorGeneric",
        );
        return;
      }
      onSaved?.({
        contactEmail: res.contactEmail,
        contactWhatsapp: res.contactWhatsapp,
      });
      setEditing(false);
    });
  }

  if (editing) {
    return (
      <div className={compact ? "mt-2 space-y-2" : "mt-3 space-y-2"}>
        <label className="block space-y-1">
          <span className="text-[11px] font-medium text-stone-dark">
            {t("contactEmailLabel")}
          </span>
          <input
            type="email"
            value={emailDraft}
            maxLength={SUPPLIER_CONTACT_MAX}
            onChange={(e) => setEmailDraft(e.target.value)}
            disabled={pending}
            placeholder={t("contactEmailPlaceholder")}
            aria-label={t("contactEmailLabel")}
            className="w-full max-w-md rounded-md border border-stone bg-surface px-2 py-1 text-xs text-ink outline-none focus:border-cedar"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-[11px] font-medium text-stone-dark">
            {t("contactWhatsappLabel")}
          </span>
          <input
            type="tel"
            value={whatsappDraft}
            maxLength={SUPPLIER_CONTACT_MAX}
            onChange={(e) => setWhatsappDraft(e.target.value)}
            disabled={pending}
            placeholder={t("contactWhatsappPlaceholder")}
            aria-label={t("contactWhatsappLabel")}
            className="w-full max-w-md rounded-md border border-stone bg-surface px-2 py-1 text-xs text-ink outline-none focus:border-cedar"
          />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={save}
            className="rounded-md bg-cedar px-2.5 py-1 text-xs font-semibold text-foam transition hover:bg-cedar-deep disabled:opacity-50"
          >
            {t("contactsSave")}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={cancel}
            className="rounded-md border border-stone px-2.5 py-1 text-xs font-medium text-ink transition hover:bg-sand disabled:opacity-50"
          >
            {t("contactsCancel")}
          </button>
          {error && (
            <span className="text-[11px] text-amber-800">
              {t(error as never)}
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={compact ? "mt-2 space-y-1" : "mt-3 space-y-1"}>
      {hasAny ? (
        <div className="space-y-0.5 text-[11px] text-stone-dark">
          {contactEmail ? (
            <p className="truncate" title={contactEmail}>
              <span className="font-medium text-ink">{t("contactEmailLabel")}:</span>{" "}
              {contactEmail}
            </p>
          ) : null}
          {contactWhatsapp ? (
            <p className="truncate" title={contactWhatsapp}>
              <span className="font-medium text-ink">
                {t("contactWhatsappLabel")}:
              </span>{" "}
              {contactWhatsapp}
            </p>
          ) : null}
        </div>
      ) : (
        <p className="text-[11px] text-stone-dark">{t("contactsEmpty")}</p>
      )}
      <button
        type="button"
        onClick={startEdit}
        className="text-[11px] font-medium text-sea underline-offset-2 hover:underline"
      >
        {hasAny ? t("contactsEdit") : t("contactsAdd")}
      </button>
    </div>
  );
}
