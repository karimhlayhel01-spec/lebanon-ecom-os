"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useLocale, useTranslations } from "next-intl";
import {
  GLOSSARY,
  VOCAB_PHASES,
  type GlossaryTermId,
  type VocabPhase,
} from "@/lib/vocabulary/glossary";

/**
 * App-wide Vocabulary sidebar. Opens from the header on dashboard + deep pages.
 * All journey phases stay visible; search filters client-side; soft-highlights
 * the section matching the current journey when known.
 */
export function VocabularyDrawer({
  highlightPhase,
}: {
  highlightPhase: VocabPhase | null;
}) {
  const t = useTranslations("Vocabulary");
  const locale = useLocale();
  const isAr = locale === "ar";
  const panelId = useId();
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  const close = useCallback(() => {
    setOpen(false);
  }, []);

  useEffect(() => {
    if (!open) return;

    previouslyFocused.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const triggerEl = triggerRef.current;

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusTimer = window.setTimeout(() => {
      searchRef.current?.focus();
    }, 0);

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;

      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
      const restore = previouslyFocused.current ?? triggerEl;
      restore?.focus();
    };
  }, [open, close]);

  const filteredByPhase = useMemo(() => {
    const q = query.trim().toLowerCase();
    const result: Partial<Record<VocabPhase, GlossaryTermId[]>> = {};

    for (const phase of VOCAB_PHASES) {
      const ids = GLOSSARY.filter((entry) => entry.phases.includes(phase))
        .map((entry) => entry.id)
        .filter((id) => {
          if (!q) return true;
          const term = t(`terms.${id}.term`).toLowerCase();
          const meaning = t(`terms.${id}.meaning`).toLowerCase();
          const definition = t(`terms.${id}.definition`).toLowerCase();
          return (
            term.includes(q) || meaning.includes(q) || definition.includes(q)
          );
        });
      if (ids.length > 0) result[phase] = ids;
    }
    return result;
  }, [query, t]);

  const hasResults = VOCAB_PHASES.some((phase) => filteredByPhase[phase]);

  const drawer =
    open &&
    typeof document !== "undefined" &&
    createPortal(
      <div className="fixed inset-0 z-[80]" role="presentation">
        <button
          type="button"
          aria-label={t("close")}
          className="absolute inset-0 bg-ink/40"
          onClick={close}
        />
        <div
          ref={panelRef}
          id={panelId}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className="absolute inset-y-0 end-0 flex w-full max-w-md flex-col border-s border-stone bg-surface shadow-sm"
        >
          <div className="flex items-start justify-between gap-3 border-b border-stone px-4 py-3.5">
            <div className="min-w-0">
              <h2
                id={titleId}
                className="font-display text-lg font-semibold text-ink"
              >
                {t("title")}
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-stone-dark">
                {t("guidance")}
              </p>
            </div>
            <button
              type="button"
              onClick={close}
              aria-label={t("close")}
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-ink transition hover:bg-sand"
            >
              <span aria-hidden className="text-xl leading-none">
                ×
              </span>
            </button>
          </div>

          <div className="border-b border-stone px-4 py-3">
            <input
              ref={searchRef}
              id={`${panelId}-search`}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("searchPlaceholder")}
              aria-label={t("searchLabel")}
              dir="auto"
              className="w-full rounded-md border border-stone bg-surface px-3 py-2 text-sm text-ink outline-none transition focus:border-cedar focus:ring-2 focus:ring-cedar/20"
            />
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-4">
            {!hasResults ? (
              <p className="text-sm text-stone-dark">{t("noResults")}</p>
            ) : (
              <div className="space-y-6">
                {VOCAB_PHASES.map((phase) => {
                  const ids = filteredByPhase[phase];
                  if (!ids?.length) return null;
                  const isCurrent = highlightPhase === phase;
                  return (
                    <section
                      key={phase}
                      className={`rounded-lg border p-3 ${
                        isCurrent
                          ? "border-cedar/40 bg-cedar/5"
                          : "border-stone bg-surface-subtle"
                      }`}
                    >
                      <div className="mb-3 flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-semibold text-ink">
                          {t(`phases.${phase}`)}
                        </h3>
                        {isCurrent ? (
                          <span className="rounded-md bg-cedar/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-cedar-deep">
                            {t("currentPhaseBadge")}
                          </span>
                        ) : null}
                      </div>
                      <ul className="space-y-3">
                        {ids.map((id) => (
                          <li
                            key={`${phase}-${id}`}
                            className="rounded-md border border-stone bg-surface px-3 py-2.5"
                          >
                            <p className="text-sm font-semibold text-ink" dir="auto">
                              {t(`terms.${id}.term`)}
                            </p>
                            {isAr ? (
                              <p
                                className="mt-0.5 text-xs font-medium text-cedar-deep"
                                dir="auto"
                              >
                                {t(`terms.${id}.meaning`)}
                              </p>
                            ) : null}
                            <p
                              className="mt-1.5 text-xs leading-relaxed text-stone-dark"
                              dir="auto"
                            >
                              {t(`terms.${id}.definition`)}
                            </p>
                            <p className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-stone-dark">
                              {t("whyLabel")}
                            </p>
                            <p
                              className="mt-0.5 text-xs leading-relaxed text-ink"
                              dir="auto"
                            >
                              {t(`terms.${id}.why.${phase}`)}
                            </p>
                          </li>
                        ))}
                      </ul>
                    </section>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>,
      document.body,
    );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={t("open")}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex size-8 items-center justify-center rounded-md text-stone-dark transition hover:bg-sand hover:text-cedar-deep sm:size-9"
      >
        <BookIcon />
      </button>
      {drawer}
    </>
  );
}

function BookIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className="size-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5z" />
      <path d="M8 7h8M8 11h6" />
    </svg>
  );
}
