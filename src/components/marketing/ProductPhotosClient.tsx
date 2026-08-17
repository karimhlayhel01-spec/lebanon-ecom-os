"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import {
  addPhotoToPackAction,
  clearPackMotionClipAction,
  createPhotoPackAction,
  deletePhotoPackAction,
  removePhotoFromPackAction,
  renamePhotoPackAction,
  setDefaultPhotoPackAction,
  setPackMotionClipAction,
} from "@/actions/photo-packs";
import {
  showPhotoPackDefaultControls,
  type PhotoPackDetail,
  type PhotoPackError,
} from "@/lib/marketing/visual-pack-ui";

const PHOTO_ACCEPT = "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp";
const CLIP_ACCEPT = "video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov";

function PackFileUpload({
  accept,
  disabled,
  hintLabel,
  buttonLabel,
  onPick,
}: {
  accept: string;
  disabled: boolean;
  hintLabel: string;
  buttonLabel: string;
  onPick: (file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [filename, setFilename] = useState<string | null>(null);

  useEffect(() => {
    if (!disabled) setFilename(null);
  }, [disabled]);

  return (
    <div className="mt-2">
      <p className="text-xs font-medium text-ink">{hintLabel}</p>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        disabled={disabled}
        tabIndex={-1}
        aria-label={buttonLabel}
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          setFilename(file.name);
          onPick(file);
        }}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        className="mt-1 rounded-md border border-cedar/40 bg-cedar/10 px-2.5 py-1 text-xs font-semibold text-cedar-deep hover:bg-cedar/15 disabled:opacity-50"
      >
        {buttonLabel}
      </button>
      {filename ? (
        <p className="mt-1 max-w-full truncate text-[11px] text-stone-dark">
          {filename}
        </p>
      ) : null}
    </div>
  );
}

