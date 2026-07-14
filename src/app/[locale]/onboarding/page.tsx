import { getTranslations, setRequestLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { getSessionUser } from "@/lib/auth";
import { getDashboardContext } from "@/lib/workspace";
import {
  OnboardingWizard,
  type OnboardingInitialValues,
} from "@/components/onboarding/OnboardingWizard";
import { Link } from "@/i18n/navigation";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ edit?: string }>;
};

export default async function OnboardingPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const { edit } = await searchParams;
  setRequestLocale(locale);

  const user = await getSessionUser();
  if (!user) {
    redirect({ href: "/auth/login", locale });
  }

  const isEditing = edit === "1";
  const ctx = await getDashboardContext(user!);
  if (ctx?.side?.onboardingComplete && !isEditing) {
    redirect({ href: "/dashboard", locale });
  }

  let initialValues: OnboardingInitialValues | undefined;
  if (isEditing && ctx?.onboarding) {
    const p = ctx.onboarding;
    let categoryLikes: string[] = [];
    try {
      const parsed = JSON.parse(p.categoryLikes) as unknown;
      if (Array.isArray(parsed)) categoryLikes = parsed.map(String);
    } catch {
      categoryLikes = [];
    }
    initialValues = {
      budgetUsd: p.budgetUsd,
      monthlyFollowOnBudget: p.monthlyFollowOnBudget,
      hoursPerWeek: p.hoursPerWeek,
      experience: p.experience,
      uiLanguage: p.uiLanguage,
      storageDescription: p.storageDescription,
      storageLimits: p.storageLimits,
      riskTolerance: p.riskTolerance,
      categoryLikes,
      shopifyStatus: p.shopifyStatus,
      codComfort: p.codComfort,
      deliveryBandDays: p.deliveryBandDays,
      maxLandedCost: p.maxLandedCost,
      lebanonSellabilityAck: p.lebanonSellabilityAck,
      sampleClearanceReady: p.sampleClearanceReady,
    };
  }

  const t = await getTranslations("Onboarding");
  const brand = await getTranslations("Brand");

  return (
    <div className="min-h-screen">
      <header className="border-b border-stone bg-surface">
        <div className="mx-auto flex w-full max-w-3xl items-center px-6 py-4">
          <Link
            href="/"
            className="font-display text-lg font-semibold tracking-tight text-ink"
          >
            {brand("name")}
          </Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl px-6 py-10">
        <h1 className="animate-rise font-display text-3xl text-ink">
          {isEditing ? t("editTitle") : t("title")}
        </h1>
        <p className="animate-rise-delay mt-2 max-w-xl text-stone-dark">
          {isEditing ? t("editSubtitle") : t("subtitle")}
        </p>
        <div className="animate-rise-delay surface-card mt-8 p-6 md:p-8">
          <OnboardingWizard initialValues={initialValues} />
        </div>
      </main>
    </div>
  );
}
