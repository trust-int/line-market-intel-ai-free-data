import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Queryable } from "../db/client.js";
import { db } from "../db/client.js";
import { upsertDataSourceStatus } from "../repositories/data-source-status.repo.js";
import { todayTaipei } from "../utils/date.js";
import { clamp } from "../utils/math.js";

export type BuildSectorsResult = {
  ok: boolean;
  date: string;
  inserted_or_updated: number;
  empty_reason?: string;
};

type CandidateRow = {
  ticker: string;
  name?: string | null;
  sector?: string | null;
  total_score?: number | string | null;
  liquidity_score?: number | string | null;
  technical_score?: number | string | null;
  risk_score?: number | string | null;
  risk_flags?: unknown;
};

export async function buildSectors(
  date = todayTaipei(),
  options: { database?: Queryable } = {}
): Promise<BuildSectorsResult> {
  const database = options.database ?? db;
  const candidates = await safeQuery<CandidateRow>(
    database,
    `select ticker, name, sector, total_score, liquidity_score,
            technical_score, risk_score, risk_flags
     from ticker_candidates
     where report_date = $1`,
    [date]
  );
  const bySector = groupBySector(candidates);
  if (!bySector.size) {
    await upsertDataSourceStatus({
      sourceName: "sector_strength",
      status: "empty",
      reason: "sector_strength_source_candidates_empty",
      lastUpdated: new Date(),
      payloadSizeBytes: 0
    }, database).catch(() => undefined);
    return {
      ok: true,
      date,
      inserted_or_updated: 0,
      empty_reason: "sector_strength_pipeline_not_run_or_no_data"
    };
  }

  const ranked = [...bySector.entries()]
    .map(([sector, rows]) => {
      const avgTechnical = average(rows.map((row) => toNumber(row.technical_score, 0)));
      const avgLiquidity = average(rows.map((row) => toNumber(row.liquidity_score, 0)));
      const avgRisk = average(rows.map((row) => toNumber(row.risk_score, 0)));
      const strengthScore = clamp(avgTechnical * 0.40 + avgLiquidity * 0.30 + Math.max(0, 100 - avgRisk) * 0.30, 0, 100);
      return {
        sector,
        rows,
        strengthScore
      };
    })
    .sort((a, b) => b.strengthScore - a.strengthScore);

  let insertedOrUpdated = 0;
  for (const [index, item] of ranked.entries()) {
    const leaders = item.rows
      .sort((a, b) => toNumber(b.total_score, 0) - toNumber(a.total_score, 0))
      .slice(0, 5)
      .map((row) => ({ ticker: row.ticker, name: row.name ?? null }));
    const riskFlags = Array.from(new Set(item.rows.flatMap((row) => toStringArray(row.risk_flags))));
    const result = await database.query(
      `insert into sector_strength (
         report_date, sector, strength_score, rank, reason, leaders, risk_flags
       ) values ($1,$2,$3,$4,$5,$6,$7)
       on conflict (report_date, sector) do update set
         strength_score = excluded.strength_score,
         rank = excluded.rank,
         reason = excluded.reason,
         leaders = excluded.leaders,
         risk_flags = excluded.risk_flags`,
      [
        date,
        item.sector,
        Math.round(item.strengthScore),
        index + 1,
        JSON.stringify({
          fundamental: "",
          chip: "",
          technical: "MVP score from candidate technical/liquidity/risk scores."
        }),
        JSON.stringify(leaders),
        JSON.stringify(riskFlags)
      ]
    );
    insertedOrUpdated += result.rowCount ?? 0;
  }

  await upsertDataSourceStatus({
    sourceName: "sector_strength",
    status: insertedOrUpdated > 0 ? "ok" : "empty",
    reason: insertedOrUpdated > 0 ? null : "sector_strength_upsert_empty",
    lastUpdated: new Date(),
    payloadSizeBytes: insertedOrUpdated
  }, database).catch(() => undefined);

  return { ok: true, date, inserted_or_updated: insertedOrUpdated };
}

function groupBySector(rows: CandidateRow[]) {
  const bySector = new Map<string, CandidateRow[]>();
  for (const row of rows) {
    if (!row.sector) continue;
    const list = bySector.get(row.sector) ?? [];
    list.push(row);
    bySector.set(row.sector, list);
  }
  return bySector;
}

async function safeQuery<T>(database: Queryable, sql: string, params: unknown[] = []): Promise<T[]> {
  try {
    const result = await database.query<T>(sql, params);
    return result.rows;
  } catch {
    return [];
  }
}

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean);
  if (typeof value === "string" && value.trim()) return value.split(",").map((item) => item.trim()).filter(Boolean);
  return [];
}

function toNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  const dateArg = process.argv[2];
  const result = await buildSectors(!dateArg || dateArg === "today" ? todayTaipei() : dateArg);
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}
