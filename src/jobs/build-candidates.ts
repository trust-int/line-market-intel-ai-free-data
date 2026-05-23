import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Queryable } from "../db/client.js";
import { db } from "../db/client.js";
import { upsertDataSourceStatus } from "../repositories/data-source-status.repo.js";
import { todayTaipei } from "../utils/date.js";
import { clamp } from "../utils/math.js";

export type BuildCandidatesResult = {
  ok: boolean;
  date: string;
  candidate_type: string;
  inserted_or_updated: number;
  data_gaps: string[];
};

type WatchlistRow = {
  ticker: string;
  name?: string | null;
  themes?: unknown;
};

type NewsItemRow = {
  related_tickers?: unknown;
  related_sectors?: unknown;
};

type MarketRow = {
  symbol: string;
  name?: string | null;
  change_pct?: number | string | null;
  volume?: number | string | null;
  amount?: number | string | null;
};

type FlowRow = {
  ticker: string;
  foreign_net?: number | string | null;
  investment_trust_net?: number | string | null;
  dealer_net?: number | string | null;
  total_net?: number | string | null;
};

type MarginRow = {
  ticker: string;
  margin_change?: number | string | null;
};

type SectorRow = {
  sector: string;
  strength_score?: number | string | null;
  leaders?: unknown;
};

export async function buildCandidates(
  date = todayTaipei(),
  options: { candidateType?: string; database?: Queryable } = {}
): Promise<BuildCandidatesResult> {
  const database = options.database ?? db;
  const candidateType = options.candidateType ?? "momentum";
  const [watchlist, newsItems] = await Promise.all([
    safeQuery<WatchlistRow>(database, "select ticker, name, themes from watchlist where active = true"),
    safeQuery<NewsItemRow>(
      database,
      "select related_tickers, related_sectors from news_items where collected_at >= now() - interval '36 hours'"
    )
  ]);

  const pool = collectCandidatePool(watchlist, newsItems);
  if (!pool.size) {
    await upsertDataSourceStatus({
      sourceName: "ticker_candidates",
      status: "empty",
      reason: "candidate_source_pool_empty",
      lastUpdated: new Date(),
      payloadSizeBytes: 0
    }, database).catch(() => undefined);
    return { ok: true, date, candidate_type: candidateType, inserted_or_updated: 0, data_gaps: ["candidate_source_pool_empty"] };
  }

  const tickers = [...pool.keys()];
  const [marketRows, flowRows, marginRows, sectorRows] = await Promise.all([
    safeQuery<MarketRow>(
      database,
      "select symbol, symbol as name, change_pct, volume, amount from market_daily where trade_date = $1 and symbol = any($2)",
      [date, tickers]
    ),
    safeQuery<FlowRow>(
      database,
      "select ticker, foreign_net, investment_trust_net, dealer_net, total_net from institutional_flows where trade_date = $1 and ticker = any($2)",
      [date, tickers]
    ),
    safeQuery<MarginRow>(
      database,
      "select ticker, margin_change from margin_short where trade_date = $1 and ticker = any($2)",
      [date, tickers]
    ),
    safeQuery<SectorRow>(
      database,
      "select sector, strength_score, leaders from sector_strength where report_date = $1",
      [date]
    )
  ]);

  const marketByTicker = new Map(marketRows.map((row) => [row.symbol, row]));
  const flowByTicker = new Map(flowRows.map((row) => [row.ticker, row]));
  const marginByTicker = new Map(marginRows.map((row) => [row.ticker, row]));
  const sectorByTicker = buildSectorByTicker(sectorRows);

  let insertedOrUpdated = 0;
  const globalGaps = new Set<string>();
  for (const [ticker, source] of pool) {
    const market = marketByTicker.get(ticker);
    const flow = flowByTicker.get(ticker);
    const margin = marginByTicker.get(ticker);
    const sector = source.sector ?? sectorByTicker.get(ticker)?.sector ?? null;
    const sectorScore = sector ? toNumber(sectorByTicker.get(ticker)?.score, 0) : 0;
    const liquidityScore = market ? liquidityScoreFromMarket(market) : 0;
    const volatilityScore = market ? clamp(Math.abs(toNumber(market.change_pct, 0)) * 18, 0, 100) : 0;
    const technicalScore = market ? clamp(50 + toNumber(market.change_pct, 0) * 10, 0, 100) : 0;
    const chipScore = flow ? clamp(toNumber(flow.total_net, 0) / 100_000, 0, 100) : 0;
    const riskScore = margin ? clamp(Math.max(0, toNumber(margin.margin_change, 0)) / 1000, 0, 100) : 0;
    const riskFlags = [
      !market && "market_daily_missing",
      !flow && "institutional_flow_missing",
      !margin && "margin_short_missing",
      !sector && "sector_mapping_missing"
    ].filter((flag): flag is string => Boolean(flag));
    riskFlags.forEach((gap) => globalGaps.add(gap));
    const totalScore = clamp(
      liquidityScore * 0.25 +
        volatilityScore * 0.20 +
        technicalScore * 0.25 +
        chipScore * 0.15 +
        sectorScore * 0.15 -
        riskScore * 0.20,
      0,
      100
    );
    const sampleSize = [market, flow, margin, sector].filter(Boolean).length;
    const result = await database.query(
      `insert into ticker_candidates (
         report_date, ticker, name, sector, candidate_type, total_score,
         liquidity_score, volatility_score, chip_score, technical_score,
         sector_score, risk_score, entry_zone, exit_zone, stop_loss,
         position_pct, confidence_score, sample_size, risk_flags
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       on conflict (report_date, ticker, candidate_type) do update set
         name = excluded.name,
         sector = excluded.sector,
         total_score = excluded.total_score,
         liquidity_score = excluded.liquidity_score,
         volatility_score = excluded.volatility_score,
         chip_score = excluded.chip_score,
         technical_score = excluded.technical_score,
         sector_score = excluded.sector_score,
         risk_score = excluded.risk_score,
         entry_zone = excluded.entry_zone,
         exit_zone = excluded.exit_zone,
         stop_loss = excluded.stop_loss,
         position_pct = excluded.position_pct,
         confidence_score = excluded.confidence_score,
         sample_size = excluded.sample_size,
         risk_flags = excluded.risk_flags`,
      [
        date,
        ticker,
        source.name ?? market?.name ?? null,
        sector,
        candidateType,
        Math.round(totalScore),
        Math.round(liquidityScore),
        Math.round(volatilityScore),
        Math.round(chipScore),
        Math.round(technicalScore),
        Math.round(sectorScore),
        Math.round(riskScore),
        null,
        null,
        null,
        0,
        Math.round(clamp(totalScore, 0, 100)),
        sampleSize,
        JSON.stringify(riskFlags)
      ]
    );
    insertedOrUpdated += result.rowCount ?? 0;
  }

  await upsertDataSourceStatus({
    sourceName: "ticker_candidates",
    status: insertedOrUpdated > 0 ? "ok" : "empty",
    reason: insertedOrUpdated > 0 ? null : "candidate_upsert_empty",
    lastUpdated: new Date(),
    payloadSizeBytes: insertedOrUpdated
  }, database).catch(() => undefined);

  return {
    ok: true,
    date,
    candidate_type: candidateType,
    inserted_or_updated: insertedOrUpdated,
    data_gaps: [...globalGaps]
  };
}

