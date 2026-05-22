import { describe, expect, it } from "vitest";
import { calculateSectorStrengthFromInput } from "../src/analysis/sector-strength-engine.js";

describe("sector strength engine", () => {
  it("does not invent strong sectors when data is insufficient", () => {
    const result = calculateSectorStrengthFromInput({ topicEvents: [{ topics: ["AI"] }] });
    expect(result.sectors).toEqual([]);
    expect(result.data_gaps).toContain("sector_market_daily_missing");
  });

  it("ranks a fixture sector with synchronous gains and volume", () => {
    const result = calculateSectorStrengthFromInput({
      watchlistThemes: [
        { ticker: "2330", themes: ["AI"] },
        { ticker: "2382", themes: ["AI"] },
        { ticker: "6669", themes: ["AI"] },
        { ticker: "1301", themes: ["塑化"] }
      ],
      marketDaily: [
        { tradeDate: "2026-05-07", symbol: "2330", close: 1000, changePct: 3, amount: 30_000_000_000, source: "fixture" },
        { tradeDate: "2026-05-07", symbol: "2382", close: 300, changePct: 2.5, amount: 10_000_000_000, source: "fixture" },
        { tradeDate: "2026-05-07", symbol: "6669", close: 800, changePct: 1.5, amount: 8_000_000_000, source: "fixture" },
        { tradeDate: "2026-05-07", symbol: "1301", close: 80, changePct: -1, amount: 1_000_000_000, source: "fixture" }
      ],
      institutionalFlows: [
        { tradeDate: "2026-05-07", ticker: "2330", foreignNet: 1_000_000, investmentTrustNet: 500_000, dealerNet: 0, source: "fixture" }
      ],
      topicEvents: [{ topics: ["AI"], official: true }, { topics: ["AI"], official: false }]
    });
    expect(result.sectors[0]?.theme).toBe("AI");
    expect(result.sectors[0]?.score).toBeGreaterThan(result.sectors[1]?.score ?? 0);
  });
});
