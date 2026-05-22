import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Queryable } from "../db/client.js";
import { db } from "../db/client.js";
import { buildDailyMarketSnapshot, type DailyMarketSnapshot } from "../market/daily-market-snapshot.js";
import type {
  IndexDaily,
  InstitutionalFlow,
  MarginShort,
  MarketBreadth,
  MarketInstitutionalSummary,
  MarketMarginSummary
} from "../providers/market/provider.js";
import { DailyMarketSnapshotsRepo } from "../repositories/daily-market-snapshots.repo.js";
import { todayTaipei } from "../utils/date.js";

type MarketDailyRow = {
  trade_date: string;
  symbol: string;
  symbol_type: string;
  close?: number;
  change_pct?: number;
  volume?: number;
  amount?: number;
  source?: string;
};

type NewsCountRow = { count: string | number };

export async function buildDailyMarketSnapshotJob(
  tradeDate = todayTaipei(),
  deps: { database?: Queryable; repo?: DailyMarketSnapshotsRepo; sourceStatus?: Record<string, string> } = {}
): Promise<DailyMarketSnapshot> {
  const database = deps.database ?? db;
  const repo = deps.repo ?? new DailyMarketSnapshotsRepo(database);
  const [marketDaily, institutionalRows, marginRows, newsRows] = await Promise.all([
    database.query<MarketDailyRow>(
      "select trade_date, symbol, symbol_type, close, change_pct, volume, amount, source from market_daily where trade_date = $1",
      [tradeDate]
    ),
    database.query<InstitutionalFlow>(
      "select trade_date, ticker, foreign_net as \"foreignNet\", investment_trust_net as \"investmentTrustNet\", dealer_net as \"dealerNet\", total_net as \"totalNet\", source from institutional_flows where trade_date = $1",
      [tradeDate]
    ),
    database.query<MarginShort>(
      "select trade_date, ticker, margin_balance as \"marginBalance\", margin_change as \"marginChange\", short_balance as \"shortBalance\", short_change as \"shortChange\", source from margin_short where trade_date = $1",
      [tradeDate]
    ),
    database.query<NewsCountRow>(
      "select count(*)::text as count from news_events where fetched_at::date = $1",
      [tradeDate]
    )
  ]);

  const rows = marketDaily.rows;
  const indexes = toIndexDaily(rows, tradeDate);
  const breadth = toBreadth(rows, tradeDate);
  const institutional = toInstitutionalSummary(institutionalRows.rows, tradeDate);
  const margin = toMarginSummary(marginRows.rows, tradeDate);
  const dataGaps = buildDataGaps({
    indexes,
    breadth,
    institutionalRows: institutionalRows.rows,
    marginRows: marginRows.rows,
    newsCount: Number(newsRows.rows[0]?.count ?? 0),
    sourceStatus: deps.sourceStatus ?? {}
  });
  const sourceStatus = {
    market_daily: rows.length ? "ok" : "data_unavailable",
    institutional_flows: institutionalRows.rows.length ? "ok" : "data_unavailable",
    margin_short: marginRows.rows.length ? "ok" : "data_unavailable",
    news_events: Number(newsRows.rows[0]?.count ?? 0) > 0 ? "ok" : "data_unavailable",
    ...(deps.sourceStatus ?? {})
  };
  const snapshot = buildDailyMarketSnapshot({
    tradeDate,
    indexes,
    breadth,
    institutional,
    margin,
    dataGaps,
    sourceStatus
  });
  return repo.upsertDailyMarketSnapshot(snapshot);
}

function toIndexDaily(rows: MarketDailyRow[], tradeDate: string): IndexDaily[] {
  return rows
    .filter((row) => ["index", "market_index"].includes(row.symbol_type) || ["TAIEX", "TPEx"].includes(row.symbol))
    .map((row) => ({
      tradeDate,
      symbol: row.symbol,
      close: toNumber(row.close),
      changePct: toNumber(row.change_pct),
      volume: toNumber(row.volume),
      amount: toNumber(row.amount),
      source: row.source ?? "database"
    }));
}

function toBreadth(rows: MarketDailyRow[], tradeDate: string): MarketBreadth[] {
  const stockRows = rows.filter((row) => ["stock", "listed_stock", "otc_stock"].includes(row.symbol_type));
  if (!stockRows.length) return [];
  const advanceCount = stockRows.filter((row) => (toNumber(row.change_pct) ?? 0) > 0).length;
  const declineCount = stockRows.filter((row) => (toNumber(row.change_pct) ?? 0) < 0).length;
  const unchangedCount = stockRows.filter((row) => (toNumber(row.change_pct) ?? 0) === 0).length;
  return [{ tradeDate, market: "TWSE", advanceCount, declineCount, unchangedCount, source: "database:market_daily" }];
}

function toInstitutionalSummary(rows: InstitutionalFlow[], tradeDate: string): MarketInstitutionalSummary[] {
  if (!rows.length) return [];
  return [{
    tradeDate,
    market: "TWSE",
    foreignNetBuy: rows.reduce((sum, row) => sum + (toNumber(row.foreignNet) ?? 0), 0),
    investmentTrustNetBuy: rows.reduce((sum, row) => sum + (toNumber(row.investmentTrustNet) ?? 0), 0),
    dealerNetBuy: rows.reduce((sum, row) => sum + (toNumber(row.dealerNet) ?? 0), 0),
    totalNetBuy: rows.reduce((sum, row) => sum + (toNumber(row.totalNet) ?? 0), 0),
    source: "database:institutional_flows"
  }];
}

function toMarginSummary(rows: MarginShort[], tradeDate: string): MarketMarginSummary[] {
  if (!rows.length) return [];
  return [{
    tradeDate,
    market: "TWSE",
    marginBalanceChange: rows.reduce((sum, row) => sum + (toNumber(row.marginChange) ?? 0), 0),
    shortBalanceChange: rows.reduce((sum, row) => sum + (toNumber(row.shortChange) ?? 0), 0),
    marginBalance: rows.reduce((sum, row) => sum + (toNumber(row.marginBalance) ?? 0), 0),
    shortBalance: rows.reduce((sum, row) => sum + (toNumber(row.shortBalance) ?? 0), 0),
    source: "database:margin_short"
  }];
}

function buildDataGaps(input: {
  indexes: IndexDaily[];
  breadth: MarketBreadth[];
  institutionalRows: InstitutionalFlow[];
  marginRows: MarginShort[];
  newsCount: number;
  sourceStatus: Record<string, string>;
}): string[] {
  const gaps = [
    !input.indexes.some((row) => row.symbol === "TAIEX") && "taiex_index_missing",
    !input.indexes.some((row) => row.symbol === "TPEx") && "tpex_index_missing",
    !input.breadth.length && "market_breadth_missing",
    !input.institutionalRows.length && "institutional_flows_missing",
    !input.marginRows.length && "margin_short_missing",
    input.newsCount === 0 && "news_events_missing",
    ...Object.entries(input.sourceStatus)
      .filter(([, status]) => status !== "ok")
      .map(([source, status]) => `${source}_${status}`)
  ];
  return gaps.filter((gap): gap is string => Boolean(gap));
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  const tradeDate = process.argv[2] ?? todayTaipei();
  const snapshot = await buildDailyMarketSnapshotJob(tradeDate);
  process.stdout.write(JSON.stringify(snapshot, null, 2) + "\n");
}
