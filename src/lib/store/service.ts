import { eq } from "drizzle-orm";
import { db, ensureMigrated, schema } from "@/db";
import { newId, nowIso } from "@/lib/ids";
import {
  COURIERS_TBD,
  STORE_CHECKLIST_KEYS,
  type StoreChecklistKey,
} from "@/lib/constants";
import { createApprovalRequest, decideApproval } from "@/lib/approvals/engine";
import {
  founderEditStoreReadiness,
  getWorkspace,
} from "@/lib/memory/repos";
import { getSkuView } from "@/lib/sku/service";
import { canCheckStoreChecklistKey } from "@/lib/store/gating";

/**
 * Store setup — a SIDE status. The Shopify readiness checklist lives here and
 * store readiness NEVER blocks batch ordering or selling. The `store_ready`
 * gate is side-only (no journey transition). Content/policy drafts are
 * system-written starter text; the founder edits checklist marks + URLs.
 */

type Checklist = Record<StoreChecklistKey, boolean>;

function emptyChecklist(): Checklist {
  return Object.fromEntries(
    STORE_CHECKLIST_KEYS.map((k) => [k, false]),
  ) as Checklist;
}

function parseChecklist(raw: string): Checklist {
  const base = emptyChecklist();
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      for (const k of STORE_CHECKLIST_KEYS) base[k] = !!parsed[k];
    }
  } catch {
    /* keep empty */
  }
  return base;
}

function contentEn(name: string): string {
  return [
    `Title: ${name}`,
    ``,
    `• What it is: one clear sentence on the main benefit for the buyer.`,
    `• Why it helps: the local problem it solves / why it fits daily life in Lebanon.`,
    `• What's included: contents + any bundle.`,
    `• How you receive it: delivery in about 3–7 days nationwide. Pay cash to the delivery person when it arrives (COD).`,
    `• Support: message us on WhatsApp with any question before you order.`,
  ].join("\n");
}

function contentAr(name: string): string {
  return [
    `العنوان: ${name}`,
    ``,
    `• ما هو: جملة واحدة واضحة عن الفائدة الأساسية للمشتري.`,
    `• لماذا يفيد: المشكلة المحلية التي يحلّها / لماذا يناسب الحياة اليومية في لبنان.`,
    `• ما يتضمّنه: المحتويات وأي عرض مجمّع.`,
    `• كيف يصلك: توصيل خلال نحو ٣–٧ أيام لكل لبنان. ادفع نقداً لمندوب التوصيل عند الوصول (الدفع عند الاستلام).`,
    `• الدعم: راسلنا على واتساب لأي سؤال قبل الطلب.`,
  ].join("\n");
}

function policiesDraft(): string {
  return [
    "Shipping: 3–7 business days nationwide via a local delivery company.",
    "Cash on delivery: pay the delivery person when your order arrives.",
    "Returns: 3-day return for unused items in original packaging.",
    "Damaged/wrong item: we replace or refund — contact us on WhatsApp.",
  ].join("\n");
}

async function ensureStoreRow(workspaceId: string) {
  ensureMigrated();
  const existing = await db
    .select()
    .from(schema.storeReadiness)
    .where(eq(schema.storeReadiness.workspaceId, workspaceId))
    .get();
  if (existing) return existing;

  const sku = await getSkuView(workspaceId);
  const name = sku?.name ?? "your product";
  const now = nowIso();
  await db.insert(schema.storeReadiness).values({
    id: newId(),
    workspaceId,
    checklist: JSON.stringify(emptyChecklist()),
    storeUrl: null,
    whatsappNumber: null,
    courierChoice: null,
    policiesDraft: policiesDraft(),
    contentDraftEn: contentEn(name),
    contentDraftAr: contentAr(name),
    updatedAt: now,
  });
  return db
    .select()
    .from(schema.storeReadiness)
    .where(eq(schema.storeReadiness.workspaceId, workspaceId))
    .get();
}

export type StorePanelView = {
  checklist: Checklist;
  checklistKeys: readonly StoreChecklistKey[];
  percent: number;
  storeUrl: string | null;
  whatsappNumber: string | null;
  courierChoice: string | null;
  couriers: readonly string[];
  policiesDraft: string;
  contentDraftEn: string;
  contentDraftAr: string;
  storeReady: boolean;
};

