import type { SessionUser } from "@/lib/auth";
import { getSessionUser, requireUser } from "@/lib/auth";
import { getWorkspaceForUser, loadBusinessMemory } from "@/lib/memory/repos";
import { evaluateOnboardingGate } from "@/lib/onboarding-gate";
import { redirect } from "@/i18n/navigation";

export { getWorkspaceForUser };
export { evaluateOnboardingGate } from "@/lib/onboarding-gate";

export async function getDashboardContext(user: SessionUser) {
  const workspace = await getWorkspaceForUser(user.id);
  if (!workspace) return null;

  const { onboarding, journey, side } = await loadBusinessMemory(workspace.id);
  return { workspace, onboarding, journey, side, user };
}

export type DashboardContext = NonNullable<
  Awaited<ReturnType<typeof getDashboardContext>>
>;

export type OnboardedWorkspaceResult =
  | {
      ok: true;
      user: SessionUser;
      workspace: NonNullable<
        Awaited<ReturnType<typeof getWorkspaceForUser>>
      >;
      side: NonNullable<DashboardContext["side"]>;
    }
  | { ok: false; error: "not_found" | "onboarding_required" };

/**
 * Action guard: authenticated user + workspace + onboarding complete.
 * Does not redirect for onboarding gaps — callers return
 * `{ error: "onboarding_required" }` (or equivalent).
 * Signed-out redirects to login via requireUser (page-style, no 500).
 * Exempt: auth signup/login and onboarding submit itself.
 */
export async function requireOnboardedWorkspace(): Promise<OnboardedWorkspaceResult> {
  const user = await requireUser();
  const workspace = await getWorkspaceForUser(user.id);
  if (!workspace) return { ok: false, error: "not_found" };

  const { side } = await loadBusinessMemory(workspace.id);
  const gate = evaluateOnboardingGate(side);
  if (!gate.ok) return gate;
  if (!side) return { ok: false, error: "not_found" };

  return { ok: true, user, workspace, side };
}

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
  if (!ctx || !evaluateOnboardingGate(ctx.side).ok) {
    redirect({ href: "/onboarding", locale });
  }

  return ctx!;
}
