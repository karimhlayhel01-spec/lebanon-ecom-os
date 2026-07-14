import { getTranslations, setRequestLocale } from "next-intl/server";
import { redirect, Link } from "@/i18n/navigation";
import { getSessionUser } from "@/lib/auth";
import { getDashboardContext } from "@/lib/workspace";
import { logoutAction } from "@/actions/auth";
import { PauseResumeControls } from "@/components/dashboard/PauseResumeControls";

type Props = {
  params: Promise<{ locale: string }>;
};

export default async function DashboardPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await getSessionUser();
  if (!user) {
    redirect({ href: "/auth/login", locale });
  }

  const ctx = await getDashboardContext(user!);
  if (!ctx || !ctx.side?.onboardingComplete) {
    redirect({ href: "/onboarding", locale });
  }

  const t = await getTranslations("Dashboard");
  const brand = await getTranslations("Brand");
  const states = await getTranslations("States");
  const auth = await getTranslations("Auth");

  const journey = ctx!.journey;
  const side = ctx!.side!;
  const primaryState = journey?.primaryState ?? "discovery";
  const isPaused = primaryState === "paused";
  const displayState = (
    isPaused ? "paused" : primaryState
  ) as
    | "discovery"
    | "supplier_sample"
    | "sample_approved"
    | "store_setup"
    | "batch_ordered"
    | "batch_arrived_ready"
    | "selling"
    | "paused"
    | "blocked";

  return (
    <div className="min-h-screen">
      <header className="border-b border-stone bg-surface">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-3.5">
          <Link
            href="/"
            className="font-display text-lg font-semibold tracking-tight text-ink"
          >
            {brand("name")}
          </Link>
          <div className="flex items-center gap-3">
            <Link
              href="/onboarding?edit=1"
              className="rounded-md border border-stone px-3 py-2 text-sm font-medium text-ink transition hover:bg-sand"
            >
              {t("editOnboarding")}
            </Link>
            <PauseResumeControls isPaused={isPaused} />
            <form action={logoutAction}>
              <button
                type="submit"
                className="rounded-md border border-stone px-3 py-2 text-sm font-medium text-ink transition hover:bg-sand"
              >
                {auth("logout")}
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-6 py-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl text-ink">{t("title")}</h1>
            <p className="mt-1 text-sm text-stone-dark">
              {t("greeting", { name: user!.name })}
            </p>
          </div>
          <div className="flex items-center gap-2.5">
            <span className="text-sm text-stone-dark">{t("stateChip")}</span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-cedar/30 bg-cedar/10 px-3 py-1.5 text-sm font-semibold text-cedar-deep">
              <span className="size-1.5 rounded-full bg-cedar" aria-hidden />
              {states(displayState)}
              {isPaused && journey?.pausedFromState
                ? ` ← ${states(journey.pausedFromState as "discovery")}`
                : ""}
            </span>
          </div>
        </div>

        <div className="mt-8 grid gap-5 lg:grid-cols-3">
          <section className="animate-rise space-y-5 lg:col-span-2">
            <div className="surface-card p-5">
              <h2 className="font-display text-lg text-ink">{t("nextCta")}</h2>
              <p className="mt-2 text-sm text-stone-dark">
                {t("nextCtaPlaceholder")}
              </p>
            </div>

            <div className="rounded-xl border border-dashed border-stone bg-surface-subtle p-5">
              <h2 className="font-display text-lg text-ink">{t("shortlist")}</h2>
              <p className="mt-2 text-sm text-stone-dark">{t("shortlistEmpty")}</p>
            </div>

            <div className="surface-card p-5">
              <h2 className="font-display text-lg text-ink">{t("coaching")}</h2>
              <p className="mt-2 text-sm text-stone-dark">{t("coachingSlot")}</p>
            </div>
          </section>

          <aside className="animate-rise-delay space-y-5">
            <div className="surface-card p-5">
              <h2 className="font-display text-base text-ink">
                {t("sideStatuses")}
              </h2>
              <ul className="mt-4 space-y-3 text-sm">
                <li className="flex items-center justify-between gap-2 border-b border-stone pb-3">
                  <span className="text-stone-dark">{t("onboarding")}</span>
                  <span className="font-medium text-cedar-deep">
                    {side.onboardingComplete ? t("complete") : t("pending")}
                  </span>
                </li>
                <li className="flex items-center justify-between gap-2 border-b border-stone pb-3">
                  <span className="text-stone-dark">{t("product")}</span>
                  <span className="font-medium text-ink">
                    {side.productAccepted ? t("yes") : t("no")}
                  </span>
                </li>
                <li className="flex items-center justify-between gap-2 border-b border-stone pb-3">
                  <span className="text-stone-dark">{t("sample")}</span>
                  <span className="font-medium text-ink">{side.sampleStatus}</span>
                </li>
                <li className="flex items-center justify-between gap-2 border-b border-stone pb-3">
                  <span className="text-stone-dark">{t("storeReady")}</span>
                  <span className="font-medium text-ink">
                    {side.storeReadyPercent}%
                  </span>
                </li>
                <li className="flex items-center justify-between gap-2 border-b border-stone pb-3">
                  <span className="text-stone-dark">{t("marketing")}</span>
                  <span className="font-medium text-ink">
                    {side.marketingStage}
                  </span>
                </li>
                <li className="flex items-center justify-between gap-2">
                  <span className="text-stone-dark">{t("batch")}</span>
                  <span className="font-medium text-ink">
                    {side.batchOrdered ? t("yes") : t("no")}
                  </span>
                </li>
              </ul>
            </div>

            <div className="surface-card p-5">
              <h2 className="font-display text-base text-ink">{t("finance")}</h2>
              <p className="mt-2 text-sm text-stone-dark">{t("financeSlot")}</p>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
