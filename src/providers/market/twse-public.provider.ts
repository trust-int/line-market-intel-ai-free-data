import { config } from "../../config.js";
import { enforceProviderPolicy, type ProviderPolicy } from "../../cost/provider-policy.js";
import { compactDate } from "../../utils/date.js";
import {
  fetchOfficialJson,
  getByField,
  parseNumber,
  parseSignedNumber
} from "../official/archive.js";
import type {
  BrokerBranchFlow,
  DayTradeStats,
  IndexDaily,
  IndexIntraday,
  InstitutionalFlow,
  MarginShort,
  MarketBreadth,
  MarketDataProvider,
  MarketInstitutionalSummary,
  MarketMarginSummary,
  SectorDaily,
  StockDaily,
  StockIntraday
} from "./provider.js";

type TwseMiIndexRaw = {
  stat?: string;
  date?: string;
  fields1?: string[];
  data1?: unknown[][];
  fields2?: string[];
  data2?: unknown[][];
  fields8?: string[];
  data8?: unknown[][];
  fields9?: string[];
  data9?: unknown[][];
  [key: string]: unknown;
};

type TwseT86Raw = {
  stat?: string;
  fields?: string[];
  data?: unknown[][];
};

type TwseMarginRaw = {
  stat?: string;
  fields?: string[];
  data?: unknown[][];
};

export class TwsePublicProvider implements MarketDataProvider {
  name = "twse-public";
  policy: ProviderPolicy = {
    name: this.name,
    category: "market",
    enabled: config.enableTwsePublic,
    paid: false,
    requiresLogin: false,
    requiresPermission: false,
    termsChecked: true,
    licenseStatus: "official_public",
    allowedWhenNoPaidApi: true,
    mode: config.enableTwsePublic ? "automatic" : "disabled",
    note: "TWSE official public endpoints only, low frequency with graceful data_unavailable."
  };

  async fetchDailyPricesRaw(date: string): Promise<TwseMiIndexRaw | undefined> {
    if (enforceProviderPolicy(this.policy).status === "disabled") return undefined;
    const url = `https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?date=${compactDate(date)}&type=ALLBUT0999&response=json`;
    return fetchOfficialJson({ provider: this.name, dataset: "mi-index", tradeDate: date, url }) as Promise<TwseMiIndexRaw | undefined>;
  }

  async fetchInstitutionalRaw(date: string): Promise<TwseT86Raw | undefined> {
    if (enforceProviderPolicy(this.policy).status === "disabled") return undefined;
    const url = `https://www.twse.com.tw/rwd/zh/fund/T86?date=${compactDate(date)}&selectType=ALLBUT0999&response=json`;
    return fetchOfficialJson({ provider: this.name, dataset: "institutional-t86", tradeDate: date, url }) as Promise<TwseT86Raw | undefined>;
  }

  async fetchMarginRaw(date: string): Promise<TwseMarginRaw | undefined> {
    if (enforceProviderPolicy(this.policy).status === "disabled") return undefined;
    const url = `https://www.twse.com.tw/rwd/zh/marginTrading/MI_MARGN?date=${compactDate(date)}&selectType=ALL&response=json`;
    return fetchOfficialJson({ provider: this.name, dataset: "margin-mi-margn", tradeDate: date, url }) as Promise<TwseMarginRaw | undefined>;
  }

  normalizeDailyPrices(raw: TwseMiIndexRaw, date: string): StockDaily[] {
    const fields = raw.fields9 ?? [];
    const data = raw.data9 ?? [];
    return data
      .map((row) => ({
        tradeDate: date,
        symbol: String(getByField(row, fields, ["證券代號"]) ?? ""),
        name: String(getByField(row, fields, ["證券名稱"]) ?? ""),
        open: parseNumber(getByField(row, fields, ["開盤價"])),
        high: parseNumber(getByField(row, fields, ["最高價"])),
        low: parseNumber(getByField(row, fields, ["最低價"])),
        close: parseNumber(getByField(row, fields, ["收盤價"])),
        changePct: undefined,
        volume: parseNumber(getByField(row, fields, ["成交股數"])),
        amount: parseNumber(getByField(row, fields, ["成交金額"])),
        turnover: undefined,
        source: this.name
      }))
      .filter((row) => /^\d{4}$/.test(row.symbol));
  }

  normalizeMarketIndex(raw: TwseMiIndexRaw, date: string): IndexDaily[] {
    const fields = raw.fields1 ?? raw.fields2 ?? [];
    const data = raw.data1 ?? raw.data2 ?? [];
    const rows = data.map((row) => {
      const name = String(getByField(row, fields, ["指數", "指數名稱"]) ?? row[0] ?? "");
      return {
        tradeDate: date,
        symbol: name.includes("發行量加權") || name.includes("TAIEX") ? "TAIEX" : name,
        close: parseNumber(getByField(row, fields, ["收盤指數", "收盤"])),
        changePct: parseSignedNumber(getByField(row, fields, ["漲跌百分比"])),
        source: this.name
      };
    });
    return rows.filter((row) => row.symbol === "TAIEX" || String(row.symbol).includes("加權"));
  }

