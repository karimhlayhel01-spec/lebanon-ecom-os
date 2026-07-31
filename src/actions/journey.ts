"use server";

import { ensureMigrated } from "@/db";
import { requireUser } from "@/lib/auth";
import {
  blockJourney,
  getWorkspaceForUser,
  pauseJourney,
  resumeJourney,
  unblockJourney,
} from "@/lib/memory/repos";
import { revalidatePath } from "next/cache";

export async function pauseJourneyAction() {
  await ensureMigrated();
  const user = await requireUser();
  const workspace = await getWorkspaceForUser(user.id);
  if (!workspace) return;

  await pauseJourney(workspace.id);
  revalidatePath("/", "layout");
}

export async function resumeJourneyAction() {
  await ensureMigrated();
  const user = await requireUser();
  const workspace = await getWorkspaceForUser(user.id);
  if (!workspace) return;

  await resumeJourney(workspace.id);
  revalidatePath("/", "layout");
}

export async function blockJourneyAction(reason: string) {
  await ensureMigrated();
  const user = await requireUser();
  const workspace = await getWorkspaceForUser(user.id);
  if (!workspace) return;

  await blockJourney(workspace.id, reason);
  revalidatePath("/", "layout");
}

export async function unblockJourneyAction() {
  await ensureMigrated();
  const user = await requireUser();
  const workspace = await getWorkspaceForUser(user.id);
  if (!workspace) return;

  await unblockJourney(workspace.id);
  revalidatePath("/", "layout");
}
