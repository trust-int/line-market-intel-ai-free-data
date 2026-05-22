import { describe, expect, it } from "vitest";
import { DaytradeEngine } from "../src/analysis/daytrade-engine.js";
import { MarketBiasEngine } from "../src/analysis/market-bias-engine.js";
import { ReportEngine } from "../src/analysis/report-engine.js";
import { SmartMoneyEngine } from "../src/analysis/smart-money-engine.js";
import { strategyReportSchema } from "../src/analysis/schemas.js";

describe("analysis and reports", () => {
  it("scores market bias", () => {
    const result = new MarketBiasEngine().analyze({ taiexTrendScore: 80, tpexTrendScore: 60, breadthScore: 50 });
    expect(result.bias_score).toBeGreaterThan(0);
    expect(result.likely_paths.length).toBeGreaterThan(0);
  });

  it("classifies smart money phase", () => {
    const result = new SmartMoneyEngine().classify({
      openedHighFailedVwap: true,
      heavyVolumeUpperShadow: true,
      financingSurgedWithoutPriceGain: true
    });
    expect(result.phase).toBe("誘多");
  });

  it("builds daytrade trigger plan without hit rate by default", () => {
    const [plan] = new DaytradeEngine().build([
      {
        ticker: "2330",
        referencePrice: 1000,
        sectorTop3: true,
        earlyVolumeMultiple: 2.5,
        aboveVwap: true,
        heldVwapPullback: true,
        breaksMorningHigh: true
      }
    ]);
    expect(plan?.confidence_score).toBeGreaterThan(0);
    expect(plan).not.toHaveProperty("historical_hit_rate");
  });

  it("validates report schema and suppresses historical hit rate without backtest", () => {
    const report = new ReportEngine().build({
      reportType: "postmarket",
      daytradeCandidates: new DaytradeEngine().build([{ ticker: "2330", referencePrice: 1000 }])
    });
    expect(strategyReportSchema.parse(report)).toBeTruthy();
    expect(report.cost_guard.paid_data_api_used).toBe(false);
    expect(report.daytrade_candidates[0]).not.toHaveProperty("historical_hit_rate");
  });
});
