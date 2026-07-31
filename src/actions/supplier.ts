"use server";

import { revalidatePath } from "next/cache";
import { ensureMigrated } from "@/db";
import { requireUser } from "@/lib/auth";
import { getWorkspaceForUser } from "@/lib/memory/repos";
import {
  decideSample,
  markBatchArrived,
  markReorderArrived,
  markSampleReceived,
  orderBatch,
  orderNextBatch,
  reportSupplierCantFulfill,
  requestSample,
  saveCostQuotes,
  setBatchArrivalEta,
  setReorderArrivalEta,
  switchReorderBackup,
  type CostQuoteInput,
  type MarkReorderArrivedResult,
  type OrderBatchResult,
  type OrderNextBatchResult,
  type ReportCantFulfillResult,
  type SampleDecision,
  type SaveCostQuotesResult,
  type SetBatchArrivalEtaResult,
  type SetReorderArrivalEtaResult,
  type SwitchReorderBackupResult,
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

export async function markBatchArrivedAction(
  skuId: string,
  inventoryAck: boolean,
) {
  ensureMigrated();
  const workspace = await workspaceForRequest();
  if (!workspace) return { ok: false, error: "not_found" };
  const res = await markBatchArrived(workspace.id, skuId, inventoryAck);
  revalidatePath("/", "layout");
  return res;
}

export async function saveCostQuotesAction(
  input: CostQuoteInput,
  skuId?: string,
): Promise<SaveCostQuotesResult> {
  ensureMigrated();
  const workspace = await workspaceForRequest();
  if (!workspace) return { ok: false, error: "not_found" };
  const res = await saveCostQuotes(workspace.id, input, skuId);
  revalidatePath("/", "layout");
  return res;
}

export async function setBatchArrivalEtaAction(
  skuId: string,
  input: SetBatchArrivalEtaInput,
): Promise<SetBatchArrivalEtaResult> {
  ensureMigrated();
  const workspace = await workspaceForRequest();
  if (!workspace) return { ok: false, error: "not_found" };
  const res = await setBatchArrivalEta(workspace.id, skuId, input);
  revalidatePath("/", "layout");
  return res;
}

export async function orderNextBatchAction(
  skuId: string,
  quantity: number,
  opts: { economicsAck?: boolean; stuckAcks?: boolean } = {},
): Promise<OrderNextBatchResult> {
  ensureMigrated();
  const workspace = await workspaceForRequest();
  if (!workspace) return { ok: false, error: "not_found" };
  const res = await orderNextBatch(workspace.id, skuId, quantity, opts);
  revalidatePath("/", "layout");
  return res;
}

export async function markReorderArrivedAction(
  skuId: string,
  inventoryAck: boolean,
): Promise<MarkReorderArrivedResult> {
  ensureMigrated();
  const workspace = await workspaceForRequest();
  if (!workspace) return { ok: false, error: "not_found" };
  const res = await markReorderArrived(workspace.id, skuId, inventoryAck);
  revalidatePath("/", "layout");
  return res;
}

export async function setReorderArrivalEtaAction(
  skuId: string,
  input: SetBatchArrivalEtaInput,
): Promise<SetReorderArrivalEtaResult> {
  ensureMigrated();
  const workspace = await workspaceForRequest();
  if (!workspace) return { ok: false, error: "not_found" };
  const res = await setReorderArrivalEta(workspace.id, skuId, input);
  revalidatePath("/", "layout");
  return res;
}

export async function reportSupplierCantFulfillAction(
  skuId: string,
  reason?: string,
): Promise<ReportCantFulfillResult> {
  ensureMigrated();
  const workspace = await workspaceForRequest();
  if (!workspace) return { ok: false, error: "not_found" };
  const res = await reportSupplierCantFulfill(workspace.id, skuId, { reason });
  revalidatePath("/", "layout");
  return res;
}

export async function switchReorderBackupAction(
  skuId: string,
  backupSupplierId: string,
  opts: { skipSampleAck?: boolean } = {},
): Promise<SwitchReorderBackupResult> {
  ensureMigrated();
  const workspace = await workspaceForRequest();
  if (!workspace) return { ok: false, error: "not_found" };
  const res = await switchReorderBackup(
    workspace.id,
    skuId,
    backupSupplierId,
    opts,
  );
  revalidatePath("/", "layout");
  return res;
}
