/**
 * Wave 2 Discovery product pool — seed from curated catalog + Approach A reads.
 * Writers live only in pool/jobs modules — never journey / Finance / accept paths.
 */

import { eq, inArray } from "drizzle-orm";
import { db, ensureMigrated, schema } from "@/db";
import { newId, nowIso } from "@/lib/ids";
import {
  CATALOG,
  type CatalogProduct,
} from "@/lib/discovery/catalog";
import type { StorageFootprint } from "@/lib/skills/fit";
import { isDiscoveryPoolV2Enabled } from "@/lib/discovery/flags";
import {
  nextPath1ImageUrl,
  type NormalizedPath1Candidate,
} from "@/lib/discovery/normalize";

export type PoolProductRow = typeof schema.discoveryProductPool.$inferSelect;

export function poolRowToCatalogProduct(row: PoolProductRow): CatalogProduct {
  let tier1: string[] = [];
  try {
    const parsed = JSON.parse(row.tier1Marketplaces);
    if (Array.isArray(parsed)) tier1 = parsed.map(String);
  } catch {
    tier1 = [];
  }

  const difficulty = clamp01(row.difficulty) as 0 | 1 | 2;
  const risk = clamp01(row.risk) as 0 | 1 | 2;
  const workload = clamp01(row.workload) as 0 | 1 | 2;
  const footprint = normalizeFootprint(row.storageFootprint);

  return {
    key: row.catalogKey,
    category: row.category as CatalogProduct["category"],
    en: {
      name: row.nameEn,
      summary: row.summaryEn,
      differentiation: row.differentiationEn,
    },
    ar: {
      name: row.nameAr || row.nameEn,
      summary: row.summaryAr || row.summaryEn,
      differentiation: row.differentiationAr || row.differentiationEn,
    },
    sellPrice: row.sellPrice,
    productCost: row.productCost,
    intlShip: row.intlShip,
    clearanceTaxes: row.clearanceTaxes,
    localCourier: row.localCourier,
    difficulty,
    risk,
    timeNeed: row.timeNeed,
    workload,
    storageFootprint: footprint,
    oversized: row.oversized,
    tier1Marketplaces: tier1,
    imageUrl: row.imageUrl ?? null,
  };
}

function clamp01(n: number): number {
  if (n <= 0) return 0;
  if (n >= 2) return 2;
  return Math.round(n);
}

function normalizeFootprint(raw: string): StorageFootprint {
  if (raw === "medium" || raw === "large" || raw === "small") return raw;
  return "small";
}

function catalogToPoolValues(p: CatalogProduct, at: string) {
  return {
    catalogKey: p.key,
    nameEn: p.en.name,
    nameAr: p.ar.name,
    category: p.category,
    summaryEn: p.en.summary,
    summaryAr: p.ar.summary,
    differentiationEn: p.en.differentiation,
    differentiationAr: p.ar.differentiation,
    sellPrice: p.sellPrice,
    productCost: p.productCost,
    intlShip: p.intlShip,
    clearanceTaxes: p.clearanceTaxes,
    localCourier: p.localCourier,
    difficulty: p.difficulty,
    risk: p.risk,
    timeNeed: p.timeNeed,
    workload: p.workload,
    storageFootprint: p.storageFootprint,
    oversized: p.oversized,
    tier1Marketplaces: JSON.stringify(p.tier1Marketplaces),
    sourceUrl: null as string | null,
    moqHint: null as number | null,
    sampleCostHint: null as number | null,
    source: "catalog_seed" as const,
    active: true,
    updatedAt: at,
  };
}

/**
 * Upsert curated `CATALOG` rows into the pool (seed / fallback SoT).
 * Idempotent — safe to call from Discovery when pool v2 is enabled.
 */
export async function syncCatalogSeedToPool(): Promise<{ upserted: number }> {
  await ensureMigrated();
  const at = nowIso();
  let upserted = 0;

  for (const p of CATALOG) {
    const existing = await db
      .select({ id: schema.discoveryProductPool.id })
      .from(schema.discoveryProductPool)
      .where(eq(schema.discoveryProductPool.catalogKey, p.key))
      .then((rows) => rows[0]);

    const values = catalogToPoolValues(p, at);

    if (existing) {
      await db
        .update(schema.discoveryProductPool)
        .set(values)
        .where(eq(schema.discoveryProductPool.id, existing.id));
    } else {
      await db.insert(schema.discoveryProductPool).values({
        id: newId(),
        ...values,
        createdAt: at,
      });
    }
    upserted += 1;
  }

  return { upserted };
}

/**
 * Upsert Path 1 normalized candidates into the pool (`source: path1_search`).
 * Does not overwrite `catalog_seed` rows that share a key (seed keys differ).
 * Isolation: called only from intake jobs — never journey / Finance / accept.
 */
