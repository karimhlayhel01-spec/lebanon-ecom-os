import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { loadBusinessMemory } from "@/lib/memory/repos";
import { evaluateOnboardingGate } from "@/lib/onboarding-gate";
import { loadOwnedPhotoAsset } from "@/lib/marketing/visual-packs";
import { getWorkspaceForUser } from "@/lib/workspace";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ assetId: string }> },
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

  const { assetId } = await context.params;
  const loaded = await loadOwnedPhotoAsset(workspace.id, assetId);
  if (!loaded.ok) {
    return new NextResponse(null, { status: 404 });
  }

  return new NextResponse(new Uint8Array(loaded.bytes), {
    status: 200,
    headers: {
      "Content-Type": loaded.mimeType,
      "Content-Disposition": `inline; filename="${encodeURIComponent(loaded.originalName || "photo")}"`,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
