import type {
  IndexDaily,
  MarketBreadth,
  MarketInstitutionalSummary,
  MarketMarginSummary
} from "../providers/market/provider.js";
import { clamp } from "../utils/math.js";

export type DailyMarketSnapshot = {
  trade_date: string;
  taiex_close?: number;
  taiex_change_pct?: number;
  taiex_volume?: number;
  otc_close?: number;
  otc_change_pct?: number;
  advance_count?: number;
  decline_count?: number;
  foreign_net_buy?: number;
  investment_trust_net_buy?: number;
  dealer_net_buy?: number;
  margin_balance_change?: number;
  short_balance_change?: number;
  market_bias: "bullish" | "neutral" | "bearish";
  risk_level: "low" | "medium" | "high" | "critical";
  data_quality_score: number;
  data_gaps: string[];
  source_status: Record<string, string>;
  created_at: string;
};

export function buildDailyMarketSnapshot(input: {
  tradeDate: string;
  indexes: IndexDaily[];
  breadth: MarketBreadth[];
  institutional: MarketInstitutionalSummary[];
  margin: MarketMarginSummary[];
  dataGaps?: string[];
  sourceStatus?: Record<string, string>;
}): DailyMarketSnapshot {
  const taiex = input.indexes.find((row) => row.symbol === "TAIEX");
  const otc = input.indexes.find((row) => row.symbol === "TPEx");
  const breadth = aggregateBreadth(input.breadth);
  const institutional = aggregateInstitutional(input.institutional);
  const margin = aggregateMargin(input.margin);
  const sourceStatus = input.sourceStatus ?? {};
  const failingSources = Object.values(sourceStatus).filter((status) => status !== "ok").length;
  const dataQualityScore = clamp(100 - (input.dataGaps?.length ?? 0) * 12 - failingSources * 10, 0, 100);
  const score =
    (taiex?.changePct ?? 0) * 12 +
    (otc?.changePct ?? 0) * 10 +
    breadthScore(breadth.advance_count, breadth.decline_count) +
    institutionalScore(institutional.foreign_net_buy, institutional.investment_trust_net_buy) -
    marginRiskPenalty(margin.margin_balance_change);

  return {
    trade_date: input.tradeDate,
    taiex_close: taiex?.close,
    taiex_change_pct: taiex?.changePct,
    taiex_volume: taiex?.volume,
    otc_close: otc?.close,
    otc_change_pct: otc?.changePct,
    advance_count: breadth.advance_count,
    decline_count: breadth.decline_count,
    foreign_net_buy: institutional.foreign_net_buy,
    investment_trust_net_buy: institutional.investment_trust_net_buy,
    dealer_net_buy: institutional.dealer_net_buy,
    margin_balance_change: margin.margin_balance_change,
    short_balance_change: margin.short_balance_change,
    market_bias: score > 20 ? "bullish" : score < -20 ? "bearish" : "neutral",
    risk_level: riskLevel(score, margin.margin_balance_change, breadth.advance_count, breadth.decline_count),
    data_quality_score: dataQualityScore,
    data_gaps: input.dataGaps ?? [],
    source_status: sourceStatus,
    created_at: new Date().toISOString()
  };
}

function aggregateBreadth(rows: MarketBreadth[]) {
  return {
    advance_count: sum(rows.map((row) => row.advanceCount)),
    decline_count: sum(rows.map((row) => row.declineCount))
  };
}

function aggregateInstitutional(rows: MarketInstitutionalSummary[]) {
  return {
    foreign_net_buy: sum(rows.map((row) => row.foreignNetBuy)),
    investment_trust_net_buy: sum(rows.map((row) => row.investmentTrustNetBuy)),
    dealer_net_buy: sum(rows.map((row) => row.dealerNetBuy))
  };
}

function aggregateMargin(rows: MarketMarginSummary[]) {
  return {
    margin_balance_change: sum(rows.map((row) => row.marginBalanceChange)),
    short_balance_change: sum(rows.map((row) => row.shortBalanceChange))
  };
}

function sum(values: Array<number | undefined>): number | undefined {
  const valid = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (!valid.length) return undefined;
  return valid.reduce((total, value) => total + value, 0);
}

function breadthScore(advance?: number, decline?: number): number {
  if (!advance && !decline) return 0;
  const total = (advance ?? 0) + (decline ?? 0);
  if (!total) return 0;
  return (((advance ?? 0) - (decline ?? 0)) / total) * 35;
}

function institutionalScore(foreignNet?: number, trustNet?: number): number {
  const net = (foreignNet ?? 0) + (trustNet ?? 0) * 1.5;
  if (!net) return 0;
  return clamp(net / 1_000_000_000, -25, 25);
}

function marginRiskPenalty(marginChange?: number): number {
  if (!marginChange || marginChange <= 0) return 0;
  return clamp(marginChange / 500_000, 0, 20);
}

function riskLevel(score: number, marginChange?: number, advance?: number, decline?: number): DailyMarketSnapshot["risk_level"] {
  const breadthWeak = (advance ?? 0) < (decline ?? 0) && score > 0;
  const marginHot = (marginChange ?? 0) > 5_000_000;
  if (marginHot && breadthWeak) return "critical";
  if (marginHot || breadthWeak || score < -35) return "high";
  if (score < -10 || score > 45) return "medium";
  return "low";
}
