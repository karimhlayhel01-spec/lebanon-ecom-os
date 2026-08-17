import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { loadBusinessMemory } from "@/lib/memory/repos";
import { evaluateOnboardingGate } from "@/lib/onboarding-gate";
import { loadOwnedMotionClip } from "@/lib/marketing/visual-packs";
import { getWorkspaceForUser } from "@/lib/workspace";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ packId: string }> },
) {
  const user = await getSessionUser();
  if (!user) {
    return new NextResponse(null, { status: 401 });
  }
  const workspace = await getWorkspaceForUser(user.id);
  if (!workspace) {
    return new NextResponse(null, { status: 404 });
  }
  const { side } = await loadBusinessMemory(workspace.id);
  if (!evaluateOnboardingGate(side).ok) {
    return new NextResponse(null, { status: 404 });
  }

  const { packId } = await context.params;
  const loaded = await loadOwnedMotionClip(workspace.id, packId);
  if (!loaded.ok) {
    return new NextResponse(null, { status: 404 });
  }

  return new NextResponse(new Uint8Array(loaded.bytes), {
    status: 200,
    headers: {
      "Content-Type": loaded.mimeType,
      "Content-Disposition": `inline; filename="${encodeURIComponent(loaded.originalName || "motion")}"`,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
