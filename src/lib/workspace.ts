import type { SessionUser } from "@/lib/auth";
import { getWorkspaceForUser, loadBusinessMemory } from "@/lib/memory/repos";

export { getWorkspaceForUser };

export async function getDashboardContext(user: SessionUser) {
  const workspace = await getWorkspaceForUser(user.id);
  if (!workspace) return null;

  const { onboarding, journey, side } = await loadBusinessMemory(workspace.id);
  return { workspace, onboarding, journey, side, user };
}
