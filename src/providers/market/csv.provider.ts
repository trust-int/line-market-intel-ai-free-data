import { type ProviderPolicy } from "../../cost/provider-policy.js";
import type {
  BrokerBranchFlow,
  DayTradeStats,
  IndexDaily,
  IndexIntraday,
  InstitutionalFlow,
  MarginShort,
  MarketDataProvider,
  SectorDaily,
  StockDaily,
  StockIntraday
} from "./provider.js";

export class CsvMarketProvider implements MarketDataProvider {
  name = "csv-user-upload";
  policy: ProviderPolicy = {
    name: this.name,
    category: "market",
    enabled: true,
    paid: false,
    requiresLogin: false,
    requiresPermission: false,
    termsChecked: true,
    licenseStatus: "user_provided",
    allowedWhenNoPaidApi: true,
    mode: "manual",
    note: "User-owned CSV or Excel exports only."
  };

  constructor(private readonly stockDailyRows: StockDaily[] = []) {}

  async getStockDaily(date: string, tickers: string[]): Promise<StockDaily[]> {
    const tickerSet = new Set(tickers);
    return this.stockDailyRows.filter((row) => row.tradeDate === date && (tickerSet.size === 0 || tickerSet.has(row.symbol)));
  }

  async getIndexDaily(_date: string): Promise<IndexDaily[]> { return []; }
  async getIndexIntraday(_date: string): Promise<IndexIntraday[]> { return []; }
  async getStockIntraday(_date: string, _tickers: string[]): Promise<StockIntraday[]> { return []; }
  async getSectorDaily(_date: string): Promise<SectorDaily[]> { return []; }
  async getInstitutionalFlows(_date: string, _tickers: string[]): Promise<InstitutionalFlow[]> { return []; }
  async getMarginShort(_date: string, _tickers: string[]): Promise<MarginShort[]> { return []; }
  async getDayTradeStats(_date: string, _tickers: string[]): Promise<DayTradeStats[]> { return []; }
  async getBrokerBranchFlows(_date: string, _tickers: string[]): Promise<BrokerBranchFlow[]> { return []; }
}
