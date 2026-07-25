"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import {
  loginAction,
  signupAction,
  type AuthActionState,
} from "@/actions/auth";

type Mode = "login" | "signup";

const initial: AuthActionState = {};

export function AuthForm({ mode }: { mode: Mode }) {
  const t = useTranslations("Auth");
  const action = mode === "signup" ? signupAction : loginAction;
  const [state, formAction, pending] = useActionState(action, initial);

  const inputClass =
    "rounded-md border border-stone bg-surface px-3 py-2.5 text-ink outline-none transition focus:border-cedar focus:ring-2 focus:ring-cedar/20";

  return (
    <form action={formAction} className="flex w-full flex-col gap-4">
      {mode === "signup" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-ink">{t("firstName")}</span>
            <input
              name="firstName"
              required
              maxLength={60}
              autoComplete="given-name"
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-ink">{t("lastName")}</span>
            <input
              name="lastName"
              required
              maxLength={60}
              autoComplete="family-name"
              className={inputClass}
            />
          </label>
        </div>
      )}
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-ink">{t("email")}</span>
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
          className={inputClass}
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-ink">{t("password")}</span>
        <input
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          className={inputClass}
        />
      </label>
      {state.error && (
        <p className="text-sm text-red-700" role="alert">
          {t(state.error as "errorGeneric")}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="mt-2 rounded-md bg-cedar px-4 py-3 text-sm font-semibold text-foam shadow-sm transition hover:bg-cedar-deep disabled:opacity-60"
      >
        {mode === "signup" ? t("submitSignup") : t("submitLogin")}
      </button>
      <p className="text-sm text-stone-dark">
        {mode === "signup" ? t("haveAccount") : t("needAccount")}{" "}
        <Link
          href={mode === "signup" ? "/auth/login" : "/auth/signup"}
          className="font-medium text-sea underline-offset-4 hover:underline"
        >
          {mode === "signup" ? t("submitLogin") : t("submitSignup")}
        </Link>
      </p>
    </form>
  );
}
