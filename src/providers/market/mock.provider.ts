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

export class MockMarketProvider implements MarketDataProvider {
  name = "mock-market";
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
    note: "Test-only provider."
  };

  constructor(private readonly rows: StockDaily[] = []) {}

  async getIndexDaily(date: string): Promise<IndexDaily[]> {
    return [{ tradeDate: date, symbol: "TAIEX", close: 0, source: this.name }];
  }

  async getStockDaily(date: string, tickers: string[]): Promise<StockDaily[]> {
    const set = new Set(tickers);
    return this.rows.filter((row) => row.tradeDate === date && (set.size === 0 || set.has(row.symbol)));
  }

  async getIndexIntraday(_date: string): Promise<IndexIntraday[]> { return []; }
  async getStockIntraday(_date: string, _tickers: string[]): Promise<StockIntraday[]> { return []; }
  async getSectorDaily(_date: string): Promise<SectorDaily[]> { return []; }
  async getInstitutionalFlows(_date: string, _tickers: string[]): Promise<InstitutionalFlow[]> { return []; }
  async getMarginShort(_date: string, _tickers: string[]): Promise<MarginShort[]> { return []; }
  async getDayTradeStats(_date: string, _tickers: string[]): Promise<DayTradeStats[]> { return []; }
  async getBrokerBranchFlows(_date: string, _tickers: string[]): Promise<BrokerBranchFlow[]> { return []; }
}
