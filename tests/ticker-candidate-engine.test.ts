import { describe, expect, it } from "vitest";
import { calculateTickerCandidatesFromInput } from "../src/analysis/ticker-candidate-engine.js";

describe("ticker candidate engine", () => {
  it("lists 2330 as watch only when there is only MOPS/LINE news", () => {
    const result = calculateTickerCandidatesFromInput({
      newsEvents: [{ tickers: ["2330"], title: "MOPS 重大訊息", source: "mops", licenseStatus: "official_public" }],
      lineMessages: [{ tickers: ["2330"], raw_text: "LINE manual news" }]
    });
    const candidate = result.candidates.find((item) => item.ticker === "2330");
    expect(candidate?.candidate_type).toBe("watch");
    expect(candidate?.data_gaps).toContain("ticker_ohlcv_missing");
    expect(JSON.stringify(candidate)).not.toContain("win_rate");
  });

  it("does not give precise daytrade price without intraday/VWAP", () => {
    const result = calculateTickerCandidatesFromInput({
      watchlist: [{ ticker: "2330", themes: ["AI"] }],
      marketDaily: [{ tradeDate: "2026-05-07", symbol: "2330", close: 1000, high: 1010, low: 990, changePct: 2, amount: 20_000_000_000, source: "fixture" }],
      institutionalFlows: [{ tradeDate: "2026-05-07", ticker: "2330", foreignNet: 1_000_000, investmentTrustNet: 500_000, dealerNet: 0, source: "fixture" }],
      sectorStrength: [{ theme: "AI", score: 80, phase: "主升段", leaders: ["2330"], second_line: [], evidence: [], risks: [], data_quality_score: 90, data_gaps: [] }]
    });
    const candidate = result.candidates[0];
    expect(candidate?.entry_zone?.price_min).toBeUndefined();
    expect(candidate?.triggers).toContain("需要盤中確認");
    expect(JSON.stringify(candidate)).not.toContain("win_rate");
  });
});
