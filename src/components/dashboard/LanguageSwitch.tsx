"use client";

import { useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { setUiLanguageAction } from "@/actions/locale";
import type { AppLocale } from "@/i18n/routing";

/**
 * Compact EN ↔ AR control. Navigates to the same path under the other locale
 * and persists onboarding/workspace language via Shared Business Memory.
 */
export function LanguageSwitch() {
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const t = useTranslations("Dashboard");
  const [pending, startTransition] = useTransition();

  function switchTo(next: AppLocale) {
    if (next === locale || pending) return;
    startTransition(async () => {
      await setUiLanguageAction(next);
      router.replace(pathname, { locale: next });
    });
  }

  const baseBtn =
    "rounded px-2 py-1 text-xs font-semibold transition disabled:opacity-60";
  const activeBtn = `${baseBtn} bg-cedar/10 text-cedar-deep`;
  const idleBtn = `${baseBtn} text-stone-dark hover:bg-sand hover:text-ink`;

  return (
    <div
      role="group"
      aria-label={t("languageSwitch")}
      className="flex items-center gap-0.5 rounded-md border border-stone px-1 py-1"
    >
      <button
        type="button"
        disabled={pending}
        aria-pressed={locale === "en"}
        aria-label={t("languageEnFull")}
        onClick={() => switchTo("en")}
        className={locale === "en" ? activeBtn : idleBtn}
      >
        {t("languageEn")}
      </button>
      <span aria-hidden className="text-xs text-stone">
        |
      </span>
      <button
        type="button"
        disabled={pending}
        aria-pressed={locale === "ar"}
        aria-label={t("languageArFull")}
        onClick={() => switchTo("ar")}
        className={locale === "ar" ? activeBtn : idleBtn}
      >
        {t("languageAr")}
      </button>
    </div>
  );
}
