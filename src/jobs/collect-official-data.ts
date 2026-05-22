import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Queryable } from "../db/client.js";
import { db } from "../db/client.js";
import { buildDailyMarketSnapshot } from "../market/daily-market-snapshot.js";
import { getOfficialDataMode, type OfficialDataMode } from "../official-data-mode.js";
import { runLiveFetchCheck } from "../providers/health/live-fetch-check.js";
import { DailyMarketSnapshotsRepo } from "../repositories/daily-market-snapshots.repo.js";
import { InstitutionalFlowsRepo } from "../repositories/institutional-flows.repo.js";
import { MarginShortRepo } from "../repositories/margin-short.repo.js";
import { MarketDailyRepo, type MarketDailyUpsertRow } from "../repositories/market-daily.repo.js";
import { NewsEventsRepo } from "../repositories/news-events.repo.js";
import { todayTaipei } from "../utils/date.js";
import { collectOfficialDataWithFixtureFallback } from "./e2e-daily-dry-run.js";

export type CollectOfficialDataResult = {
  date: string;
  mode: OfficialDataMode;
  sourceStatus: Record<string, string>;
  dataGaps: string[];
  upserts: {
    market_daily: number;
    institutional_flows: number;
    margin_short: number;
    news_events: number;
    daily_market_snapshots: boolean;
  };
};

export async function collectOfficialDataJob(
  date = todayTaipei(),
  options: { mode?: OfficialDataMode; database?: Queryable; liveResults?: Awaited<ReturnType<typeof runLiveFetchCheck>> } = {}
): Promise<CollectOfficialDataResult> {
  const mode = getOfficialDataMode(options.mode);
  const database = options.database ?? db;
  const liveResults = options.liveResults ?? await runLiveFetchCheck(date);
  const official = await collectOfficialDataWithFixtureFallback(date, liveResults, { mode });
  const marketRepo = new MarketDailyRepo(database);
  const institutionalRepo = new InstitutionalFlowsRepo(database);
  const marginRepo = new MarginShortRepo(database);
  const newsRepo = new NewsEventsRepo(database);
  const snapshotRepo = new DailyMarketSnapshotsRepo(database);
  const marketRows: MarketDailyUpsertRow[] = [
    ...official.indexes.map((row): MarketDailyUpsertRow => ({ ...row, symbolType: "index" })),
    ...official.stockDaily.map((row): MarketDailyUpsertRow => ({
      ...row,
      symbolType: row.source.startsWith("tpex") ? "otc_stock" : "listed_stock"
    }))
  ];
  const [marketCount, institutionalCount, marginCount, newsCount] = await Promise.all([
    marketRepo.upsertMarketDaily(marketRows),
    institutionalRepo.upsertInstitutionalFlows(official.institutionalFlows),
    marginRepo.upsertMarginShort(official.marginShort),
    newsRepo.upsertNewsEvents(official.mopsMaterialNews)
  ]);
  const snapshot = buildDailyMarketSnapshot({
    tradeDate: date,
    indexes: official.indexes,
    breadth: official.breadth,
    institutional: official.institutionalSummaries,
    margin: official.marginSummaries,
    dataGaps: official.dataGaps,
    sourceStatus: official.sourceStatus
  });
  await snapshotRepo.upsertDailyMarketSnapshot(snapshot);
  return {
    date,
    mode,
    sourceStatus: official.sourceStatus,
    dataGaps: official.dataGaps,
    upserts: {
      market_daily: marketCount,
      institutional_flows: institutionalCount,
      margin_short: marginCount,
      news_events: newsCount,
      daily_market_snapshots: true
    }
  };
}

export async function collectOfficialDataRangeJob(
  startDate: string,
  endDate: string,
  options: { mode?: OfficialDataMode; database?: Queryable } = {}
): Promise<CollectOfficialDataResult[]> {
  const results: CollectOfficialDataResult[] = [];
  for (const date of datesBetween(startDate, endDate)) {
    results.push(await collectOfficialDataJob(date, options));
  }
  return results;
}

function datesBetween(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const current = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  while (current <= end) {
    dates.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}

if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const mode = getOfficialDataMode(args.find((arg) => arg.startsWith("--mode="))?.split("=")[1]);
  const rangeIndex = args.indexOf("--range");
  if (rangeIndex >= 0) {
    const start = args[rangeIndex + 1] ?? todayTaipei();
    const end = args[rangeIndex + 2] ?? start;
    process.stdout.write(JSON.stringify(await collectOfficialDataRangeJob(start, end, { mode }), null, 2) + "\n");
  } else {
    const date = args.find((arg) => !arg.startsWith("--")) ?? todayTaipei();
    process.stdout.write(JSON.stringify(await collectOfficialDataJob(date === "today" ? todayTaipei() : date, { mode }), null, 2) + "\n");
  }
}
