import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";
import type { Queryable } from "../db/client.js";
import { db } from "../db/client.js";
import { upsertDataSourceStatus } from "../repositories/data-source-status.repo.js";
import { MarketReportsRepo } from "../repositories/market-reports.repo.js";
import { ManualGptPacksRepo } from "../repositories/manual-gpt-packs.repo.js";
import { StrategyReportsRepo } from "../repositories/strategy-reports.repo.js";
import { todayTaipei } from "../utils/date.js";

export type ReportPersistenceResult = {
  ok: boolean;
  date: string;
  report_type: string;
  db_unavailable?: boolean;
  market_reports?: "saved" | "loaded" | "missing" | "skipped";
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
    return { ok: true, date, report_type: reportType, db_unavailable: true, market_reports: "skipped", strategy_reports: "skipped", manual_gpt_packs: "skipped" };
  }
  const database = deps.database ?? db;
  try {
    const reportMarkdown = await readTextSafe(path.resolve(process.cwd(), "outputs", "reports", `${date}.md`));
    const reportJson = await readJsonSafe(path.resolve(process.cwd(), "outputs", "reports", `${date}.json`));
    const manualMarkdown = await readTextSafe(path.resolve(process.cwd(), "outputs", "manual-packs", `${date}.md`));
    const reportPayload = typeof reportJson === "object" && reportJson ? reportJson as Record<string, unknown> : {};
    const signal = reportPayload.signalEngineResult as Record<string, unknown> | undefined;
    const payloadSize = Buffer.byteLength(reportMarkdown ?? "", "utf8") + Buffer.byteLength(JSON.stringify(reportPayload), "utf8");
    const marketReportStatus = reportMarkdown || reportJson
      ? await new MarketReportsRepo(database).upsertMarketReport({
          report_date: date,
          report_type: reportType,
          ai_mode: config.aiMode,
          data_quality_score: toNumber(signal?.data_quality_score, 0),
          data_gaps: toStringArray(reportPayload.dataGaps),
          sample_size: toNumber(reportPayload.sample_size, 0),
          backtest_available: Boolean(reportPayload.backtest_available),
          confidence_score: confidenceFromPayload(reportPayload, signal),
          market_bias: typeof signal?.market_bias === "string" ? signal.market_bias : undefined,
          market_phase: typeof signal?.market_phase === "string" ? signal.market_phase : undefined,
          big_money_strategy: normalizeStrategy(signal?.big_money_strategy),
          risk_flags: toStringArray(signal?.risk_flags),
          summary: compactText(reportMarkdown ?? "", 6000) || undefined,
          raw_payload: { ...reportPayload, db_persisted_at: new Date().toISOString() }
        }).then(() => "saved" as const)
      : "missing";
    await upsertDataSourceStatus({
      sourceName: "market_report",
      status: marketReportStatus === "saved" ? "ok" : "empty",
      reason: marketReportStatus === "saved" ? null : "market_report_artifact_missing",
      lastUpdated: new Date(),
      payloadSizeBytes: payloadSize
    }, database).catch(() => undefined);
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
    return { ok: true, date, report_type: reportType, market_reports: marketReportStatus, strategy_reports: strategyStatus, manual_gpt_packs: manualStatus };
  } catch (error) {
    return {
      ok: true,
      date,
      report_type: reportType,
      db_unavailable: true,
      market_reports: "skipped",
      strategy_reports: "skipped",
      manual_gpt_packs: "skipped",
      error: String(error)
    };
  }
}

function compactText(value: string, maxLength: number): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > maxLength ? compact.slice(0, maxLength - 1).trimEnd() : compact;
}

function confidenceFromPayload(payload: Record<string, unknown>, signal?: Record<string, unknown>): number {
  const strategyReport = asRecord(payload.strategyReport) ?? payload;
  const market = asRecord(strategyReport.market);
  const likelyPaths = Array.isArray(market?.likely_paths) ? market.likely_paths : [];
  const firstPath = asRecord(likelyPaths[0]);
  return toNumber(firstPath?.confidence_score, toNumber(signal?.data_quality_score, 0));
}

function normalizeStrategy(value: unknown): string | undefined {
  if (Array.isArray(value)) return value.map(String).join(",");
  return typeof value === "string" ? value : undefined;
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

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
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
