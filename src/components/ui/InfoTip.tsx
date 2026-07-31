"use client";

import { useEffect, useId, useRef, useState } from "react";

/**
 * Compact ⓘ next to a field label. Opens a short popover on click/tap
 * (not hover-only) so it works on mobile. RTL-safe with `end-0` placement.
 */
export function InfoTip({
  text,
  ariaLabel,
}: {
  text: string;
  ariaLabel: string;
}) {
  const tipId = useId();
  const rootRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <span ref={rootRef} className="relative inline-flex shrink-0 align-middle">
      <button
        type="button"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={tipId}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="inline-flex size-6 items-center justify-center rounded-full text-sm font-semibold leading-none text-stone-dark transition hover:bg-sand hover:text-cedar-deep"
      >
        <span aria-hidden>ⓘ</span>
      </button>
      {open && (
        <span
          id={tipId}
          role="note"
          className="absolute end-0 top-full z-40 mt-1.5 w-64 max-w-[min(16rem,calc(100vw-2rem))] rounded-md border border-stone bg-surface px-3 py-2 text-xs leading-relaxed text-stone-dark shadow-sm"
        >
          {text}
        </span>
      )}
    </span>
  );
}
