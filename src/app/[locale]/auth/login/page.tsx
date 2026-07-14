import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { AuthForm } from "@/components/auth/AuthForm";
import { getSessionUser } from "@/lib/auth";
import { getDashboardContext } from "@/lib/workspace";
import { redirect } from "@/i18n/navigation";

type Props = {
  params: Promise<{ locale: string }>;
};

export default async function LoginPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await getSessionUser();
  if (user) {
    const ctx = await getDashboardContext(user);
    redirect({
      href: ctx?.side?.onboardingComplete ? "/dashboard" : "/onboarding",
      locale,
    });
  }

  const t = await getTranslations("Auth");
  const brand = await getTranslations("Brand");

  return (
    <main className="flex min-h-screen w-full flex-col items-center justify-center px-6 py-12">
      <div className="animate-rise w-full max-w-md">
        <Link
          href="/"
          className="mb-6 block text-center font-display text-lg font-semibold tracking-tight text-ink"
        >
          {brand("name")}
        </Link>
        <div className="surface-card p-7">
          <h1 className="font-display text-2xl text-ink">{t("loginTitle")}</h1>
          <div className="mt-6">
            <AuthForm mode="login" />
          </div>
        </div>
      </div>
    </main>
  );
}
