/**
 * One-shot founder recovery: refresh Local (Lebanon) leads for a single owned SKU.
 * Usage:
 *   npx tsx scripts/supplier-refresh-local.ts --skuId=<id> [--confirm]
 *   npx tsx scripts/supplier-refresh-local.ts --active
 *
 * Requires SUPPLIER_LIVE_LEADS=1 and SERPER_API_KEY. Does not wipe Import or other SKUs.
 */

import { db, ensureMigrated, schema } from "@/db";
import { eq } from "drizzle-orm";
import { refreshLocalLeads } from "@/lib/supplier/service";

async function main() {
  const args = process.argv.slice(2);
  const skuArg = args.find((a) => a.startsWith("--skuId="));
  const useActive = args.includes("--active");
  const confirm = args.includes("--confirm");

  await ensureMigrated();

  let workspaceId: string | null = null;
  let skuId: string | null = skuArg?.slice("--skuId=".length) ?? null;

  if (useActive || !skuId) {
    const ws = await db
      .select()
      .from(schema.workspaces)
      .then((rows) => rows[0]);
    if (!ws?.activeSkuId) {
      console.error("No workspace activeSkuId. Pass --skuId=…");
      process.exit(1);
    }
    workspaceId = ws.id;
    skuId = ws.activeSkuId;
    console.log(`Using active SKU ${skuId} on workspace ${workspaceId}`);
  } else {
    const card = await db
      .select()
      .from(schema.skuCards)
      .where(eq(schema.skuCards.id, skuId))
      .then((rows) => rows[0]);
    if (!card) {
      console.error("SKU not found:", skuId);
      process.exit(1);
    }
    workspaceId = card.workspaceId;
  }

  const res = await refreshLocalLeads(workspaceId, skuId!, {
    confirmResetProgress: confirm,
  });
  console.log(JSON.stringify(res, null, 2));
  if (!res.ok) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
