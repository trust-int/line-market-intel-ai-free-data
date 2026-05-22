import type { Queryable } from "../db/client.js";
import { db } from "../db/client.js";
import type { SectorStrength } from "./sector-strength-engine.js";
import type { InstitutionalFlow, MarginShort, StockDaily, StockIntraday } from "../providers/market/provider.js";
import { clamp, roundToTick } from "../utils/math.js";

export type TickerCandidate = {
  ticker: string;
  name?: string;
  candidate_type: "daytrade_long" | "daytrade_short" | "swing" | "hold" | "reduce" | "avoid" | "watch";
  side: "long" | "short" | "neutral";
  stage: "未發動" | "剛發動" | "主升段" | "換手整理" | "過熱" | "轉弱";
  score: number;
  confidence_score: number;
  entry_zone?: {
    price_min?: number;
    price_max?: number;
    rule: string;
  };
  stop_loss?: {
    price?: number;
    rule: string;
  };
  take_profit?: {
    price_min?: number;
    price_max?: number;
    rule: string;
  };
  triggers: string[];
  risks: string[];
  rationale: string[];
  data_gaps: string[];
};

export type TickerCandidateInput = {
  watchlist?: Array<{ ticker: string; name?: string; themes?: string[] }>;
  holdings?: Array<{ ticker: string; name?: string; avg_cost?: number; qty?: number }>;
  lineMessages?: Array<{ tickers?: string[]; raw_text?: string; topics?: string[] }>;
  newsEvents?: Array<{ tickers?: string[]; title?: string; summary?: string; source?: string; licenseStatus?: string; license_status?: string }>;
  marketDaily?: StockDaily[];
  marketIntraday?: StockIntraday[];
  institutionalFlows?: InstitutionalFlow[];
  marginShort?: MarginShort[];
  sectorStrength?: SectorStrength[];
};

export async function calculateTickerCandidates(
  date: string,
  input?: TickerCandidateInput,
  database: Queryable = db
): Promise<{ candidates: TickerCandidate[]; data_gaps: string[] }> {
  const loaded = input ? await loadTickerCandidateInput(date, database) : undefined;
  const data = input ? { ...loaded, ...input } : await loadTickerCandidateInput(date, database);
  return calculateTickerCandidatesFromInput(data);
}