export function ProductPhotosClient({
  skuId,
  packs,
}: {
  skuId: string;
  packs: PhotoPackDetail[];
}) {
  const t = useTranslations("Marketing");
  const [error, setError] = useState<PhotoPackError | null>(null);
  const [pending, startTransition] = useTransition();
  const showDefault = showPhotoPackDefaultControls(packs.length);

  function explain(code: PhotoPackError): string {
    if (code === "duplicate_name") return t("photoPacksErrorDuplicate");
    if (code === "too_large") return t("photoPacksErrorTooLarge");
    if (code === "bad_type") return t("photoPacksErrorBadType");
    if (code === "too_many") return t("photoPacksErrorTooMany");
    if (code === "invalid") return t("photoPacksErrorInvalid");
    return t("photoPacksErrorNotFound");
  }

  function run(fn: () => Promise<{ ok: true } | { ok: false; error: PhotoPackError }>) {
    startTransition(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) setError(res.error);
    });
  }

  return (
    <div className="mt-6 space-y-5">
      {error ? (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          {explain(error)}
        </p>
      ) : null}

      <form
        className="rounded-lg border border-stone bg-surface p-4"
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const fd = new FormData(form);
          run(async () => {
            const res = await createPhotoPackAction(skuId, fd);
            if (res.ok) form.reset();
            return res;
          });
        }}
      >
        <label className="block text-sm font-medium text-ink">
          {t("photoPacksNewName")}
          <input
            name="name"
            maxLength={80}
            placeholder={t("photoPacksNewNamePlaceholder")}
            className="mt-1 w-full rounded border border-stone px-2 py-1.5 outline-none focus:border-cedar"
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="mt-3 rounded-md bg-cedar px-3 py-1.5 text-sm font-semibold text-foam transition hover:bg-cedar-deep disabled:opacity-60"
        >
          {t("photoPacksCreate")}
        </button>
      </form>

      {packs.length === 0 ? (
        <p className="text-sm text-stone-dark">{t("photoPacksEmpty")}</p>
      ) : (
        packs.map((pack) => (
          <article
            key={pack.id}
            className="rounded-lg border border-stone bg-surface p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <h2 className="text-sm font-semibold text-ink">{pack.name}</h2>
                {showDefault && pack.isDefault ? (
                  <span className="rounded-full bg-cedar/10 px-2 py-0.5 text-[11px] font-medium text-cedar-deep">
                    {t("photoPacksDefaultBadge")}
                  </span>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {showDefault && !pack.isDefault ? (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      run(() => setDefaultPhotoPackAction(skuId, pack.id))
                    }
                    className="rounded border border-stone px-2 py-0.5 text-[11px] font-medium text-ink transition hover:bg-sand disabled:opacity-50"
                  >
                    {t("photoPacksSetDefault")}
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    if (!window.confirm(t("photoPacksDeleteConfirm"))) return;
                    run(() => deletePhotoPackAction(skuId, pack.id));
                  }}
                  className="rounded border border-stone px-2 py-0.5 text-[11px] font-medium text-stone-dark transition hover:bg-sand disabled:opacity-50"
                >
                  {t("photoPacksDelete")}
                </button>
              </div>
            </div>

            <form
              className="mt-3 flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                run(() => renamePhotoPackAction(skuId, pack.id, fd));
              }}
            >
              <label className="min-w-[12rem] flex-1 text-xs font-medium text-ink">
                {t("photoPacksRename")}
                <input
                  name="name"
                  required
                  maxLength={80}
                  defaultValue={pack.name}
                  className="mt-1 w-full rounded border border-stone px-2 py-1 outline-none focus:border-cedar"
                />
              </label>
              <button
                type="submit"
                disabled={pending}
                className="rounded border border-stone px-2 py-1 text-xs font-medium text-ink hover:bg-sand disabled:opacity-50"
              >
                {t("photoPacksSaveName")}
              </button>
            </form>

            <div className="mt-4">
              <p className="text-xs font-medium text-ink">{t("photoPacksPhotos")}</p>
              {pack.photos.length === 0 ? (
                <p className="mt-1 text-xs text-stone-dark">
                  {t("photoPacksNoPhotos")}
                </p>
              ) : (
                <ul className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {pack.photos.map((photo) => (
                    <li
                      key={photo.id}
                      className="overflow-hidden rounded border border-stone bg-surface-subtle"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={photo.href}
                        alt={photo.originalName}
                        className="h-28 w-full object-cover"
                      />
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() =>
                          run(() => removePhotoFromPackAction(skuId, photo.id))
                        }
                        className="w-full px-2 py-1 text-[11px] text-stone-dark hover:bg-sand disabled:opacity-50"
                      >
                        {t("photoPacksRemovePhoto")}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <PackFileUpload
                accept={PHOTO_ACCEPT}
                disabled={pending}
                hintLabel={t("photoPacksAddPhoto")}
                buttonLabel={t("photoPacksUploadPhoto")}
                onPick={(file) => {
                  const fd = new FormData();
                  fd.set("photo", file);
                  run(() => addPhotoToPackAction(skuId, pack.id, fd));
                }}
              />
            </div>

            <div className="mt-4 border-t border-stone/70 pt-3">
              <p className="text-xs font-medium text-ink">{t("photoPacksMotion")}</p>
              <p className="mt-0.5 text-[11px] text-stone-dark">
                {t("photoPacksMotionHint")}
              </p>
              {pack.motionClip ? (
                <div className="mt-2 space-y-2">
                  <video
                    src={pack.motionClip.href}
                    controls
                    className="max-h-40 w-full rounded border border-stone bg-black"
                  />
                  <p className="text-[11px] text-stone-dark">
                    {pack.motionClip.originalName}
                  </p>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      run(() => clearPackMotionClipAction(skuId, pack.id))
                    }
                    className="rounded border border-stone px-2 py-0.5 text-[11px] font-medium text-ink hover:bg-sand disabled:opacity-50"
                  >
                    {t("photoPacksRemoveMotion")}
                  </button>
                </div>
              ) : null}
              <PackFileUpload
                accept={CLIP_ACCEPT}
                disabled={pending}
                hintLabel={
                  pack.motionClip
                    ? t("photoPacksReplaceMotion")
                    : t("photoPacksAddMotion")
                }
                buttonLabel={t("photoPacksUploadMotion")}
                onPick={(file) => {
                  const fd = new FormData();
                  fd.set("clip", file);
                  run(() => setPackMotionClipAction(skuId, pack.id, fd));
                }}
              />
            </div>
          </article>
        ))
      )}
    </div>
  );
}
