import type { SessionUser } from "@/lib/auth";
import { getSessionUser } from "@/lib/auth";
import { getWorkspaceForUser, loadBusinessMemory } from "@/lib/memory/repos";
import { redirect } from "@/i18n/navigation";

export { getWorkspaceForUser };

export async function getDashboardContext(user: SessionUser) {
  const workspace = await getWorkspaceForUser(user.id);
  if (!workspace) return null;

  const { onboarding, journey, side } = await loadBusinessMemory(workspace.id);
  return { workspace, onboarding, journey, side, user };
}

export type DashboardContext = NonNullable<
  Awaited<ReturnType<typeof getDashboardContext>>
>;

/**
 * Shared page guard for the dashboard hub and every deep page. Redirects to
 * login when signed out and to onboarding until onboarding is complete, then
 * returns the loaded context. Mirrors the original dashboard guard so all
 * routes behave identically.
 */
export async function requireOnboardedContext(
  locale: string,
): Promise<DashboardContext> {
  const user = await getSessionUser();
  if (!user) {
    redirect({ href: "/auth/login", locale });
  }

  const ctx = await getDashboardContext(user!);
  if (!ctx || !ctx.side?.onboardingComplete) {
    redirect({ href: "/onboarding", locale });
  }

  return ctx!;
}
