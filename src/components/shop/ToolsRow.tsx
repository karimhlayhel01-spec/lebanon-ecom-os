"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import type { ToolsUnlockFlags } from "@/lib/sku/tools";

export type ToolsRowProps = {
  hrefs: {
    store: string;
    supplier: string | null;
    marketing: string | null;
    finance: string | null;
  };
  unlocked: ToolsUnlockFlags;
  /** Quieter chrome for SKU page — still fully clickable. */
  quiet?: boolean;
};

function ToolChip({
  href,
  unlocked,
  label,
  lockTitle,
  quiet,
}: {
  href: string | null;
  unlocked: boolean;
  label: string;
  lockTitle: string;
  quiet: boolean;
}) {
  const chipClass = quiet
    ? "rounded-full border border-stone/50 bg-transparent px-2.5 py-1 text-[11px] font-medium text-stone-dark transition hover:border-sea/30 hover:bg-sea/5 hover:text-sea"
    : "rounded-full border border-stone bg-surface px-3 py-1.5 text-xs font-medium text-ink transition hover:border-sea/40 hover:bg-sea/5 hover:text-sea";
  const lockedClass = quiet
    ? "cursor-not-allowed rounded-full border border-stone/40 bg-transparent px-2.5 py-1 text-[11px] font-medium text-stone-dark/50"
    : "cursor-not-allowed rounded-full border border-stone/60 bg-surface-subtle px-3 py-1.5 text-xs font-medium text-stone-dark/60";

  if (!unlocked || !href) {
    return (
      <span className={lockedClass} title={lockTitle} aria-disabled="true">
        {label}
      </span>
    );
  }
  return (
    <Link href={href} className={chipClass}>
      {label}
    </Link>
  );
}

/**
 * Compact Tools shortcuts — Store (shop) + SKU sections.
 * Journey CTAs stay on hub chips / SKU hero; this is navigation only.
 */
export function ToolsRow({ hrefs, unlocked, quiet = false }: ToolsRowProps) {
  const t = useTranslations("Dashboard");

  return (
    <nav
      aria-label={t("toolsLabel")}
      className="flex flex-wrap items-center gap-2"
    >
      <span
        className={
          quiet
            ? "text-[10px] font-medium uppercase tracking-wide text-stone-dark/70"
            : "text-xs font-medium uppercase tracking-wide text-stone-dark"
        }
      >
        {t("toolsLabel")}
      </span>
      <ToolChip
        href={hrefs.store}
        unlocked={unlocked.store}
        label={t("toolStore")}
        lockTitle={t("toolLockedStore")}
        quiet={quiet}
      />
      <ToolChip
        href={hrefs.supplier}
        unlocked={unlocked.supplier}
        label={t("toolSupplier")}
        lockTitle={t("toolLockedSupplier")}
        quiet={quiet}
      />
      <ToolChip
        href={hrefs.marketing}
        unlocked={unlocked.marketing}
        label={t("toolMarketing")}
        lockTitle={t("toolLockedMarketing")}
        quiet={quiet}
      />
      <ToolChip
        href={hrefs.finance}
        unlocked={unlocked.finance}
        label={t("toolFinance")}
        lockTitle={t("toolLockedFinance")}
        quiet={quiet}
      />
    </nav>
  );
}
