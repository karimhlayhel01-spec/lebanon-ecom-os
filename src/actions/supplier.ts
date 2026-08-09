"use server";

import { revalidatePath } from "next/cache";
import { ensureMigrated } from "@/db";
import { requireOnboardedWorkspace } from "@/lib/workspace";
import {
  decideSample,
  markBatchArrived,
  markReorderArrived,
  markSampleReceived,
  orderBatch,
  orderNextBatch,
  reportSupplierCantFulfill,
  requestSample,
  refreshImportLeads,
  saveCostQuotes,
  setBatchArrivalEta,
  setReorderArrivalEta,
  switchReorderBackup,
  type CostQuoteInput,
  type MarkReorderArrivedResult,
  type OrderBatchResult,
  type OrderNextBatchResult,
  type RefreshImportLeadsResult,
  type ReportCantFulfillResult,
  type SampleDecision,
  type SaveCostQuotesResult,
  type SetBatchArrivalEtaResult,
  type SetReorderArrivalEtaResult,
  type SwitchReorderBackupResult,
} from "@/lib/supplier/service";
import type { SetBatchArrivalEtaInput } from "@/lib/supplier/batch-eta";
import { assertSkuOwned } from "@/lib/sku/ownership";
import { assessSupplierListing } from "@/lib/supplier/diligence/service";
import type { AssessListingResult } from "@/lib/supplier/diligence/types";

async function workspaceForRequest() {
  const ctx = await requireOnboardedWorkspace();
  if (!ctx.ok) return ctx;
  return { ok: true as const, workspace: ctx.workspace };
}

async function requireOwnedSku(workspaceId: string, skuId: string) {
  const owned = await assertSkuOwned(workspaceId, skuId);
  return owned.ok;
}

/**
 * On-click Assess listing — scrape + skills recommend + Gemini narrate.
 * Revalidates so a persisted company name shows on the card.
 * Do not re-export diligence types from this "use server" file (Turbopack runtime).
 */
export async function assessSupplierListingAction(
  supplierId: string,
  locale: "en" | "ar",
): Promise<AssessListingResult> {
  await ensureMigrated();
  const ctx = await workspaceForRequest();
  if (!ctx.ok) return { ok: false, error: "not_found" };
  const res = await assessSupplierListing(ctx.workspace.id, supplierId, locale);
  if (res.ok) {
    revalidatePath("/", "layout");
  }
  return res;
}

export async function refreshImportLeadsAction(
  skuId: string,
  opts?: { confirmResetProgress?: boolean },
): Promise<RefreshImportLeadsResult> {
  await ensureMigrated();
  const ctx = await workspaceForRequest();
  if (!ctx.ok) return { ok: false, error: "not_found" };
  if (!(await requireOwnedSku(ctx.workspace.id, skuId))) {
    return { ok: false, error: "not_found" };
  }
  const res = await refreshImportLeads(ctx.workspace.id, skuId, opts);
  revalidatePath("/", "layout");
  return res;
}

export async function requestSampleAction(supplierId: string) {
  await ensureMigrated();
  const ctx = await workspaceForRequest();
  if (!ctx.ok) return { ok: false, error: ctx.error };
  const res = await requestSample(ctx.workspace.id, supplierId);
  revalidatePath("/", "layout");
  return res;
}

