"use client";

import { useEffect, useId, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import {
  canRegenerateVisual,
  type VisualGenKind,
} from "@/lib/marketing/visual-pack-ui";

const subscribeNoop = () => () => {};
const getMountedClient = () => true;
const getMountedServer = () => false;

export function VisualResultDialog({
  href,
  kind,
  regenerateCount,
  usedGeneric,
  pending,
  honesty,
  onClose,
  onSave,
  onRegenerate,
  onDiscard,
}: {
  href: string;
  kind: VisualGenKind;
  regenerateCount: number;
  usedGeneric: boolean;
  pending: boolean;
  honesty: string | null;
  onClose: () => void;
  onSave: () => void;
  onRegenerate: () => void;
  onDiscard: () => void;
}) {
  const t = useTranslations("Marketing");
  const titleId = useId();
  const mounted = useSyncExternalStore(
    subscribeNoop,
    getMountedClient,
    getMountedServer,
  );
  const canRegen = canRegenerateVisual(regenerateCount);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[90]" role="presentation">
      <button
        type="button"
        aria-label={t("visualGenClose")}
        className="absolute inset-0 bg-ink/40"
        onClick={onClose}
      />
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className="pointer-events-auto max-h-[min(90vh,44rem)] w-full max-w-lg overflow-y-auto rounded-lg border border-stone bg-surface p-5 shadow-sm"
        >
          <h2 id={titleId} className="text-sm font-semibold text-ink">
            {t("visualGenTitle")}
          </h2>
          <div className="mt-3 overflow-hidden rounded border border-stone bg-black">
            {kind === "clip" ? (
              <video
                src={href}
                controls
                className="max-h-72 w-full"
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={href}
                alt=""
                className="max-h-72 w-full object-contain"
              />
            )}
          </div>
          {usedGeneric ? (
            <p className="mt-2 text-xs text-stone-dark">
              {t("visualGenHonestyNoPack")}
            </p>
          ) : null}
          {honesty ? (
            <p className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-950">
              {honesty}
            </p>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={onSave}
              className="rounded-md bg-cedar px-3 py-1.5 text-xs font-semibold text-foam hover:bg-cedar-deep disabled:opacity-50"
            >
              {t("visualGenSave")}
            </button>
            <button
              type="button"
              disabled={pending || !canRegen}
              onClick={onRegenerate}
              className="rounded-md border border-cedar/40 bg-cedar/10 px-3 py-1.5 text-xs font-semibold text-cedar-deep hover:bg-cedar/15 disabled:opacity-50"
            >
              {pending ? t("visualGenGenerating") : t("visualGenRegenerate")}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={onDiscard}
              className="rounded-md border border-stone px-3 py-1.5 text-xs font-medium text-ink hover:bg-sand disabled:opacity-50"
            >
              {t("visualGenDiscard")}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={onClose}
              className="rounded-md border border-stone px-3 py-1.5 text-xs font-medium text-stone-dark hover:bg-sand disabled:opacity-50"
            >
              {t("visualGenClose")}
            </button>
          </div>
          {!canRegen ? (
            <p className="mt-2 text-[11px] text-stone-dark">
              {t("visualGenRegenDisabled")}
            </p>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