function percentOf(checklist: Checklist): number {
  const total = STORE_CHECKLIST_KEYS.length;
  const done = STORE_CHECKLIST_KEYS.filter((k) => checklist[k]).length;
  return Math.round((done / total) * 100);
}

export async function getStorePanel(
  workspaceId: string,
): Promise<StorePanelView | null> {
  const row = await ensureStoreRow(workspaceId);
  if (!row) return null;

  const side = await db
    .select()
    .from(schema.sideStatuses)
    .where(eq(schema.sideStatuses.workspaceId, workspaceId))
    .get();

  const checklist = parseChecklist(row.checklist);
  return {
    checklist,
    checklistKeys: STORE_CHECKLIST_KEYS,
    percent: percentOf(checklist),
    storeUrl: row.storeUrl,
    whatsappNumber: row.whatsappNumber,
    courierChoice: row.courierChoice,
    couriers: COURIERS_TBD,
    policiesDraft: row.policiesDraft,
    contentDraftEn: row.contentDraftEn,
    contentDraftAr: row.contentDraftAr,
    storeReady: side?.storeReady ?? false,
  };
}

/** Persist the new percent (and side storeReady when complete) after a change. */
async function syncSidePercent(workspaceId: string, checklist: Checklist) {
  const percent = percentOf(checklist);
  await db
    .update(schema.sideStatuses)
    .set({ storeReadyPercent: percent, updatedAt: nowIso() })
    .where(eq(schema.sideStatuses.workspaceId, workspaceId));
  return percent;
}

export async function toggleChecklistItem(
  workspaceId: string,
  key: StoreChecklistKey,
  value: boolean,
): Promise<{ ok: boolean; percent: number }> {
  ensureMigrated();
  const row = await ensureStoreRow(workspaceId);
  if (!row) return { ok: false, percent: 0 };
  if (!STORE_CHECKLIST_KEYS.includes(key)) return { ok: false, percent: 0 };

  const checklist = parseChecklist(row.checklist);
  // v1 gating: checking ON requires prerequisites; unchecking is always allowed.
  if (value && !canCheckStoreChecklistKey(checklist, key)) {
    return { ok: false, percent: percentOf(checklist) };
  }
  checklist[key] = value;
  await founderEditStoreReadiness(workspaceId, {
    checklist: JSON.stringify(checklist),
  });
  const percent = await syncSidePercent(workspaceId, checklist);
  return { ok: true, percent };
}

export async function saveStoreFields(
  workspaceId: string,
  fields: {
    storeUrl?: string | null;
    whatsappNumber?: string | null;
    courierChoice?: string | null;
  },
): Promise<{ ok: boolean }> {
  ensureMigrated();
  await ensureStoreRow(workspaceId);
  await founderEditStoreReadiness(workspaceId, fields);
  return { ok: true };
}

export async function markStoreReady(
  workspaceId: string,
): Promise<{ ok: boolean; error?: string }> {
  ensureMigrated();
  const workspace = await getWorkspace(workspaceId);
  if (!workspace) return { ok: false, error: "not_found" };

  // Side-only gate — records the decision, never advances the journey.
  const approval = await createApprovalRequest(workspaceId, "store_ready", {
    data: {},
  });
  if (!approval) return { ok: false, error: "error" };
  const decided = await decideApproval(approval.id, {
    type: "approve",
    acknowledgements: [],
  });
  if (!decided.ok) return { ok: false, error: "error" };

  const now = nowIso();
  await db
    .update(schema.sideStatuses)
    .set({ storeReady: true, updatedAt: now })
    .where(eq(schema.sideStatuses.workspaceId, workspaceId));
  await db
    .update(schema.workspaces)
    .set({ shopifyStatus: "ready" })
    .where(eq(schema.workspaces.id, workspaceId));

  await db.insert(schema.orchestratorEvents).values({
    id: newId(),
    workspaceId,
    kind: "store_ready",
    message: "Store marked ready (side status)",
    meta: "{}",
    createdAt: now,
  });

  return { ok: true };
}
