"use server";

import { ensureMigrated } from "@/db";
import { requireOnboardedWorkspace } from "@/lib/workspace";
import {
  blockJourney,
  pauseJourney,
  resumeJourney,
  unblockJourney,
} from "@/lib/memory/repos";
import { revalidatePath } from "next/cache";

export async function pauseJourneyAction() {
  await ensureMigrated();
  const ctx = await requireOnboardedWorkspace();
  if (!ctx.ok) return;

  await pauseJourney(ctx.workspace.id);
  revalidatePath("/", "layout");
}

export async function resumeJourneyAction() {
  await ensureMigrated();
  const ctx = await requireOnboardedWorkspace();
  if (!ctx.ok) return;

  await resumeJourney(ctx.workspace.id);
  revalidatePath("/", "layout");
}

export async function blockJourneyAction(reason: string) {
  await ensureMigrated();
  const ctx = await requireOnboardedWorkspace();
  if (!ctx.ok) return;

  await blockJourney(ctx.workspace.id, reason);
  revalidatePath("/", "layout");
}

export async function unblockJourneyAction() {
  await ensureMigrated();
  const ctx = await requireOnboardedWorkspace();
  if (!ctx.ok) return;

  await unblockJourney(ctx.workspace.id);
  revalidatePath("/", "layout");
}
