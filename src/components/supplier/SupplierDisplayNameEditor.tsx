"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { renameSupplierDisplayNameAction } from "@/actions/supplier";
import { suppressSkuAutoScroll } from "@/lib/sku/suppress-auto-scroll";
import { SUPPLIER_DISPLAY_NAME_MAX } from "@/lib/supplier/live/company-name";

/**
 * Inline founder rename for supplier_options.name after sample request.
 * Shared by SampleTracker + Shop hub / Status — not shortlist cards.
 * Root is span/inline-flex so it can sit inside text rows without nesting a div in a p.
 */
export function SupplierDisplayNameEditor({
  supplierId,
  skuId,
  name,
  nameClassName = "text-sm font-semibold text-ink",
  compact = false,
}: {
  supplierId: string;
  skuId: string;
  name: string;
  nameClassName?: string;
  /** Hub chip: tighter control row. */
  compact?: boolean;
}) {
  const t = useTranslations("Supplier");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const displayName = editing ? draft : name;

  function startEdit() {
    setDraft(name);
    setError(null);
    setEditing(true);
  }

  function cancel() {
    setDraft(name);
    setError(null);
    setEditing(false);
  }

  function save() {
    setError(null);
    startTransition(async () => {
      suppressSkuAutoScroll(skuId);
      const res = await renameSupplierDisplayNameAction(supplierId, draft);
      if (!res.ok) {
        setError(
          res.error === "too_early"
            ? "renameTooEarly"
            : res.error === "empty"
              ? "renameEmpty"
              : res.error === "not_found"
                ? "renameNotFound"
                : "errorGeneric",
        );
        return;
      }
      setEditing(false);
    });
  }

  if (editing) {
    return (
      <span className={`block ${compact ? "space-y-1" : "mt-0.5 space-y-1.5"}`}>
        <input
          type="text"
          value={draft}
          maxLength={SUPPLIER_DISPLAY_NAME_MAX}
          onChange={(e) => setDraft(e.target.value)}
          disabled={pending}
          aria-label={t("renameLabel")}
          className={`w-full max-w-md rounded-md border border-stone bg-surface px-2 py-1 outline-none focus:border-cedar ${
            compact ? "text-xs" : "text-sm"
          } text-ink [unicode-bidi:plaintext]`}
        />
        <span className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={pending || draft.trim().length < 2}
            onClick={save}
            className="rounded-md bg-cedar px-2.5 py-1 text-xs font-semibold text-foam transition hover:bg-cedar-deep disabled:opacity-50"
          >
            {t("renameSave")}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={cancel}
            className="rounded-md border border-stone px-2.5 py-1 text-xs font-medium text-ink transition hover:bg-sand disabled:opacity-50"
          >
            {t("renameCancel")}
          </button>
          {error && (
            <span className="text-[11px] text-amber-800">
              {t(error as never)}
            </span>
          )}
        </span>
      </span>
    );
  }

  return (
    <span className="inline-flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <span
        className={`min-w-0 truncate [unicode-bidi:plaintext] ${nameClassName}`}
        title={displayName}
      >
        {displayName}
      </span>
      <button
        type="button"
        onClick={startEdit}
        className="shrink-0 text-[11px] font-medium text-sea underline-offset-2 hover:underline"
      >
        {t("rename")}
      </button>
    </span>
  );
}
