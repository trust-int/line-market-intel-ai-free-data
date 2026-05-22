import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { config } from "../config.js";
import { REQUIRED_TABLES } from "../db/tables.js";
import { collectOfficialDataJob } from "./collect-official-data.js";
import type { LiveFetchCheckResult } from "../providers/health/live-fetch-check.js";

const { Pool } = pg;

export type DbBootstrapResult = {
  ok: boolean;
  action: "migrate" | "check" | "seed:dev";
  message: string;
  missing_tables?: string[];
  seeded?: {
    fixture_date?: string;
    watchlist?: string[];
  };
};

export async function migrateDatabase(databaseUrl = config.databaseUrl): Promise<DbBootstrapResult> {
  if (!databaseUrl) return missingDatabaseUrl("migrate");
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const schema = await readFile(path.resolve(process.cwd(), "supabase", "schema.sql"), "utf8");
    await pool.query(schema);
    return { ok: true, action: "migrate", message: "schema.sql executed successfully." };
  } catch (error) {
    return { ok: false, action: "migrate", message: `db:migrate failed: ${String(error)}` };
  } finally {
    await pool.end().catch(() => undefined);
  }
}

export async function checkDatabaseSchema(databaseUrl = config.databaseUrl): Promise<DbBootstrapResult> {
  if (!databaseUrl) return missingDatabaseUrl("check");
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const result = await pool.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public' and table_name = any($1)",
      [REQUIRED_TABLES]
    );
    const missing = findMissingRequiredTables(result.rows.map((row) => row.table_name));
    return {
      ok: missing.length === 0,
      action: "check",
      message: missing.length ? `missing tables: ${missing.join(", ")}` : "all required tables exist.",
      missing_tables: missing
    };
  } catch (error) {
    return { ok: false, action: "check", message: `db:check failed: ${String(error)}` };
  } finally {
    await pool.end().catch(() => undefined);
  }
}

export async function seedDevDatabase(
  databaseUrl = config.databaseUrl,
  env: NodeJS.ProcessEnv = process.env
): Promise<DbBootstrapResult> {
  if (!databaseUrl) return missingDatabaseUrl("seed:dev");
  if (env.NODE_ENV === "production" && env.SEED_DEV_DATA !== "true") {
    return {
      ok: false,
      action: "seed:dev",
      message: "db:seed:dev is blocked in production unless SEED_DEV_DATA=true."
    };
  }

  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const failedLiveResults: LiveFetchCheckResult[] = [
      { provider: "TWSE", status: "network_error", url: "fixture://twse", checked_at: new Date().toISOString() },
      { provider: "TPEx", status: "network_error", url: "fixture://tpex", checked_at: new Date().toISOString() },
      { provider: "MOPS", status: "network_error", url: "fixture://mops", checked_at: new Date().toISOString() }
    ];
    await collectOfficialDataJob("2026-05-07", { mode: "auto", database: pool, liveResults: failedLiveResults });
    await pool.query(
      `insert into watchlist (ticker, name, themes, source, active)
       values ($1,$2,$3,$4,true)
       on conflict (ticker) do update set
         name = excluded.name,
         themes = excluded.themes,
         source = excluded.source,
         active = true`,
      ["2330", "台積電", ["半導體"], "dev_seed"]
    );
    return {
      ok: true,
      action: "seed:dev",
      message: "2026-05-07 fixture data and sample watchlist seeded.",
      seeded: { fixture_date: "2026-05-07", watchlist: ["2330 台積電"] }
    };
  } catch (error) {
    return { ok: false, action: "seed:dev", message: `db:seed:dev failed: ${String(error)}` };
  } finally {
    await pool.end().catch(() => undefined);
  }
}

function missingDatabaseUrl(action: DbBootstrapResult["action"]): DbBootstrapResult {
  return {
    ok: false,
    action,
    message: "DATABASE_URL is missing. Set Supabase/PostgreSQL DATABASE_URL before running this DB command."
  };
}

export function findMissingRequiredTables(existingTables: string[]): string[] {
  const found = new Set(existingTables);
  return REQUIRED_TABLES.filter((table) => !found.has(table));
}

if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  const action = process.argv[2] ?? "check";
  const result =
    action === "migrate"
      ? await migrateDatabase()
      : action === "seed:dev"
        ? await seedDevDatabase()
        : await checkDatabaseSchema();
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}
