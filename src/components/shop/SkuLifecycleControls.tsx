"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import {
  archiveSkuAction,
  restoreSkuAction,
  wipeSkuAction,
} from "@/actions/sku";
import type { ArchiveWarning } from "@/lib/sku/lifecycle";

export function SkuLifecycleControls({
  skuId,
  lifecycleStatus,
  warnings,
}: {
  skuId: string;
  lifecycleStatus: string;
  warnings?: ArchiveWarning | null;
}) {
  const t = useTranslations("Shop");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (lifecycleStatus === "live") {
    return (
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          const lines = [t("archiveConfirm")];
          if (warnings?.sampleNotArrived) {
            lines.push(t("archiveWarnSample"));
          }
          if (warnings?.batchNotArrived) {
            lines.push(t("archiveWarnBatch"));
          }
          if (!window.confirm(lines.join("\n\n"))) return;
          startTransition(async () => {
            await archiveSkuAction(skuId);
            router.push("/dashboard?hub=1");
          });
        }}
        className="rounded-md border border-stone px-3 py-1.5 text-xs font-medium text-ink hover:bg-sand disabled:opacity-50"
      >
        {t("archive")}
      </button>
    );
  }

  if (lifecycleStatus === "archived") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            startTransition(async () => {
              await restoreSkuAction(skuId);
              router.refresh();
            });
          }}
          className="rounded-md bg-cedar px-3 py-1.5 text-xs font-semibold text-foam shadow-sm transition hover:bg-cedar-deep disabled:opacity-50"
        >
          {t("restore")}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            if (!window.confirm(t("wipeConfirm"))) return;
            startTransition(async () => {
              await wipeSkuAction(skuId);
              router.push("/dashboard?hub=1");
            });
          }}
          className="rounded-md border border-amber-400 px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-50 disabled:opacity-50"
        >
          {t("wipe")}
        </button>
      </div>
    );
  }

  return null;
}