function collectCandidatePool(watchlist: WatchlistRow[], newsItems: NewsItemRow[]) {
  const pool = new Map<string, { name?: string | null; sector?: string | null }>();
  for (const row of watchlist) {
    if (!row.ticker) continue;
    const sector = toStringArray(row.themes)[0] ?? null;
    pool.set(row.ticker, { name: row.name, sector });
  }
  for (const row of newsItems) {
    const sector = toStringArray(row.related_sectors)[0] ?? null;
    for (const ticker of toStringArray(row.related_tickers)) {
      const current = pool.get(ticker) ?? {};
      pool.set(ticker, { ...current, sector: current.sector ?? sector });
    }
  }
  return pool;
}

function buildSectorByTicker(sectors: SectorRow[]) {
  const byTicker = new Map<string, { sector: string; score: number }>();
  for (const sector of sectors) {
    for (const leader of leaderTickers(sector.leaders)) {
      byTicker.set(leader, { sector: sector.sector, score: toNumber(sector.strength_score, 0) });
    }
  }
  return byTicker;
}

function liquidityScoreFromMarket(row: MarketRow): number {
  const amount = toNumber(row.amount, 0);
  const volume = toNumber(row.volume, 0);
  const base = amount > 0 ? amount : volume;
  return base > 0 ? clamp(Math.log10(base) * 10, 0, 100) : 0;
}

async function safeQuery<T>(database: Queryable, sql: string, params: unknown[] = []): Promise<T[]> {
  try {
    const result = await database.query<T>(sql, params);
    return result.rows;
  } catch {
    return [];
  }
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean);
  if (typeof value === "string" && value.trim()) return value.split(",").map((item) => item.trim()).filter(Boolean);
  return [];
}

function leaderTickers(value: unknown): string[] {
  if (!Array.isArray(value)) return toStringArray(value);
  return value
    .map((item) => {
      if (typeof item === "string") return item;
      if (typeof item === "object" && item !== null && "ticker" in item) return String((item as { ticker?: unknown }).ticker ?? "");
      return "";
    })
    .filter(Boolean);
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
  const [dateArg, typeArg] = process.argv.slice(2);
  const result = await buildCandidates(!dateArg || dateArg === "today" ? todayTaipei() : dateArg, {
    candidateType: typeArg ?? "momentum"
  });
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}
