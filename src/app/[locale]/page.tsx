import { getTranslations, setRequestLocale } from "next-intl/server";
import { eq } from "drizzle-orm";
import { Link, redirect } from "@/i18n/navigation";
import { getSessionUser } from "@/lib/auth";
import { getWorkspaceForUser } from "@/lib/workspace";
import { db, ensureMigrated, schema } from "@/db";

type Props = {
  params: Promise<{ locale: string }>;
};

export default async function HomePage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await getSessionUser();
  if (user) {
    const workspace = await getWorkspaceForUser(user.id);
    if (workspace) {
      ensureMigrated();
      const side = await db
        .select()
        .from(schema.sideStatuses)
        .where(eq(schema.sideStatuses.workspaceId, workspace.id))
        .get();
      redirect({
        href: side?.onboardingComplete ? "/dashboard" : "/onboarding",
        locale,
      });
    }
    redirect({ href: "/onboarding", locale });
  }

  const t = await getTranslations("Home");
  const brand = await getTranslations("Brand");

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-stone bg-surface">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-4">
          <span className="font-display text-lg font-semibold tracking-tight text-ink">
            {brand("name")}
          </span>
          <div className="flex items-center gap-4 text-sm">
            <Link
              href="/"
              locale="en"
              className="font-medium text-stone-dark underline-offset-4 hover:text-ink"
            >
              EN
            </Link>
            <span aria-hidden className="text-stone">
              |
            </span>
            <Link
              href="/"
              locale="ar"
              className="font-medium text-stone-dark underline-offset-4 hover:text-ink"
            >
              AR
            </Link>
            <Link
              href="/auth/login"
              className="rounded-md border border-stone px-4 py-2 font-semibold text-ink transition hover:bg-sand"
            >
              {t("ctaLogin")}
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center px-6 py-16">
        <div className="max-w-3xl">
          <h1 className="animate-rise font-display text-4xl leading-tight text-ink md:text-5xl">
            {t("welcome")}
          </h1>
          <p className="animate-rise-delay mt-6 text-lg leading-relaxed text-ink md:text-xl">
            {t("lead")}
          </p>
          <p className="animate-rise-delay mt-4 max-w-2xl text-base leading-relaxed text-stone-dark md:text-lg">
            {t("sub")}
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <Link
              href="/auth/signup"
              className="rounded-md bg-cedar px-6 py-3 text-sm font-semibold text-foam shadow-sm transition hover:bg-cedar-deep"
            >
              {t("ctaSignup")}
            </Link>
            <Link
              href="/auth/login"
              className="rounded-md border border-stone bg-surface px-6 py-3 text-sm font-semibold text-ink transition hover:bg-sand"
            >
              {t("ctaLogin")}
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
