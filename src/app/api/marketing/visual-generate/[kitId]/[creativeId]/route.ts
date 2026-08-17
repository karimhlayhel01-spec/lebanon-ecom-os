import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { loadBusinessMemory } from "@/lib/memory/repos";
import { evaluateOnboardingGate } from "@/lib/onboarding-gate";
import { loadOwnedCreativeVisual } from "@/lib/marketing/visual-gen";
import { getWorkspaceForUser } from "@/lib/workspace";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ kitId: string; creativeId: string }> },
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

  const { kitId, creativeId } = await context.params;
  const loaded = await loadOwnedCreativeVisual(workspace.id, kitId, creativeId);
  if (!loaded.ok) {
    return new NextResponse(null, { status: 404 });
  }

  const download = new URL(request.url).searchParams.get("download") === "1";
  const disposition = download ? "attachment" : "inline";

  return new NextResponse(new Uint8Array(loaded.bytes), {
    status: 200,
    headers: {
      "Content-Type": loaded.mimeType,
      "Content-Disposition": `${disposition}; filename="${encodeURIComponent(loaded.originalName)}"`,
      "Cache-Control": "private, max-age=0, must-revalidate",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
