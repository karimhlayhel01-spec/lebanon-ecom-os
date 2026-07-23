"use server";

import { revalidatePath } from "next/cache";
import { ensureMigrated } from "@/db";
import { requireUser } from "@/lib/auth";
import { getWorkspaceForUser } from "@/lib/memory/repos";
import {
  decideSample,
  markBatchArrived,
  markSampleReceived,
  orderBatch,
  requestSample,
  saveCostQuotes,
  setBatchArrivalEta,
  type CostQuoteInput,
  type OrderBatchResult,
  type SampleDecision,
  type SaveCostQuotesResult,
  type SetBatchArrivalEtaResult,
} from "@/lib/supplier/service";
import type { SetBatchArrivalEtaInput } from "@/lib/supplier/batch-eta";

async function workspaceForRequest() {
  const user = await requireUser();
  return getWorkspaceForUser(user.id);
}

export async function requestSampleAction(supplierId: string) {
  ensureMigrated();
  const workspace = await workspaceForRequest();
  if (!workspace) return { ok: false, error: "not_found" };
  const res = await requestSample(workspace.id, supplierId);
  revalidatePath("/", "layout");
  return res;
}

export async function markSampleReceivedAction(
  sampleId: string,
  checklist: Record<string, boolean>,
  photoNotes: string,
) {
  ensureMigrated();
  const workspace = await workspaceForRequest();
  if (!workspace) return { ok: false, error: "not_found" };
  const res = await markSampleReceived(
    workspace.id,
    sampleId,
    checklist,
    photoNotes,
  );
  revalidatePath("/", "layout");
  return res;
}

export async function decideSampleAction(
  sampleId: string,
  decision: SampleDecision,
) {
  ensureMigrated();
  const workspace = await workspaceForRequest();
  if (!workspace) return { ok: false, error: "not_found" };
  const res = await decideSample(workspace.id, sampleId, decision);
  revalidatePath("/", "layout");
  return res;
}

export async function orderBatchAction(
  supplierId: string,
  quantity: number,
  stuckAcks: boolean,
): Promise<OrderBatchResult> {
  ensureMigrated();
  const workspace = await workspaceForRequest();
  if (!workspace) return { ok: false, error: "not_found" };
  const res = await orderBatch(workspace.id, supplierId, quantity, stuckAcks);
  revalidatePath("/", "layout");
  return res;
}

export async function markBatchArrivedAction(inventoryAck: boolean) {
  ensureMigrated();
  const workspace = await workspaceForRequest();
  if (!workspace) return { ok: false, error: "not_found" };
  const res = await markBatchArrived(workspace.id, inventoryAck);
  revalidatePath("/", "layout");
  return res;
}

export async function saveCostQuotesAction(
  input: CostQuoteInput,
): Promise<SaveCostQuotesResult> {
  ensureMigrated();
  const workspace = await workspaceForRequest();
  if (!workspace) return { ok: false, error: "not_found" };
  const res = await saveCostQuotes(workspace.id, input);
  revalidatePath("/", "layout");
  return res;
}

export async function setBatchArrivalEtaAction(
  input: SetBatchArrivalEtaInput,
): Promise<SetBatchArrivalEtaResult> {
  ensureMigrated();
  const workspace = await workspaceForRequest();
  if (!workspace) return { ok: false, error: "not_found" };
  const res = await setBatchArrivalEta(workspace.id, input);
  revalidatePath("/", "layout");
  return res;
}
