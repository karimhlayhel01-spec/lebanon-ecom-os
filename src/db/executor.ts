import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";
import type { PostgresJsQueryResultHKT } from "drizzle-orm/postgres-js";
import type * as schema from "@/db/schema";

type AppSchema = typeof schema;

/** Transaction handle from `db.transaction(async (tx) => …)`. */
export type DbTx = PgTransaction<
  PostgresJsQueryResultHKT,
  AppSchema,
  ExtractTablesWithRelations<AppSchema>
>;

/**
 * Use the root `db` or an open transaction interchangeably.
 * Callers that accept this must not rely on `$client`.
 */
export type DbExecutor = {
  select: DbTx["select"];
  insert: DbTx["insert"];
  update: DbTx["update"];
  delete: DbTx["delete"];
};

/**
 * Throw inside a transaction callback to roll back and return a typed
 * business-level result to the caller (via `isTxRollback`).
 */
export class TxRollback<T> extends Error {
  readonly result: T;
  constructor(result: T) {
    super("tx_rollback");
    this.name = "TxRollback";
    this.result = result;
  }
}

export function isTxRollback<T>(err: unknown): err is TxRollback<T> {
  return err instanceof TxRollback;
}