export function calculateTickerCandidatesFromInput(input: TickerCandidateInput): { candidates: TickerCandidate[]; data_gaps: string[] } {
  const globalGaps = [
    !input.marketDaily?.length && "ticker_market_daily_missing",
    !input.institutionalFlows?.length && "ticker_institutional_flows_missing",
    !input.marketIntraday?.length && "ticker_intraday_vwap_missing"
  ].filter((gap): gap is string => Boolean(gap));
  const tickers = collectTickers(input);
  const marketByTicker = new Map((input.marketDaily ?? []).map((row) => [row.symbol, row]));
  const intradayByTicker = new Map((input.marketIntraday ?? []).map((row) => [row.symbol, row]));
  const instByTicker = new Map((input.institutionalFlows ?? []).map((row) => [row.ticker, row]));
  const marginByTicker = new Map((input.marginShort ?? []).map((row) => [row.ticker, row]));
  const sectorByTicker = buildSectorByTicker(input.sectorStrength ?? []);

  const scoredCandidates = [...tickers].map((ticker) => {
    const market = marketByTicker.get(ticker);
    const intraday = intradayByTicker.get(ticker);
    const inst = instByTicker.get(ticker);
    const margin = marginByTicker.get(ticker);
    const sector = sectorByTicker.get(ticker);
    const newsCount = countNewsMentions(ticker, input);
    const isHolding = input.holdings?.some((row) => row.ticker === ticker) ?? false;
    const isWatchlist = input.watchlist?.some((row) => row.ticker === ticker) ?? false;
    const dataGaps = [
      !market && "ticker_ohlcv_missing",
      !intraday && "ticker_intraday_vwap_missing",
      !inst && "ticker_institutional_flow_missing",
      !margin && "ticker_margin_short_missing",
      !sector && "ticker_sector_strength_missing"
    ].filter((gap): gap is string => Boolean(gap));
    const catalystScore = clamp(newsCount * 35, 0, 100);
    const sectorScore = sector?.score ?? 0;
    const priceVolumeScore = market ? clamp((market.changePct ?? 0) * 18 + Math.log10((market.amount ?? market.volume ?? 1)) * 8, 0, 100) : 0;
    const institutionalScore = inst ? clamp(((inst.foreignNet ?? 0) + (inst.investmentTrustNet ?? 0) * 1.5 + (inst.dealerNet ?? 0)) / 100_000, 0, 100) : 0;
    const marginRisk = margin ? clamp(Math.max(0, margin.marginChange ?? 0) / 1000, 0, 100) : 50;
    const relationScore = isHolding || isWatchlist ? 100 : 0;
    const dataQuality = clamp(100 - dataGaps.length * 16, 0, 100);
    const score = clamp(
      catalystScore * 0.2 +
        sectorScore * 0.15 +
        priceVolumeScore * 0.2 +
        institutionalScore * 0.15 +
        (100 - marginRisk) * 0.1 +
        relationScore * 0.1 +
        dataQuality * 0.1,
      0,
      100
    );
    const candidateType = classifyCandidate({ score, market, intraday, sector, catalystScore, isHolding, dataGaps });
    const hasCandidateContext = newsCount > 0 || isHolding || isWatchlist || Boolean(sector);
    const candidate: TickerCandidate = {
      ticker,
      name: market?.name ?? input.watchlist?.find((row) => row.ticker === ticker)?.name ?? input.holdings?.find((row) => row.ticker === ticker)?.name,
      candidate_type: candidateType,
      side: candidateType === "daytrade_short" || candidateType === "reduce" || candidateType === "avoid" ? "short" : candidateType === "watch" || candidateType === "hold" ? "neutral" : "long",
      stage: stageFromScore(score, marginRisk),
      score: Math.round(score),
      confidence_score: clamp(Math.round(score * (dataQuality / 100)), 10, 90),
      triggers: buildTriggers(candidateType, Boolean(intraday)),
      risks: [
        ...(!intraday ? ["缺少 intraday / VWAP / 內外盤，不能給精準當沖進場價"] : []),
        ...(!market ? ["缺少個股 OHLCV，不能給技術支撐壓力價格"] : []),
        ...(newsCount > 0 && !market ? ["只有消息催化，僅列觀察"] : []),
        ...(marginRisk > 75 ? ["融資增幅偏高"] : [])
      ],
      rationale: [
        `消息催化分數 ${Math.round(catalystScore)}`,
        `族群分數 ${Math.round(sectorScore)}`,
        `量價分數 ${Math.round(priceVolumeScore)}`,
        `法人分數 ${Math.round(institutionalScore)}`,
        isHolding ? "與持股相關" : isWatchlist ? "與觀察名單相關" : "非持股/觀察名單"
      ],
      data_gaps: dataGaps
    };
    return { candidate: addTradingPlan(candidate, market, intraday), hasCandidateContext };
  });

  return {
    candidates: scoredCandidates
      .filter(({ candidate, hasCandidateContext }) => hasCandidateContext && (candidate.score >= 25 || candidate.candidate_type === "watch"))
      .map(({ candidate }) => candidate)
      .sort((a, b) => b.score - a.score),
    data_gaps: globalGaps
  };
}

function classifyCandidate(params: {
  score: number;
  market?: StockDaily;
  intraday?: StockIntraday;
  sector?: SectorStrength;
  catalystScore: number;
  isHolding: boolean;
  dataGaps: string[];
}): TickerCandidate["candidate_type"] {
  if (params.isHolding) return params.score < 35 ? "reduce" : "hold";
  if (!params.market && params.catalystScore > 0) return "watch";
  if (!params.market) return "watch";
  if (params.score >= 75 && params.intraday && params.sector && params.market.changePct && params.market.changePct > 2) return "daytrade_long";
  if (params.score >= 65 && params.market.changePct && params.market.changePct > 1 && params.sector) return "swing";
  if (params.score < 30) return "avoid";
  return "watch";
}

function addTradingPlan(candidate: TickerCandidate, market?: StockDaily, intraday?: StockIntraday): TickerCandidate {
  if (candidate.candidate_type === "daytrade_long" && intraday?.vwap && market?.close) {
    return {
      ...candidate,
      entry_zone: { price_min: roundToTick(intraday.vwap), price_max: roundToTick(market.close * 1.01), rule: "盤中站上 VWAP 且成交量確認" },
      stop_loss: { price: roundToTick(intraday.vwap * 0.99), rule: "跌破 VWAP 且無法收回" },
      take_profit: { price_min: roundToTick(market.close * 1.03), price_max: roundToTick(market.close * 1.05), rule: "分批停利" }
    };
  }
  if (candidate.candidate_type === "swing" && market?.close && market.low) {
    return {
      ...candidate,
      entry_zone: { price_min: roundToTick(market.low), price_max: roundToTick(market.close), rule: "回測日低到收盤區間且量縮守穩" },
      stop_loss: { price: roundToTick(market.low * 0.97), rule: "跌破日低且無法收回" },
      take_profit: { price_min: roundToTick(market.close * 1.08), price_max: roundToTick(market.close * 1.15), rule: "依壓力區分批" }
    };
  }
  return {
    ...candidate,
    entry_zone: { rule: candidate.data_gaps.includes("ticker_intraday_vwap_missing") ? "需要盤中確認，暫不給精準進場價" : "等待確認" },
    stop_loss: { rule: market ? "跌破近期低點再評估" : "缺少 OHLCV，不能給支撐停損價" },
    take_profit: { rule: market ? "依成交量與壓力區分批" : "缺少 OHLCV，不能給停利價格" }
  };
}

