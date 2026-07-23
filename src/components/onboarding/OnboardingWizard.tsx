"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import {
  completeOnboardingAction,
  type OnboardingActionState,
} from "@/actions/onboarding";
import {
  MIN_BUDGET_USD,
  CLEARANCE_PARTNER_TBD,
  INDUSTRY_OPTIONS,
  type IndustryOptionId,
} from "@/lib/constants";

const initial: OnboardingActionState = {};

const fieldClass =
  "rounded-md border border-stone bg-surface px-3 py-2.5 text-ink outline-none transition focus:border-cedar focus:ring-2 focus:ring-cedar/20";

export type OnboardingInitialValues = {
  budgetUsd: number;
  monthlyFollowOnBudget: number;
  hoursPerWeek: number;
  experience: string;
  uiLanguage: string;
  storageDescription: string;
  storageLimits: string;
  riskTolerance: string;
  categoryLikes: string[];
  shopifyStatus: string;
  codComfort: string;
  deliveryBandDays: string;
  maxLandedCost: number;
  lebanonSellabilityAck: boolean;
  sampleClearanceReady: boolean;
};

export function OnboardingWizard({
  initialValues,
}: {
  initialValues?: OnboardingInitialValues;
}) {
  const t = useTranslations("Onboarding");
  const isEditing = Boolean(initialValues);
  const [step, setStep] = useState(0);
  const [selectedIndustries, setSelectedIndustries] = useState<
    Set<IndustryOptionId>
  >(
    new Set(
      (initialValues?.categoryLikes ?? []).filter((id): id is IndustryOptionId =>
        (INDUSTRY_OPTIONS as readonly string[]).includes(id),
      ),
    ),
  );
  const [industryError, setIndustryError] = useState(false);
  const [state, formAction, pending] = useActionState(
    completeOnboardingAction,
    initial,
  );

  const steps = [t("stepBudget"), t("stepProfile"), t("stepLebanon")];

  function toggleIndustry(id: IndustryOptionId) {
    setSelectedIndustries((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setIndustryError(false);
  }

  function goNext() {
    if (step === 1 && selectedIndustries.size === 0) {
      setIndustryError(true);
      return;
    }
    setStep((s) => Math.min(2, s + 1));
  }

  return (
    <form action={formAction} className="mx-auto w-full max-w-2xl">
      <ol className="mb-8 flex gap-2">
        {steps.map((label, i) => (
          <li
            key={label}
            className={`flex-1 rounded-md border px-3 py-2 text-center text-xs font-medium md:text-sm ${
              i === step
                ? "border-cedar bg-cedar text-foam"
                : i < step
                  ? "border-cedar/30 bg-cedar/10 text-cedar-deep"
                  : "border-stone bg-surface text-stone-dark"
            }`}
          >
            {label}
          </li>
        ))}
      </ol>

      <div className={step === 0 ? "flex flex-col gap-4" : "hidden"}>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">{t("budgetUsd")}</span>
          <input
            name="budgetUsd"
            type="number"
            min={MIN_BUDGET_USD}
            step="100"
            defaultValue={initialValues?.budgetUsd ?? MIN_BUDGET_USD}
            required
            className={fieldClass}
          />
          <span className="text-xs text-stone-dark">{t("budgetHint")}</span>
          {state.fieldErrors?.budgetUsd && (
            <span className="text-xs text-red-700">{t("budgetError")}</span>
          )}
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">{t("monthlyFollowOn")}</span>
          <input
            name="monthlyFollowOnBudget"
            type="number"
            min={0}
            step="50"
            defaultValue={initialValues?.monthlyFollowOnBudget ?? 500}
            required
            className={fieldClass}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">{t("hoursPerWeek")}</span>
          <input
            name="hoursPerWeek"
            type="number"
            min={1}
            max={168}
            defaultValue={initialValues?.hoursPerWeek ?? 10}
            required
            className={fieldClass}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">{t("experience")}</span>
          <select
            name="experience"
            defaultValue={initialValues?.experience ?? "beginner"}
            className={fieldClass}
          >
            <option value="beginner">{t("experienceBeginner")}</option>
            <option value="some">{t("experienceSome")}</option>
            <option value="experienced">{t("experienceExperienced")}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">{t("maxLandedCost")}</span>
          <input
            name="maxLandedCost"
            type="number"
            min={0}
            step="1"
            defaultValue={initialValues?.maxLandedCost ?? 25}
            required
            className={fieldClass}
          />
        </label>
      </div>

      <div className={step === 1 ? "flex flex-col gap-4" : "hidden"}>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">{t("uiLanguage")}</span>
          <select
            name="uiLanguage"
            defaultValue={initialValues?.uiLanguage ?? "en"}
            className={fieldClass}
          >
            <option value="en">{t("langEn")}</option>
            <option value="ar">{t("langAr")}</option>
            <option value="both">{t("langBoth")}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">{t("storageDescription")}</span>
          <textarea
            name="storageDescription"
            required
            rows={2}
            className={fieldClass}
            defaultValue={initialValues?.storageDescription ?? "Home / small storage"}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">{t("storageLimits")}</span>
          <textarea
            name="storageLimits"
            required
            rows={2}
            className={fieldClass}
            defaultValue={
              initialValues?.storageLimits ?? "Limited space; no hazardous goods"
            }
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">{t("riskTolerance")}</span>
          <select
            name="riskTolerance"
            defaultValue={initialValues?.riskTolerance ?? "medium"}
            className={fieldClass}
          >
            <option value="low">{t("riskLow")}</option>
            <option value="medium">{t("riskMedium")}</option>
            <option value="high">{t("riskHigh")}</option>
          </select>
        </label>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">{t("categoryLikes")}</legend>
          <p className="text-xs text-stone-dark">{t("categoryLikesHint")}</p>
          <ul className="mt-1 grid gap-2 sm:grid-cols-2">
            {INDUSTRY_OPTIONS.map((id) => (
              <li key={id}>
                <label
                  className={`flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 text-sm transition ${
                    selectedIndustries.has(id)
                      ? "border-cedar bg-cedar/5"
                      : "border-stone bg-surface hover:border-cedar/40"
                  }`}
                >
                  <input
                    type="checkbox"
                    name="categoryLikes"
                    value={id}
                    checked={selectedIndustries.has(id)}
                    onChange={() => toggleIndustry(id)}
                    className="mt-0.5 size-4 shrink-0 accent-cedar"
                  />
                  <span>{t(`industries.${id}`)}</span>
                </label>
              </li>
            ))}
          </ul>
          {(industryError || state.fieldErrors?.categoryLikes) && (
            <p className="text-xs text-red-700" role="alert">
              {t("categoryLikesRequired")}
            </p>
          )}
        </fieldset>

        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">{t("shopifyStatus")}</span>
          <select
            name="shopifyStatus"
            defaultValue={initialValues?.shopifyStatus ?? "not_started"}
            className={fieldClass}
          >
            <option value="not_started">{t("shopifyNotStarted")}</option>
            <option value="in_progress">{t("shopifyInProgress")}</option>
            <option value="ready">{t("shopifyReady")}</option>
          </select>
        </label>
      </div>

      <div className={step === 2 ? "flex flex-col gap-4" : "hidden"}>
        <div className="rounded-md border border-stone bg-sand px-4 py-3">
          <p className="font-display text-base text-ink">{t("codNoticeTitle")}</p>
          <p className="mt-1 text-sm leading-relaxed text-stone-dark">
            {t("codNoticeBody")}
          </p>
        </div>
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            name="lebanonSellabilityAck"
            required
            defaultChecked={initialValues?.lebanonSellabilityAck ?? false}
            className="mt-1 size-4 accent-cedar"
          />
          <span>{t("lebanonSellability")}</span>
        </label>
        {state.fieldErrors?.lebanonSellabilityAck && (
          <p className="text-xs text-red-700">{t("lebanonRequired")}</p>
        )}
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">{t("codComfort")}</span>
          <textarea
            name="codComfort"
            required
            rows={3}
            className={fieldClass}
            defaultValue={
              initialValues?.codComfort ??
              "Comfortable with COD; will track refusals."
            }
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">{t("deliveryBand")}</span>
          <input
            name="deliveryBandDays"
            required
            defaultValue={initialValues?.deliveryBandDays ?? "7-10"}
            className={fieldClass}
          />
        </label>
        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            name="sampleClearanceReady"
            defaultChecked={initialValues?.sampleClearanceReady ?? false}
            className="mt-1 size-4 accent-cedar"
          />
          <span>{t("sampleClearance")}</span>
        </label>
        <p className="text-xs text-stone-dark">{t("couriersNote")}</p>
        <p className="text-xs text-stone-dark">
          {t("clearanceNote")} {CLEARANCE_PARTNER_TBD}
        </p>
      </div>

      {state.error && (
        <p className="mt-4 text-sm text-red-700" role="alert">
          {state.error === "budgetError"
            ? t("budgetError")
            : state.error === "lebanonRequired"
              ? t("lebanonRequired")
              : state.error === "categoryLikesRequired"
                ? t("categoryLikesRequired")
                : t("errorGeneric")}
        </p>
      )}

      <div className="mt-8 flex justify-between gap-3">
        <button
          type="button"
          disabled={step === 0}
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          className="rounded-md border border-stone bg-surface px-4 py-2.5 text-sm font-medium text-ink transition hover:bg-sand disabled:opacity-40"
        >
          {t("back")}
        </button>
        {step < 2 ? (
          <button
            key="onboarding-next"
            type="button"
            onClick={goNext}
            className="rounded-md bg-cedar px-5 py-2.5 text-sm font-semibold text-foam shadow-sm transition hover:bg-cedar-deep"
          >
            {t("next")}
          </button>
        ) : (
          <button
            key="onboarding-submit"
            type="submit"
            disabled={pending || selectedIndustries.size === 0}
            className="rounded-md bg-cedar px-5 py-2.5 text-sm font-semibold text-foam shadow-sm transition hover:bg-cedar-deep disabled:opacity-60"
          >
            {isEditing ? t("saveChanges") : t("submit")}
          </button>
        )}
      </div>
    </form>
  );
}
