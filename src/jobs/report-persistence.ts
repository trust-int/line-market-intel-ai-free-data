import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";
import type { Queryable } from "../db/client.js";
import { db } from "../db/client.js";
import { ManualGptPacksRepo } from "../repositories/manual-gpt-packs.repo.js";
import { StrategyReportsRepo } from "../repositories/strategy-reports.repo.js";
import { todayTaipei } from "../utils/date.js";

export type ReportPersistenceResult = {
  ok: boolean;
  date: string;
  report_type: string;
  db_unavailable?: boolean;
  strategy_reports?: "saved" | "loaded" | "missing" | "skipped";
  manual_gpt_packs?: "saved" | "loaded" | "missing" | "skipped";
  source?: "db" | "file" | "none";
  report?: unknown;
  manual_pack?: unknown;
  error?: string;
};

export async function saveReportArtifacts(
  date = todayTaipei(),
  reportType = "postmarket",
  deps: { database?: Queryable; databaseAvailable?: boolean } = {}
): Promise<ReportPersistenceResult> {
  const databaseAvailable = deps.databaseAvailable ?? Boolean(config.databaseUrl);
  if (!databaseAvailable) {
    return { ok: true, date, report_type: reportType, db_unavailable: true, strategy_reports: "skipped", manual_gpt_packs: "skipped" };
  }
  const database = deps.database ?? db;
  try {
    const reportMarkdown = await readTextSafe(path.resolve(process.cwd(), "outputs", "reports", `${date}.md`));
    const reportJson = await readJsonSafe(path.resolve(process.cwd(), "outputs", "reports", `${date}.json`));
    const manualMarkdown = await readTextSafe(path.resolve(process.cwd(), "outputs", "manual-packs", `${date}.md`));
    const reportPayload = typeof reportJson === "object" && reportJson ? reportJson as Record<string, unknown> : {};
    const signal = reportPayload.signalEngineResult as Record<string, unknown> | undefined;
    const strategyStatus = reportMarkdown
      ? await new StrategyReportsRepo(database).upsertStrategyReport({
          report_date: date,
          report_type: reportType,
          market_bias: typeof signal?.market_bias === "string" ? signal.market_bias : undefined,
          smart_money_phase: Array.isArray(signal?.big_money_strategy) ? signal.big_money_strategy.join(",") : undefined,
          summary_md: reportMarkdown,
          report_json: { ...reportPayload, db_persisted_at: new Date().toISOString() }
        }).then(() => "saved" as const)
      : "missing";
    const manualStatus = manualMarkdown
      ? await new ManualGptPacksRepo(database).upsertManualGptPack({
          pack_date: date,
          pack_type: reportType,
          markdown: manualMarkdown,
          json_payload: { source: "outputs/manual-packs", date, report_type: reportType }
        }).then(() => "saved" as const)
      : "missing";
    return { ok: true, date, report_type: reportType, strategy_reports: strategyStatus, manual_gpt_packs: manualStatus };
  } catch (error) {
    return {
      ok: true,
      date,
      report_type: reportType,
      db_unavailable: true,
      strategy_reports: "skipped",
      manual_gpt_packs: "skipped",
      error: String(error)
    };
  }
}

export async function loadReportArtifacts(
  date = todayTaipei(),
  reportType = "postmarket",
  deps: { database?: Queryable; databaseAvailable?: boolean } = {}
): Promise<ReportPersistenceResult> {
  const databaseAvailable = deps.databaseAvailable ?? Boolean(config.databaseUrl);
  if (databaseAvailable) {
    try {
      const database = deps.database ?? db;
      const [report, manualPack] = await Promise.all([
        new StrategyReportsRepo(database).getStrategyReport(date, reportType),
        new ManualGptPacksRepo(database).getManualGptPack(date, reportType)
      ]);
      if (report || manualPack) {
        return {
          ok: true,
          date,
          report_type: reportType,
          source: "db",
          strategy_reports: report ? "loaded" : "missing",
          manual_gpt_packs: manualPack ? "loaded" : "missing",
          report,
          manual_pack: manualPack
        };
      }
    } catch {
      // Fall through to file output.
    }
  }
  const reportMarkdown = await readTextSafe(path.resolve(process.cwd(), "outputs", "reports", `${date}.md`));
  const manualMarkdown = await readTextSafe(path.resolve(process.cwd(), "outputs", "manual-packs", `${date}.md`));
  if (!reportMarkdown && !manualMarkdown) {
    return { ok: false, date, report_type: reportType, db_unavailable: !databaseAvailable, source: "none", strategy_reports: "missing", manual_gpt_packs: "missing" };
  }
  return {
    ok: true,
    date,
    report_type: reportType,
    db_unavailable: !databaseAvailable,
    source: "file",
    strategy_reports: reportMarkdown ? "loaded" : "missing",
    manual_gpt_packs: manualMarkdown ? "loaded" : "missing",
    report: reportMarkdown ? { summary_md: reportMarkdown } : undefined,
    manual_pack: manualMarkdown ? { markdown: manualMarkdown } : undefined
  };
}

async function readTextSafe(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return undefined;
  }
}

async function readJsonSafe(filePath: string): Promise<unknown | undefined> {
  const text = await readTextSafe(filePath);
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  const [action = "load", dateArg, reportType = "postmarket"] = process.argv.slice(2);
  const date = !dateArg || dateArg === "today" ? todayTaipei() : dateArg;
  const result = action === "save" ? await saveReportArtifacts(date, reportType) : await loadReportArtifacts(date, reportType);
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}