export async function upsertPath1PoolCandidates(
  candidates: readonly NormalizedPath1Candidate[],
): Promise<{ upserted: number; inserted: number; updated: number }> {
  await ensureMigrated();
  const at = nowIso();
  let inserted = 0;
  let updated = 0;

  for (const c of candidates) {
    const existing = await db
      .select({
        id: schema.discoveryProductPool.id,
        source: schema.discoveryProductPool.source,
        imageUrl: schema.discoveryProductPool.imageUrl,
      })
      .from(schema.discoveryProductPool)
      .where(eq(schema.discoveryProductPool.catalogKey, c.catalogKey))
      .then((rows) => rows[0]);

    const values = {
      catalogKey: c.catalogKey,
      nameEn: c.nameEn,
      nameAr: c.nameAr,
      category: c.category,
      summaryEn: c.summaryEn,
      summaryAr: c.summaryAr,
      differentiationEn: c.differentiationEn,
      differentiationAr: c.differentiationAr,
      sellPrice: c.sellPrice,
      productCost: c.productCost,
      intlShip: c.intlShip,
      clearanceTaxes: c.clearanceTaxes,
      localCourier: c.localCourier,
      difficulty: c.difficulty,
      risk: c.risk,
      timeNeed: c.timeNeed,
      workload: c.workload,
      storageFootprint: c.storageFootprint,
      oversized: c.oversized,
      tier1Marketplaces: c.tier1Marketplaces,
      sourceUrl: c.sourceUrl,
      moqHint: c.moqHint,
      sampleCostHint: c.sampleCostHint,
      imageUrl: nextPath1ImageUrl(c.imageUrl, existing?.imageUrl),
      source: c.source,
      active: c.active,
      updatedAt: at,
    };

    if (existing) {
      // Never clobber curated catalog_seed with a Path 1 collision.
      if (existing.source === "catalog_seed") continue;
      await db
        .update(schema.discoveryProductPool)
        .set(values)
        .where(eq(schema.discoveryProductPool.id, existing.id));
      updated += 1;
    } else {
      await db.insert(schema.discoveryProductPool).values({
        id: newId(),
        ...values,
        createdAt: at,
      });
      inserted += 1;
    }
  }

  return { upserted: inserted + updated, inserted, updated };
}

/** Active pool rows as CatalogProduct[] (Approach A read path — scoring / jobs). */
export async function loadActivePoolAsCatalog(): Promise<CatalogProduct[]> {
  await ensureMigrated();
  const rows = await db
    .select()
    .from(schema.discoveryProductPool)
    .where(eq(schema.discoveryProductPool.active, true));
  return rows.map(poolRowToCatalogProduct);
}

/**
 * Batch-load pool products by catalogKey (O(keys), not full active pool).
 * Discovery view uses this so Path 1 names missing from catalog.ts resolve
 * without scanning ~hundreds of pool rows on every dashboard render.
 */
export async function loadPoolProductsByCatalogKeys(
  catalogKeys: readonly string[],
): Promise<Map<string, CatalogProduct>> {
  const unique = [...new Set(catalogKeys.filter((k) => k.length > 0))];
  const map = new Map<string, CatalogProduct>();
  if (unique.length === 0) return map;

  await ensureMigrated();
  const rows = await db
    .select()
    .from(schema.discoveryProductPool)
    .where(inArray(schema.discoveryProductPool.catalogKey, unique));

  for (const row of rows) {
    map.set(row.catalogKey, poolRowToCatalogProduct(row));
  }
  return map;
}

/** MOQ / sample hints keyed by catalogKey (missing → neutral in BudgetFight). */
export async function loadPoolHintsByCatalogKey(): Promise<
  Map<string, { moqHint: number | null; sampleCostHint: number | null }>
> {
  await ensureMigrated();
  const rows = await db
    .select({
      catalogKey: schema.discoveryProductPool.catalogKey,
      moqHint: schema.discoveryProductPool.moqHint,
      sampleCostHint: schema.discoveryProductPool.sampleCostHint,
    })
    .from(schema.discoveryProductPool)
    .where(eq(schema.discoveryProductPool.active, true));

  const map = new Map<
    string,
    { moqHint: number | null; sampleCostHint: number | null }
  >();
  for (const row of rows) {
    map.set(row.catalogKey, {
      moqHint: row.moqHint,
      sampleCostHint: row.sampleCostHint,
    });
  }
  return map;
}

/**
 * Resolve the catalog Discovery should score against.
 * Flag off → in-memory CATALOG. Flag on → pool (seeded) with CATALOG fallback.
 */
export async function resolveDiscoveryCatalogSource(): Promise<
  readonly CatalogProduct[]
> {
  if (!isDiscoveryPoolV2Enabled()) return CATALOG;

  await syncCatalogSeedToPool();
  const fromPool = await loadActivePoolAsCatalog();
  if (fromPool.length === 0) return CATALOG;
  return fromPool;
}