export async function markSampleReceivedAction(
  sampleId: string,
  checklist: Record<string, boolean>,
  photoNotes: string,
) {
  await ensureMigrated();
  const ctx = await workspaceForRequest();
  if (!ctx.ok) return { ok: false, error: ctx.error };
  const res = await markSampleReceived(
    ctx.workspace.id,
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
  await ensureMigrated();
  const ctx = await workspaceForRequest();
  if (!ctx.ok) return { ok: false, error: ctx.error };
  const res = await decideSample(ctx.workspace.id, sampleId, decision);
  revalidatePath("/", "layout");
  return res;
}

export async function orderBatchAction(
  supplierId: string,
  quantity: number,
  stuckAcks: boolean,
): Promise<OrderBatchResult> {
  await ensureMigrated();
  const ctx = await workspaceForRequest();
  if (!ctx.ok) return { ok: false, error: "not_found" };
  const res = await orderBatch(ctx.workspace.id, supplierId, quantity, stuckAcks);
  revalidatePath("/", "layout");
  return res;
}

export async function markBatchArrivedAction(
  skuId: string,
  inventoryAck: boolean,
) {
  await ensureMigrated();
  const ctx = await workspaceForRequest();
  if (!ctx.ok) return { ok: false, error: ctx.error };
  if (!(await requireOwnedSku(ctx.workspace.id, skuId))) {
    return { ok: false, error: "not_found" };
  }
  const res = await markBatchArrived(ctx.workspace.id, skuId, inventoryAck);
  revalidatePath("/", "layout");
  return res;
}

export async function saveCostQuotesAction(
  input: CostQuoteInput,
  skuId: string,
): Promise<SaveCostQuotesResult> {
  await ensureMigrated();
  const ctx = await workspaceForRequest();
  if (!ctx.ok) return { ok: false, error: "not_found" };
  if (!(await requireOwnedSku(ctx.workspace.id, skuId))) {
    return { ok: false, error: "not_found" };
  }
  const res = await saveCostQuotes(ctx.workspace.id, input, skuId);
  revalidatePath("/", "layout");
  return res;
}

export async function setBatchArrivalEtaAction(
  skuId: string,
  input: SetBatchArrivalEtaInput,
): Promise<SetBatchArrivalEtaResult> {
  await ensureMigrated();
  const ctx = await workspaceForRequest();
  if (!ctx.ok) return { ok: false, error: "not_found" };
  if (!(await requireOwnedSku(ctx.workspace.id, skuId))) {
    return { ok: false, error: "not_found" };
  }
  const res = await setBatchArrivalEta(ctx.workspace.id, skuId, input);
  revalidatePath("/", "layout");
  return res;
}

export async function orderNextBatchAction(
  skuId: string,
  quantity: number,
  opts: { economicsAck?: boolean; stuckAcks?: boolean } = {},
): Promise<OrderNextBatchResult> {
  await ensureMigrated();
  const ctx = await workspaceForRequest();
  if (!ctx.ok) return { ok: false, error: "not_found" };
  if (!(await requireOwnedSku(ctx.workspace.id, skuId))) {
    return { ok: false, error: "not_found" };
  }
  const res = await orderNextBatch(ctx.workspace.id, skuId, quantity, opts);
  revalidatePath("/", "layout");
  return res;
}

export async function markReorderArrivedAction(
  skuId: string,
  inventoryAck: boolean,
): Promise<MarkReorderArrivedResult> {
  await ensureMigrated();
  const ctx = await workspaceForRequest();
  if (!ctx.ok) return { ok: false, error: "not_found" };
  if (!(await requireOwnedSku(ctx.workspace.id, skuId))) {
    return { ok: false, error: "not_found" };
  }
  const res = await markReorderArrived(ctx.workspace.id, skuId, inventoryAck);
  revalidatePath("/", "layout");
  return res;
}

export async function setReorderArrivalEtaAction(
  skuId: string,
  input: SetBatchArrivalEtaInput,
): Promise<SetReorderArrivalEtaResult> {
  await ensureMigrated();
  const ctx = await workspaceForRequest();
  if (!ctx.ok) return { ok: false, error: "not_found" };
  if (!(await requireOwnedSku(ctx.workspace.id, skuId))) {
    return { ok: false, error: "not_found" };
  }
  const res = await setReorderArrivalEta(ctx.workspace.id, skuId, input);
  revalidatePath("/", "layout");
  return res;
}

export async function reportSupplierCantFulfillAction(
  skuId: string,
  reason?: string,
): Promise<ReportCantFulfillResult> {
  await ensureMigrated();
  const ctx = await workspaceForRequest();
  if (!ctx.ok) return { ok: false, error: "not_found" };
  if (!(await requireOwnedSku(ctx.workspace.id, skuId))) {
    return { ok: false, error: "not_found" };
  }
  const res = await reportSupplierCantFulfill(ctx.workspace.id, skuId, {
    reason,
  });
  revalidatePath("/", "layout");
  return res;
}

export async function switchReorderBackupAction(
  skuId: string,
  backupSupplierId: string,
  opts: { skipSampleAck?: boolean } = {},
): Promise<SwitchReorderBackupResult> {
  await ensureMigrated();
  const ctx = await workspaceForRequest();
  if (!ctx.ok) return { ok: false, error: "not_found" };
  if (!(await requireOwnedSku(ctx.workspace.id, skuId))) {
    return { ok: false, error: "not_found" };
  }
  const res = await switchReorderBackup(
    ctx.workspace.id,
    skuId,
    backupSupplierId,
    opts,
  );
  revalidatePath("/", "layout");
  return res;
}
