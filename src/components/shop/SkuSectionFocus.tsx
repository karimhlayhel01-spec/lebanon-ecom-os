"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  consumeDeepLinkIfUnlocked,
  isSkuAutoScrollSuppressed,
  shouldBlockSkuFocusScroll,
  skuFocusLocationKey,
} from "@/lib/sku/suppress-auto-scroll";

const SECTION_IDS = [
  "product",
  "supplier",
  "store",
  "marketing",
  "finance",
] as const;

type SectionId = (typeof SECTION_IDS)[number];

const ATTN_KEYS = [
  "sample",
  "costs",
  "batch",
  "store",
  "arrived",
  "selling",
  "topicA",
] as const;

type AttnKey = (typeof ATTN_KEYS)[number];

function isSectionId(id: string): id is SectionId {
  return (SECTION_IDS as readonly string[]).includes(id);
}

function isAttnKey(id: string): id is AttnKey {
  return (ATTN_KEYS as readonly string[]).includes(id);
}

function sectionLabel(
  section: SectionId,
  t: ReturnType<typeof useTranslations<"Shop">>,
): string {
  switch (section) {
    case "product":
      return t("sectionProduct");
    case "supplier":
      return t("sectionSupplier");
    case "store":
      return t("sectionStore");
    case "marketing":
      return t("sectionMarketing");
    case "finance":
      return t("sectionFinance");
  }
}

function normalizeSectionId(raw: string | null | undefined): SectionId | null {
  if (!raw) return null;
  const id = raw.replace(/^#/, "");
  return isSectionId(id) ? id : null;
}

/**
 * Hub chips / Tools with `#section` (and optional `attn`): soft-scroll + highlight.
 * Cold open (no hash / attn): once per visit; blocked by durable sample-action lock.
 * Finance is never a cold target — hub → /sku/[id] in selling / batch_arrived_ready
 * must land calm (top/hero). Explicit #finance / Topic A clicks still scroll.
 * Remount with leftover ?attn=#finance after sample buttons: stay put.
 */
function SkuSectionFocusInner({
  skuId,
  coldFocusSection = null,
}: {
  skuId: string;
  coldFocusSection?: string | null;
}) {
  const t = useTranslations("Shop");
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const attnParam = searchParams.get("attn");
  const [banner, setBanner] = useState<string | null>(null);
  /** Same-instance effect re-runs must not re-scroll cold open. */
  const didColdScrollRef = useRef(false);

  useEffect(() => {
    let clearHighlight: ReturnType<typeof setTimeout> | undefined;
    let clearBanner: ReturnType<typeof setTimeout> | undefined;
    let activeEl: HTMLElement | null = null;

    function apply() {
      const hashRaw = window.location.hash;
      const locationKey = skuFocusLocationKey(
        pathname,
        window.location.search,
        hashRaw,
      );
      const hashSection = normalizeSectionId(hashRaw.replace(/^#/, ""));
      const attn = attnParam && isAttnKey(attnParam) ? attnParam : null;
      const coldRaw = normalizeSectionId(coldFocusSection);
      // Never auto-scroll to Topic A / finance on cold open — only explicit CTAs.
      const cold = coldRaw === "finance" ? null : coldRaw;

      const fromDeepLink = !!(hashSection || attn);
      const fromCold = !hashSection && !attn && !!cold;
      const section = hashSection ?? (fromCold ? cold : null);

      if (activeEl) {
        activeEl.classList.remove("sku-section-focus");
        activeEl = null;
      }
      if (clearHighlight) clearTimeout(clearHighlight);
      if (clearBanner) clearTimeout(clearBanner);

      if (!section) {
        setBanner(null);
        return;
      }

      const el = document.getElementById(section);
      if (!el) {
        setBanner(null);
        return;
      }

      if (fromDeepLink) {
        // New hub Next URL → clear lock + scroll. Same URL after sample action → stay.
        if (!consumeDeepLinkIfUnlocked(skuId, locationKey)) {
          setBanner(null);
          return;
        }
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      } else if (fromCold) {
        // Absolute: sample-card lock never cold-scrolls.
        if (
          isSkuAutoScrollSuppressed(skuId) ||
          shouldBlockSkuFocusScroll(skuId, locationKey) ||
          didColdScrollRef.current
        ) {
          setBanner(null);
          return;
        }
        didColdScrollRef.current = true;
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      }

      activeEl = el;
      el.classList.add("sku-section-focus");
      clearHighlight = setTimeout(() => {
        el.classList.remove("sku-section-focus");
        if (activeEl === el) activeEl = null;
      }, 2800);

      const label = attn ? t(`chip.${attn}`) : sectionLabel(section, t);
      setBanner(t("sectionFocusNext", { label }));
      clearBanner = setTimeout(() => setBanner(null), 3200);
    }

    const delay = (() => {
      const hash = window.location.hash.replace(/^#/, "");
      if (hash || attnParam) return 50;
      if (normalizeSectionId(coldFocusSection)) return 120;
      return 50;
    })();

    const start = window.setTimeout(apply, delay);
    window.addEventListener("hashchange", apply);
    return () => {
      window.clearTimeout(start);
      window.removeEventListener("hashchange", apply);
      if (clearHighlight) clearTimeout(clearHighlight);
      if (clearBanner) clearTimeout(clearBanner);
      if (activeEl) activeEl.classList.remove("sku-section-focus");
    };
  }, [attnParam, coldFocusSection, pathname, skuId, t]);

  if (!banner) return null;

  return (
    <div
      role="status"
      className="mt-4 rounded-md border border-sea/25 bg-sea/[0.04] px-3 py-2 text-sm font-medium text-sea animate-rise"
    >
      {banner}
    </div>
  );
}

export function SkuSectionFocus({
  skuId,
  coldFocusSection = null,
}: {
  skuId: string;
  /**
   * Primary StageHero CTA section id (e.g. `supplier`) when landing without
   * #hash/attn. `finance` is ignored (no cold scroll to Topic A).
   */
  coldFocusSection?: string | null;
}) {
  return (
    <Suspense fallback={null}>
      <SkuSectionFocusInner
        skuId={skuId}
        coldFocusSection={coldFocusSection}
      />
    </Suspense>
  );
}
