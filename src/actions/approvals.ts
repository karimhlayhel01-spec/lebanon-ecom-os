"use server";

import { revalidatePath } from "next/cache";
import { ensureMigrated } from "@/db";
import { requireUser } from "@/lib/auth";
import { getWorkspaceForUser } from "@/lib/memory/repos";
import {
  createApprovalRequest,
  decideApproval,
  getApproval,
  type DecideApprovalResult,
} from "@/lib/approvals/engine";
import { type ApprovalGateId } from "@/lib/constants";

async function requireOwnedApproval(approvalId: string) {
  const user = await requireUser();
  const workspace = await getWorkspaceForUser(user.id);
  if (!workspace) return null;

  const approval = await getApproval(approvalId);
  if (!approval || approval.workspaceId !== workspace.id) return null;
  return approval;
}

export type ApprovalDecisionState =
  | { ok: true; status: "approved" | "rejected" }
  | { ok: false; error: string; missing?: string[] };

/** Founder opens a gate for decision (used by journey flows / the inbox). */
export async function openApprovalGateAction(
  gateId: ApprovalGateId,
  data?: Record<string, unknown>,
  requiredAcks?: string[],
) {
  await ensureMigrated();
  const user = await requireUser();
  const workspace = await getWorkspaceForUser(user.id);
  if (!workspace) return;

  await createApprovalRequest(workspace.id, gateId, { data, requiredAcks });
  revalidatePath("/", "layout");
}

export async function approveApprovalAction(
  approvalId: string,
  acknowledgements: string[] = [],
  note?: string,
): Promise<ApprovalDecisionState> {
  await ensureMigrated();
  const approval = await requireOwnedApproval(approvalId);
  if (!approval) return { ok: false, error: "not_found" };

  const result: DecideApprovalResult = await decideApproval(approvalId, {
    type: "approve",
    acknowledgements,
    note: note ?? null,
  });

  revalidatePath("/", "layout");
  if (!result.ok) return { ok: false, error: result.error, missing: result.missing };
  return { ok: true, status: result.status };
}

export async function rejectApprovalAction(
  approvalId: string,
  note?: string,
): Promise<ApprovalDecisionState> {
  await ensureMigrated();
  const approval = await requireOwnedApproval(approvalId);
  if (!approval) return { ok: false, error: "not_found" };

  const result = await decideApproval(approvalId, {
    type: "reject",
    note: note ?? null,
  });

  revalidatePath("/", "layout");
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, status: "rejected" };
}
