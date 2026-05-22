import net from "node:net";
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

export type FutuSelfCheck =
  | { status: "enabled" }
  | { status: "disabled"; reason: "permission_or_paid_data_required" | "opend_unreachable" | "provider_disabled" };

export class FutuMarketProvider implements MarketDataProvider {
  name = "futu-market";
  policy: ProviderPolicy = {
    name: this.name,
    category: "market",
    enabled: config.enableFutu && config.futuPermissionConfirmed,
    paid: false,
    requiresLogin: true,
    requiresPermission: true,
    termsChecked: true,
    licenseStatus: "licensed",
    allowedWhenNoPaidApi: true,
    userAuthorized: config.enableFutu,
    permissionConfirmed: config.futuPermissionConfirmed,
    mode: config.enableFutu && config.futuPermissionConfirmed ? "automatic" : "disabled",
    note: "Quote-only skeleton. No trading, no order placement, no quote-card purchase."
  };

  async selfCheck(): Promise<FutuSelfCheck> {
    const policy = enforceProviderPolicy(this.policy);
    if (policy.status === "disabled") return { status: "disabled", reason: "permission_or_paid_data_required" };
    const reachable = await isPortReachable(config.futuOpendHost, config.futuOpendPort);
    if (!reachable) return { status: "disabled", reason: "opend_unreachable" };
    return { status: "enabled" };
  }

  async getIndexDaily(_date: string): Promise<IndexDaily[]> { return this.guard<IndexDaily>(); }
  async getIndexIntraday(_date: string): Promise<IndexIntraday[]> { return this.guard<IndexIntraday>(); }
  async getStockDaily(_date: string, _tickers: string[]): Promise<StockDaily[]> { return this.guard<StockDaily>(); }
  async getStockIntraday(_date: string, _tickers: string[]): Promise<StockIntraday[]> { return this.guard<StockIntraday>(); }
  async getSectorDaily(_date: string): Promise<SectorDaily[]> { return this.guard<SectorDaily>(); }
  async getInstitutionalFlows(_date: string, _tickers: string[]): Promise<InstitutionalFlow[]> { return this.guard<InstitutionalFlow>(); }
  async getMarginShort(_date: string, _tickers: string[]): Promise<MarginShort[]> { return this.guard<MarginShort>(); }
  async getDayTradeStats(_date: string, _tickers: string[]): Promise<DayTradeStats[]> { return this.guard<DayTradeStats>(); }
  async getBrokerBranchFlows(_date: string, _tickers: string[]): Promise<BrokerBranchFlow[]> { return this.guard<BrokerBranchFlow>(); }

  private async guard<T>(): Promise<T[]> {
    const check = await this.selfCheck();
    if (check.status === "disabled") return [];
    return [];
  }
}

function isPortReachable(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port, timeout: 500 });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(false));
  });
}
