"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { logoutAction } from "@/actions/auth";
import { pauseShopAction } from "@/actions/sku";
import {
  changePasswordAction,
  deleteAccountAction,
  logoutEverywhereAction,
  renameWorkspaceAction,
  type SettingsActionState,
} from "@/actions/settings";

type Panel = "menu" | "password" | "rename" | "delete";

const initial: SettingsActionState = {};

const fieldClass =
  "w-full rounded-md border border-stone bg-surface px-3 py-2 text-sm text-ink outline-none transition focus:border-cedar focus:ring-2 focus:ring-cedar/20";

const menuBtnClass =
  "w-full rounded-md px-3 py-2 text-start text-sm font-medium text-ink transition hover:bg-sand";

export function SettingsMenu({
  email,
  workspaceName,
  isPaused = false,
}: {
  email: string;
  workspaceName: string;
  /** When false, Pause shop is offered in this menu (Resume stays in the header). */
  isPaused?: boolean;
}) {
  const t = useTranslations("Settings");
  const tDash = useTranslations("Dashboard");
  const tAuth = useTranslations("Auth");
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<Panel>("menu");

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setPanel("menu");
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        setPanel("menu");
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function close() {
    setOpen(false);
    setPanel("menu");
  }

  function toggle() {
    setOpen((prev) => {
      if (prev) setPanel("menu");
      return !prev;
    });
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={t("open")}
        onClick={toggle}
        className="inline-flex size-9 items-center justify-center rounded-md text-ink transition hover:bg-sand hover:text-cedar-deep sm:size-11"
      >
        <span aria-hidden className="text-xl leading-none sm:text-2xl">
          ⚙
        </span>
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          className="absolute end-0 z-50 mt-2 w-80 max-w-[min(20rem,calc(100vw-1.5rem))] rounded-md border border-stone bg-surface p-2 shadow-sm"
        >
          {panel === "menu" && (
            <div className="flex flex-col gap-0.5">
              <p
                className="truncate px-3 py-2 text-xs text-stone-dark"
                dir="auto"
              >
                {t("signedInAs", { email })}
              </p>
              <button
                type="button"
                role="menuitem"
                className={menuBtnClass}
                onClick={() => {
                  close();
                  router.push("/finance/history");
                }}
              >
                {t("financeHistoryLink")}
              </button>
              <button
                type="button"
                role="menuitem"
                className={menuBtnClass}
                onClick={() => {
                  close();
                  router.push("/onboarding?edit=1");
                }}
              >
                {t("editOnboarding")}
              </button>
              {!isPaused && (
                <form action={pauseShopAction}>
                  <button
                    type="submit"
                    role="menuitem"
                    title={tDash("pauseShopTitle")}
                    className={menuBtnClass}
                  >
                    {t("pauseShop")}
                  </button>
                </form>
              )}
              <button
                type="button"
                role="menuitem"
                className={menuBtnClass}
                onClick={() => setPanel("password")}
              >
                {t("changePassword")}
              </button>
              <button
                type="button"
                role="menuitem"
                className={menuBtnClass}
                onClick={() => setPanel("rename")}
              >
                {t("renameWorkspace")}
              </button>
              <form action={logoutAction}>
                <button type="submit" role="menuitem" className={menuBtnClass}>
                  {tAuth("logout")}
                </button>
              </form>
              <form action={logoutEverywhereAction}>
                <button type="submit" role="menuitem" className={menuBtnClass}>
                  {t("logoutEverywhere")}
                </button>
              </form>
              <button
                type="button"
                role="menuitem"
                className="w-full rounded-md px-3 py-2 text-start text-sm font-medium text-red-700 transition hover:bg-red-50"
                onClick={() => setPanel("delete")}
              >
                {t("deleteAccount")}
              </button>
            </div>
          )}

          {panel === "password" && (
            <PasswordPanel onBack={() => setPanel("menu")} onDone={close} />
          )}

          {panel === "rename" && (
            <RenamePanel
              workspaceName={workspaceName}
              onBack={() => setPanel("menu")}
              onDone={() => {
                close();
                router.refresh();
              }}
            />
          )}

          {panel === "delete" && (
            <DeletePanel onBack={() => setPanel("menu")} />
          )}
        </div>
      )}
    </div>
  );
}

function PanelHeader({
  title,
  onBack,
  backLabel,
}: {
  title: string;
  onBack: () => void;
  backLabel: string;
}) {
  return (
    <div className="mb-2 flex items-center gap-2 border-b border-stone px-1 pb-2">
      <button
        type="button"
        onClick={onBack}
        className="rounded-md px-2 py-1 text-xs font-medium text-sea transition hover:bg-sand"
      >
        {backLabel}
      </button>
      <p className="text-sm font-semibold text-ink">{title}</p>
    </div>
  );
}

