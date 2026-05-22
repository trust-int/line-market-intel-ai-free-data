import { describe, expect, it } from "vitest";
import { SignalEngine } from "../src/analysis/signal-engine.js";
import { buildDailyMarketSnapshot } from "../src/market/daily-market-snapshot.js";

describe("daily snapshot and signal engine", () => {
  it("builds daily_market_snapshot and rule-based signals", () => {
    const snapshot = buildDailyMarketSnapshot({
      tradeDate: "2026-05-07",
      indexes: [
        { tradeDate: "2026-05-07", symbol: "TAIEX", close: 23500, changePct: 1.2, volume: 8000000000, source: "twse-public" },
        { tradeDate: "2026-05-07", symbol: "TPEx", close: 250, changePct: 1.5, source: "tpex-public" }
      ],
      breadth: [
        { tradeDate: "2026-05-07", market: "TWSE", advanceCount: 700, declineCount: 300, source: "twse-public" },
        { tradeDate: "2026-05-07", market: "TPEX", advanceCount: 450, declineCount: 250, source: "tpex-public" }
      ],
      institutional: [
        { tradeDate: "2026-05-07", market: "TWSE", foreignNetBuy: 2_000_000_000, investmentTrustNetBuy: 500_000_000, source: "twse-public" }
      ],
      margin: [
        { tradeDate: "2026-05-07", market: "TWSE", marginBalanceChange: 100_000, shortBalanceChange: 50_000, source: "twse-public" }
      ],
      dataGaps: []
    });
    const signals = new SignalEngine().analyze({ snapshot });
    expect(snapshot.market_bias).toBe("bullish");
    expect(signals.market_phase).toBe("trend_up");
    expect(signals.big_money_strategy).toContain("accumulation");
  });
});
