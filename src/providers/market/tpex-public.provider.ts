import { config } from "../../config.js";
import { enforceProviderPolicy, type ProviderPolicy } from "../../cost/provider-policy.js";
import {
  fetchOfficialJson,
  getByField,
  isoToRocDate,
  parseNumber,
  parseSignedNumber,
  rocDateToIso
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

type TpexOpenApiRows = Array<Record<string, unknown>> | { data?: unknown[]; tables?: unknown[]; [key: string]: unknown };

export class TpexPublicProvider implements MarketDataProvider {
  name = "tpex-public";
  policy: ProviderPolicy = {
    name: this.name,
    category: "market",
    enabled: config.enableTpexPublic,
    paid: false,
    requiresLogin: false,
    requiresPermission: false,
    termsChecked: true,
    licenseStatus: "official_public",
    allowedWhenNoPaidApi: true,
    mode: config.enableTpexPublic ? "automatic" : "disabled",
    note: "TPEx official OpenAPI data only."
  };

  async fetchDailyPricesRaw(date: string): Promise<TpexOpenApiRows | undefined> {
    if (enforceProviderPolicy(this.policy).status === "disabled") return undefined;
    const url = `https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes?d=${encodeURIComponent(isoToRocDate(date))}`;
    return fetchOfficialJson({ provider: this.name, dataset: "daily-close-quotes", tradeDate: date, url }) as Promise<TpexOpenApiRows | undefined>;
  }

  async fetchIndexRaw(date: string): Promise<TpexOpenApiRows | undefined> {
    if (enforceProviderPolicy(this.policy).status === "disabled") return undefined;
    const url = `https://www.tpex.org.tw/openapi/v1/tpex_daily_trading_index?d=${encodeURIComponent(isoToRocDate(date))}`;
    return fetchOfficialJson({ provider: this.name, dataset: "daily-trading-index", tradeDate: date, url }) as Promise<TpexOpenApiRows | undefined>;
  }

  async fetchInstitutionalRaw(date: string): Promise<TpexOpenApiRows | undefined> {
    if (enforceProviderPolicy(this.policy).status === "disabled") return undefined;
    const url = `https://www.tpex.org.tw/openapi/v1/tpex_3insti_daily_trading?d=${encodeURIComponent(isoToRocDate(date))}`;
    return fetchOfficialJson({ provider: this.name, dataset: "3insti-daily-trading", tradeDate: date, url }) as Promise<TpexOpenApiRows | undefined>;
  }

  async fetchMarginRaw(date: string): Promise<TpexOpenApiRows | undefined> {
    if (enforceProviderPolicy(this.policy).status === "disabled") return undefined;
    const url = `https://www.tpex.org.tw/openapi/v1/tpex_mainboard_margin_balance?d=${encodeURIComponent(isoToRocDate(date))}`;
    return fetchOfficialJson({ provider: this.name, dataset: "mainboard-margin-balance", tradeDate: date, url }) as Promise<TpexOpenApiRows | undefined>;
  }

  normalizeDailyPrices(raw: TpexOpenApiRows, fallbackDate: string): StockDaily[] {
    return asRecords(raw)
      .map((row) => ({
        tradeDate: normalizeDate(row["Date"] ?? row["日期"], fallbackDate),
        symbol: String(row["SecuritiesCompanyCode"] ?? row["代號"] ?? row["Code"] ?? ""),
        name: String(row["CompanyName"] ?? row["名稱"] ?? row["Name"] ?? ""),
        open: parseNumber(row["Open"] ?? row["開盤"]),
        high: parseNumber(row["High"] ?? row["最高"]),
        low: parseNumber(row["Low"] ?? row["最低"]),
        close: parseNumber(row["Close"] ?? row["收盤"]),
        changePct: parseSignedNumber(row["ChangePercent"] ?? row["漲跌幅"]),
        volume: parseNumber(row["TradingShares"] ?? row["成交股數"] ?? row["成交仟股"]),
        amount: parseNumber(row["TransactionAmount"] ?? row["成交金額"]),
        turnover: parseNumber(row["TurnoverRate"] ?? row["週轉率"]),
        source: this.name
      }))
      .filter((row) => /^\d{4}$/.test(row.symbol));
  }

  normalizeMarketIndex(raw: TpexOpenApiRows, fallbackDate: string): IndexDaily[] {
    return asRecords(raw)
      .map((row) => {
        const name = String(row["IndexName"] ?? row["指數名稱"] ?? row["Name"] ?? "TPEx");
        return {
          tradeDate: normalizeDate(row["Date"] ?? row["日期"], fallbackDate),
          symbol: name.includes("櫃買") || name.toLowerCase().includes("tpex") ? "TPEx" : name,
          close: parseNumber(row["Close"] ?? row["收盤指數"] ?? row["指數"]),
          changePct: parseSignedNumber(row["ChangePercent"] ?? row["漲跌幅"]),
          volume: parseNumber(row["TradingShares"] ?? row["成交股數"]),
          amount: parseNumber(row["TransactionAmount"] ?? row["成交金額"]),
          source: this.name
        };
      })
      .filter((row) => row.symbol === "TPEx" || String(row.symbol).includes("櫃買"));
  }

  normalizeMarketBreadth(raw: TpexOpenApiRows, fallbackDate: string): MarketBreadth {
    const records = asRecords(raw);
    const first = records[0] ?? {};
    return {
      tradeDate: normalizeDate(first["Date"] ?? first["日期"], fallbackDate),
      market: "TPEX",
      advanceCount: parseNumber(first["AdvanceCount"] ?? first["上漲家數"] ?? first["上漲"]),
      declineCount: parseNumber(first["DeclineCount"] ?? first["下跌家數"] ?? first["下跌"]),
      unchangedCount: parseNumber(first["UnchangedCount"] ?? first["持平家數"] ?? first["持平"]),
      source: this.name
    };
  }

  normalizeInstitutionalFlows(raw: TpexOpenApiRows, fallbackDate: string): InstitutionalFlow[] {
    return asRecords(raw)
      .map((row) => ({
        tradeDate: normalizeDate(row["Date"] ?? row["日期"], fallbackDate),
        ticker: String(row["SecuritiesCompanyCode"] ?? row["代號"] ?? row["Code"] ?? ""),
        foreignNet: parseSignedNumber(row["ForeignInvestorNetBuySell"] ?? row["外資及陸資買賣超股數"] ?? row["外資買賣超"]),
        investmentTrustNet: parseSignedNumber(row["InvestmentTrustNetBuySell"] ?? row["投信買賣超股數"] ?? row["投信買賣超"]),
        dealerNet: parseSignedNumber(row["DealerNetBuySell"] ?? row["自營商買賣超股數"] ?? row["自營商買賣超"]),
        totalNet: parseSignedNumber(row["TotalNetBuySell"] ?? row["三大法人買賣超股數"] ?? row["合計買賣超"]),
        source: this.name
      }))
      .filter((row) => /^\d{4}$/.test(row.ticker));
  }

  normalizeInstitutionalSummary(raw: TpexOpenApiRows, date: string): MarketInstitutionalSummary {
    const flows = this.normalizeInstitutionalFlows(raw, date);
    const sum = (selector: (row: InstitutionalFlow) => number | undefined) =>
      flows.reduce((total, row) => total + (selector(row) ?? 0), 0);
    return {
      tradeDate: date,
      market: "TPEX",
      foreignNetBuy: sum((row) => row.foreignNet),
      investmentTrustNetBuy: sum((row) => row.investmentTrustNet),
      dealerNetBuy: sum((row) => row.dealerNet),
      totalNetBuy: sum((row) => row.totalNet),
      source: this.name
    };
  }

  normalizeMarginShort(raw: TpexOpenApiRows, fallbackDate: string): MarginShort[] {
    return asRecords(raw)
      .map((row) => ({
        tradeDate: normalizeDate(row["Date"] ?? row["日期"], fallbackDate),
        ticker: String(row["SecuritiesCompanyCode"] ?? row["代號"] ?? row["Code"] ?? ""),
        marginBalance: parseNumber(row["MarginPurchaseTodayBalance"] ?? row["融資餘額"] ?? row["融資今日餘額"]),
        marginChange: parseSignedNumber(row["MarginPurchaseChange"] ?? row["融資增減"]),
        shortBalance: parseNumber(row["ShortSaleTodayBalance"] ?? row["融券餘額"] ?? row["融券今日餘額"]),
        shortChange: parseSignedNumber(row["ShortSaleChange"] ?? row["融券增減"]),
        source: this.name
      }))
      .filter((row) => /^\d{4}$/.test(row.ticker));
  }

  normalizeMarginSummary(raw: TpexOpenApiRows, date: string): MarketMarginSummary {
    const rows = this.normalizeMarginShort(raw, date);
    return {
      tradeDate: date,
      market: "TPEX",
      marginBalanceChange: rows.reduce((sum, row) => sum + (row.marginChange ?? 0), 0),
      shortBalanceChange: rows.reduce((sum, row) => sum + (row.shortChange ?? 0), 0),
      marginBalance: rows.reduce((sum, row) => sum + (row.marginBalance ?? 0), 0),
      shortBalance: rows.reduce((sum, row) => sum + (row.shortBalance ?? 0), 0),
      source: this.name
    };
  }

  async getIndexDaily(date: string): Promise<IndexDaily[]> {
    const raw = await this.fetchIndexRaw(date);
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

function asRecords(raw: TpexOpenApiRows): Array<Record<string, unknown>> {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw.data)) {
    if (Array.isArray(raw.data[0])) {
      const fields = (raw.fields ?? []) as string[];
      return (raw.data as unknown[][]).map((row) =>
        Object.fromEntries(fields.map((field, index) => [field, row[index]]))
      );
    }
    return raw.data as Array<Record<string, unknown>>;
  }
  return [];
}

function normalizeDate(value: unknown, fallbackDate: string): string {
  if (typeof value !== "string") return fallbackDate;
  if (/^\d{2,3}[/-]\d{1,2}[/-]\d{1,2}$/.test(value)) return rocDateToIso(value);
  return value;
}
