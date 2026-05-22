import type { ProviderPolicy } from "../../cost/provider-policy.js";

export type IndexDaily = {
  tradeDate: string;
  symbol: string;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  changePct?: number;
  volume?: number;
  amount?: number;
  source: string;
};

export type MarketBreadth = {
  tradeDate: string;
  market: "TWSE" | "TPEX";
  advanceCount?: number;
  declineCount?: number;
  unchangedCount?: number;
  noTradeCount?: number;
  source: string;
};

export type IndexIntraday = IndexDaily & {
  ts: string;
  vwap?: number;
};

export type StockDaily = IndexDaily & {
  name?: string;
  turnover?: number;
};

export type StockIntraday = IndexIntraday & {
  bidQty?: number;
  askQty?: number;
  buyVolume?: number;
  sellVolume?: number;
};

export type SectorDaily = {
  tradeDate: string;
  theme: string;
  score: number;
  leaders: string[];
  source: string;
};

export type InstitutionalFlow = {
  tradeDate: string;
  ticker: string;
  foreignNet?: number;
  investmentTrustNet?: number;
  dealerNet?: number;
  totalNet?: number;
  source: string;
};

export type MarketInstitutionalSummary = {
  tradeDate: string;
  market: "TWSE" | "TPEX";
  foreignNetBuy?: number;
  investmentTrustNetBuy?: number;
  dealerNetBuy?: number;
  totalNetBuy?: number;
  source: string;
};

export type MarginShort = {
  tradeDate: string;
  ticker: string;
  marginBalance?: number;
  marginChange?: number;
  shortBalance?: number;
  shortChange?: number;
  daytradeRatio?: number;
  source: string;
};

export type MarketMarginSummary = {
  tradeDate: string;
  market: "TWSE" | "TPEX";
  marginBalanceChange?: number;
  shortBalanceChange?: number;
  marginBalance?: number;
  shortBalance?: number;
  source: string;
};

export type DayTradeStats = {
  tradeDate: string;
  ticker: string;
  daytradeRatio?: number;
  buyAmount?: number;
  sellAmount?: number;
  source: string;
};

export type BrokerBranchFlow = {
  tradeDate: string;
  ticker: string;
  branchName: string;
  buyQty?: number;
  sellQty?: number;
  netQty?: number;
  source: string;
};

export interface MarketDataProvider {
  name: string;
  policy: ProviderPolicy;
  getIndexDaily(date: string): Promise<IndexDaily[]>;
  getIndexIntraday(date: string): Promise<IndexIntraday[]>;
  getStockDaily(date: string, tickers: string[]): Promise<StockDaily[]>;
  getStockIntraday(date: string, tickers: string[]): Promise<StockIntraday[]>;
  getSectorDaily(date: string): Promise<SectorDaily[]>;
  getInstitutionalFlows(date: string, tickers: string[]): Promise<InstitutionalFlow[]>;
  getMarginShort(date: string, tickers: string[]): Promise<MarginShort[]>;
  getDayTradeStats(date: string, tickers: string[]): Promise<DayTradeStats[]>;
  getBrokerBranchFlows(date: string, tickers: string[]): Promise<BrokerBranchFlow[]>;
}

export const emptyMarketProviderMethods = {
  getIndexDaily: async () => [],
  getIndexIntraday: async () => [],
  getStockDaily: async () => [],
  getStockIntraday: async () => [],
  getSectorDaily: async () => [],
  getInstitutionalFlows: async () => [],
  getMarginShort: async () => [],
  getDayTradeStats: async () => [],
  getBrokerBranchFlows: async () => []
};