function PasswordPanel({
  onBack,
  onDone,
}: {
  onBack: () => void;
  onDone: () => void;
}) {
  const t = useTranslations("Settings");
  const [state, formAction, pending] = useActionState(
    changePasswordAction,
    initial,
  );
  const doneRef = useRef(onDone);

  useEffect(() => {
    doneRef.current = onDone;
  }, [onDone]);

  useEffect(() => {
    if (state.success) doneRef.current();
  }, [state.success]);

  return (
    <div>
      <PanelHeader
        title={t("changePasswordTitle")}
        onBack={onBack}
        backLabel={t("back")}
      />
      <form action={formAction} className="flex flex-col gap-3 px-1 pb-1">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-ink">{t("currentPassword")}</span>
          <input
            name="currentPassword"
            type="password"
            required
            autoComplete="current-password"
            className={fieldClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-ink">{t("newPassword")}</span>
          <input
            name="newPassword"
            type="password"
            required
            minLength={8}
            maxLength={200}
            autoComplete="new-password"
            className={fieldClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-ink">{t("confirmPassword")}</span>
          <input
            name="confirmPassword"
            type="password"
            required
            minLength={8}
            maxLength={200}
            autoComplete="new-password"
            className={fieldClass}
          />
        </label>
        {state.error && (
          <p className="text-xs text-red-700" role="alert">
            {t(state.error as "errorGeneric")}
          </p>
        )}
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-cedar px-3 py-2 text-sm font-semibold text-foam transition hover:bg-cedar-deep disabled:opacity-60"
        >
          {t("savePassword")}
        </button>
      </form>
    </div>
  );
}

function RenamePanel({
  workspaceName,
  onBack,
  onDone,
}: {
  workspaceName: string;
  onBack: () => void;
  onDone: () => void;
}) {
  const t = useTranslations("Settings");
  const [state, formAction, pending] = useActionState(
    renameWorkspaceAction,
    initial,
  );
  const doneRef = useRef(onDone);

  useEffect(() => {
    doneRef.current = onDone;
  }, [onDone]);

  useEffect(() => {
    if (state.success) doneRef.current();
  }, [state.success]);

  return (
    <div>
      <PanelHeader
        title={t("renameWorkspaceTitle")}
        onBack={onBack}
        backLabel={t("back")}
      />
      <form action={formAction} className="flex flex-col gap-3 px-1 pb-1">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-ink">{t("workspaceName")}</span>
          <input
            name="name"
            required
            maxLength={80}
            defaultValue={workspaceName}
            dir="auto"
            className={fieldClass}
          />
        </label>
        {state.error && (
          <p className="text-xs text-red-700" role="alert">
            {t(state.error as "errorGeneric")}
          </p>
        )}
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-cedar px-3 py-2 text-sm font-semibold text-foam transition hover:bg-cedar-deep disabled:opacity-60"
        >
          {t("saveWorkspaceName")}
        </button>
      </form>
    </div>
  );
}

function DeletePanel({ onBack }: { onBack: () => void }) {
  const t = useTranslations("Settings");
  const [state, formAction, pending] = useActionState(
    deleteAccountAction,
    initial,
  );

  return (
    <div>
      <PanelHeader
        title={t("deleteAccountTitle")}
        onBack={onBack}
        backLabel={t("back")}
      />
      <form action={formAction} className="flex flex-col gap-3 px-1 pb-1">
        <p className="text-xs leading-relaxed text-stone-dark">
          {t("deleteAccountWarning")}
        </p>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-ink">{t("currentPassword")}</span>
          <input
            name="currentPassword"
            type="password"
            required
            autoComplete="current-password"
            className={fieldClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-ink">{t("deleteConfirmLabel")}</span>
          <input
            name="confirmToken"
            required
            autoComplete="off"
            placeholder="DELETE"
            className={fieldClass}
          />
        </label>
        {state.error && (
          <p className="text-xs text-red-700" role="alert">
            {t(state.error as "errorGeneric")}
          </p>
        )}
        <button
          type="submit"
          disabled={pending}
          className="rounded-md border border-red-700 bg-red-700 px-3 py-2 text-sm font-semibold text-white transition hover:bg-red-800 disabled:opacity-60"
        >
          {t("deleteAccountConfirm")}
        </button>
      </form>
    </div>
  );
}