  normalizeMarketBreadth(raw: TwseMiIndexRaw, date: string): MarketBreadth {
    const fields = raw.fields8 ?? [];
    const stockRow = (raw.data8 ?? []).find((row) => String(row[0] ?? "").includes("股票")) ?? [];
    return {
      tradeDate: date,
      market: "TWSE",
      advanceCount: parseNumber(getByField(stockRow, fields, ["上漲"])),
      declineCount: parseNumber(getByField(stockRow, fields, ["下跌"])),
      unchangedCount: parseNumber(getByField(stockRow, fields, ["持平"])),
      noTradeCount: parseNumber(getByField(stockRow, fields, ["未成交"])),
      source: this.name
    };
  }

  normalizeInstitutionalFlows(raw: TwseT86Raw, date: string): InstitutionalFlow[] {
    const fields = raw.fields ?? [];
    return (raw.data ?? [])
      .map((row) => ({
        tradeDate: date,
        ticker: String(getByField(row, fields, ["證券代號"]) ?? ""),
        foreignNet: parseSignedNumber(getByField(row, fields, ["外陸資買賣超股數", "外資買賣超"])),
        investmentTrustNet: parseSignedNumber(getByField(row, fields, ["投信買賣超股數", "投信買賣超"])),
        dealerNet: parseSignedNumber(getByField(row, fields, ["自營商買賣超股數", "自營商買賣超"])),
        totalNet: parseSignedNumber(getByField(row, fields, ["三大法人買賣超股數", "合計買賣超"])),
        source: this.name
      }))
      .filter((row) => /^\d{4}$/.test(row.ticker));
  }

  normalizeInstitutionalSummary(raw: TwseT86Raw, date: string): MarketInstitutionalSummary {
    const flows = this.normalizeInstitutionalFlows(raw, date);
    const sum = (selector: (row: InstitutionalFlow) => number | undefined) =>
      flows.reduce((total, row) => total + (selector(row) ?? 0), 0);
    return {
      tradeDate: date,
      market: "TWSE",
      foreignNetBuy: sum((row) => row.foreignNet),
      investmentTrustNetBuy: sum((row) => row.investmentTrustNet),
      dealerNetBuy: sum((row) => row.dealerNet),
      totalNetBuy: sum((row) => row.totalNet),
      source: this.name
    };
  }

  normalizeMarginShort(raw: TwseMarginRaw, date: string): MarginShort[] {
    const fields = raw.fields ?? [];
    return (raw.data ?? [])
      .map((row) => ({
        tradeDate: date,
        ticker: String(getByField(row, fields, ["股票代號", "證券代號"]) ?? ""),
        marginBalance: parseNumber(getByField(row, fields, ["融資今日餘額", "融資餘額"])),
        marginChange: parseSignedNumber(getByField(row, fields, ["融資增減"])),
        shortBalance: parseNumber(getByField(row, fields, ["融券今日餘額", "融券餘額"])),
        shortChange: parseSignedNumber(getByField(row, fields, ["融券增減"])),
        source: this.name
      }))
      .filter((row) => /^\d{4}$/.test(row.ticker));
  }

  normalizeMarginSummary(raw: TwseMarginRaw, date: string): MarketMarginSummary {
    const rows = this.normalizeMarginShort(raw, date);
    return {
      tradeDate: date,
      market: "TWSE",
      marginBalanceChange: rows.reduce((sum, row) => sum + (row.marginChange ?? 0), 0),
      shortBalanceChange: rows.reduce((sum, row) => sum + (row.shortChange ?? 0), 0),
      marginBalance: rows.reduce((sum, row) => sum + (row.marginBalance ?? 0), 0),
      shortBalance: rows.reduce((sum, row) => sum + (row.shortBalance ?? 0), 0),
      source: this.name
    };
  }

  async getIndexDaily(date: string): Promise<IndexDaily[]> {
    const raw = await this.fetchDailyPricesRaw(date);
    return raw ? this.normalizeMarketIndex(raw, date) : [];
  }

  async getStockDaily(date: string, tickers: string[]): Promise<StockDaily[]> {
    const raw = await this.fetchDailyPricesRaw(date);
    const rows = raw ? this.normalizeDailyPrices(raw, date) : [];
    const tickerSet = new Set(tickers);
    return tickerSet.size ? rows.filter((row) => tickerSet.has(row.symbol)) : rows;
  }

  async getInstitutionalFlows(date: string, tickers: string[]): Promise<InstitutionalFlow[]> {
    const raw = await this.fetchInstitutionalRaw(date);
    const rows = raw ? this.normalizeInstitutionalFlows(raw, date) : [];
    const tickerSet = new Set(tickers);
    return tickerSet.size ? rows.filter((row) => tickerSet.has(row.ticker)) : rows;
  }

  async getMarginShort(date: string, tickers: string[]): Promise<MarginShort[]> {
    const raw = await this.fetchMarginRaw(date);
    const rows = raw ? this.normalizeMarginShort(raw, date) : [];
    const tickerSet = new Set(tickers);
    return tickerSet.size ? rows.filter((row) => tickerSet.has(row.ticker)) : rows;
  }

  async getIndexIntraday(_date: string): Promise<IndexIntraday[]> { return []; }
  async getStockIntraday(_date: string, _tickers: string[]): Promise<StockIntraday[]> { return []; }
  async getSectorDaily(_date: string): Promise<SectorDaily[]> { return []; }
  async getDayTradeStats(_date: string, _tickers: string[]): Promise<DayTradeStats[]> { return []; }
  async getBrokerBranchFlows(_date: string, _tickers: string[]): Promise<BrokerBranchFlow[]> { return []; }
}
