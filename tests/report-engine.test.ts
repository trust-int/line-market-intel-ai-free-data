import { describe, expect, it } from "vitest";
import { ReportEngine } from "../src/analysis/report-engine.js";

describe("report engine signal rules", () => {
  it("does not invent smart-money phases, sectors, or candidates when signal engine says wait", () => {
    const report = new ReportEngine().build({
      reportType: "postmarket",
      signalEngineResult: {
        market_bias: "neutral",
        market_phase: "pullback",
        big_money_strategy: ["wait"],
        risk_flags: [],
        sector_strength: [],
        ticker_candidates: [],
        data_quality_score: 75
      }
    });
    expect(report.market.bias).toBe("中性");
    expect(report.market.smart_money_phase).toBe("無明顯方向");
    expect(report.market.evidence.join(" ")).toContain("big_money_strategy=wait");
    expect(report.sectors).toEqual([]);
    expect(report.daytrade_candidates).toEqual([]);
    expect(report.swing_candidates).toEqual([]);
    expect(JSON.stringify(report)).not.toContain("win_rate");
  });
});
