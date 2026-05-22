import { config } from "../../config.js";
import { enforceProviderPolicy, type ProviderPolicy } from "../../cost/provider-policy.js";
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

export class MopsPublicProvider implements MarketDataProvider {
  name = "mops-public";
  policy: ProviderPolicy = {
    name: this.name,
    category: "market",
    enabled: config.enableMopsPublic,
    paid: false,
    requiresLogin: false,
    requiresPermission: false,
    termsChecked: true,
    licenseStatus: "official_public",
    allowedWhenNoPaidApi: true,
    mode: config.enableMopsPublic ? "automatic" : "disabled",
    note: "MOPS public material events, revenue, filings and public announcements."
  };

  async getStockDaily(_date: string, _tickers: string[]): Promise<StockDaily[]> {
    if (enforceProviderPolicy(this.policy).status === "disabled") return [];
    return [];
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