function stageFromScore(score: number, marginRisk: number): TickerCandidate["stage"] {
  if (marginRisk > 85) return "過熱";
  if (score >= 75) return "主升段";
  if (score >= 60) return "剛發動";
  if (score >= 45) return "換手整理";
  if (score < 30) return "轉弱";
  return "未發動";
}

function buildTriggers(type: TickerCandidate["candidate_type"], hasIntraday: boolean): string[] {
  if (type === "daytrade_long") return ["站上 VWAP", "成交量放大", "族群同步"];
  if (type === "swing") return ["日線量價轉強", "法人買盤延續", "族群排名維持"];
  if (!hasIntraday) return ["需要盤中確認"];
  return ["等待更多資料"];
}

function collectTickers(input: TickerCandidateInput): Set<string> {
  const tickers = new Set<string>();
  input.watchlist?.forEach((row) => tickers.add(row.ticker));
  input.holdings?.forEach((row) => tickers.add(row.ticker));
  input.marketDaily?.forEach((row) => tickers.add(row.symbol));
  input.institutionalFlows?.forEach((row) => tickers.add(row.ticker));
  input.marginShort?.forEach((row) => tickers.add(row.ticker));
  input.newsEvents?.forEach((row) => row.tickers?.forEach((ticker) => tickers.add(ticker)));
  input.lineMessages?.forEach((row) => row.tickers?.forEach((ticker) => tickers.add(ticker)));
  return tickers;
}

function countNewsMentions(ticker: string, input: TickerCandidateInput): number {
  const news = input.newsEvents?.filter((row) => row.tickers?.includes(ticker)).length ?? 0;
  const line = input.lineMessages?.filter((row) => row.tickers?.includes(ticker)).length ?? 0;
  return news + line;
}

function buildSectorByTicker(sectors: SectorStrength[]): Map<string, SectorStrength> {
  const map = new Map<string, SectorStrength>();
  for (const sector of sectors) {
    for (const ticker of [...sector.leaders, ...sector.second_line]) map.set(ticker, sector);
  }
  return map;
}

async function loadTickerCandidateInput(date: string, database: Queryable): Promise<TickerCandidateInput> {
  const [watchlist, holdings, marketDaily, institutional, margin, news, lineMessages] = await Promise.all([
    database.query<{ ticker: string; name?: string; themes?: string[] }>("select ticker, name, themes from watchlist where active = true"),
    database.query<{ ticker: string; name?: string; avg_cost?: number; qty?: number }>("select ticker, name, avg_cost, qty from holdings where active = true"),
    database.query<StockDaily>(
      "select trade_date as \"tradeDate\", symbol, close, high, low, open, change_pct as \"changePct\", volume, amount, source from market_daily where trade_date = $1 and symbol_type in ('stock','listed_stock','otc_stock')",
      [date]
    ),
    database.query<InstitutionalFlow>(
      "select trade_date as \"tradeDate\", ticker, foreign_net as \"foreignNet\", investment_trust_net as \"investmentTrustNet\", dealer_net as \"dealerNet\", total_net as \"totalNet\", source from institutional_flows where trade_date = $1",
      [date]
    ),
    database.query<MarginShort>(
      "select trade_date as \"tradeDate\", ticker, margin_change as \"marginChange\", short_change as \"shortChange\", margin_balance as \"marginBalance\", short_balance as \"shortBalance\", source from margin_short where trade_date = $1",
      [date]
    ),
    database.query<{ tickers?: string[]; title?: string; summary?: string; source?: string; license_status?: string }>(
      "select tickers, title, summary, source, license_status from news_events where fetched_at::date = $1",
      [date]
    ),
    database.query<{ tickers?: string[]; raw_text?: string; topics?: string[] }>(
      "select tickers, raw_text, topics from line_messages where received_at::date = $1 and status = 'active'",
      [date]
    )
  ]);
  return {
    watchlist: watchlist.rows,
    holdings: holdings.rows,
    marketDaily: marketDaily.rows,
    institutionalFlows: institutional.rows,
    marginShort: margin.rows,
    newsEvents: news.rows.map((row) => ({ ...row, licenseStatus: row.license_status })),
    lineMessages: lineMessages.rows
  };
}
