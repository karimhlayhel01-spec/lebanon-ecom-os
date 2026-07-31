import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { existsSync, readFileSync } from "fs";
import path from "path";
import postgres from "postgres";
import * as schema from "./schema";

/** Load `.env` for CLI scripts (tsx seed / migrate); Next.js already injects env. */
function loadDotEnv() {
  if (process.env.DATABASE_URL) return;
  const envPath = path.join(process.cwd(), ".env");
  if (!existsSync(envPath)) return;
  try {
    for (const line of readFileSync(envPath, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = val;
    }
  } catch {
    /* ignore unreadable .env */
  }
}

loadDotEnv();

function resolveDatabaseUrl(): string {
  const url = process.env.DATABASE_URL?.trim();
  if (url) return url;

  // Unit tests import modules that pull in `@/db` but never query.
  // Defer the hard failure to ensureMigrated() / first real query.
  if (process.env.VITEST || process.env.NODE_ENV === "test") {
    return "postgresql://postgres:postgres@127.0.0.1:5432/lebanon_ecom_test";
  }

  throw new Error(
    "DATABASE_URL is required (Postgres connection string). See .env.example.",
  );
}

const connectionString = resolveDatabaseUrl();

/**
 * postgres.js client. `prepare: false` keeps Neon / PgBouncer transaction
 * poolers happy; local Postgres works the same way.
 */
const client = postgres(connectionString, {
  max: 10,
  prepare: false,
});

export const db = drizzle(client, { schema });

let migratePromise: Promise<void> | null = null;

/**
 * Apply Drizzle Kit migrations once per process.
 * Prefer `npm run db:migrate` (or `db:push` during early schema iteration);
 * this also runs on first app use so local/QA boots stay reliable.
 */
export async function ensureMigrated(): Promise<void> {
  if (!process.env.DATABASE_URL?.trim()) {
    if (process.env.VITEST || process.env.NODE_ENV === "test") {
      return;
    }
    throw new Error(
      "DATABASE_URL is required (Postgres connection string). See .env.example.",
    );
  }

  if (!migratePromise) {
    migratePromise = migrate(db, {
      migrationsFolder: path.join(process.cwd(), "drizzle"),
    }).catch((err) => {
      migratePromise = null;
      throw err;
    });
  }
  await migratePromise;
}

export { schema };
