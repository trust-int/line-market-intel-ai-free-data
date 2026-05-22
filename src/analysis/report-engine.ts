import { config } from "../config.js";
import type { CostGuardUsage } from "../cost/cost-guard.js";
import { todayTaipei } from "../utils/date.js";
import { BacktestEngine } from "./backtest-engine.js";
import type { HoldingDecision, NewsImpact, SectorRanking, StockScore, StrategyReport } from "./schemas.js";
import { strategyReportSchema } from "./schemas.js";
import { MarketBiasEngine, type MarketBiasInput } from "./market-bias-engine.js";
import { SmartMoneyEngine, type SmartMoneyInput } from "./smart-money-engine.js";
import type { SignalEngineResult } from "./signal-engine.js";

export type BuildReportInput = {
  date?: string;
  reportType: StrategyReport["report_type"];
  marketBias?: MarketBiasInput;
  smartMoney?: SmartMoneyInput;
  newsImpact?: NewsImpact[];
  sectors?: SectorRanking[];
  holdings?: HoldingDecision[];
  daytradeCandidates?: StrategyReport["daytrade_candidates"];
  swingCandidates?: StockScore[];
  avoidList?: StrategyReport["avoid_list"];
  riskAlerts?: StrategyReport["risk_alerts"];
  dataGaps?: string[];
  costUsage?: CostGuardUsage;
  signalEngineResult?: SignalEngineResult;
};

export class ReportEngine {
  private readonly marketBiasEngine = new MarketBiasEngine();
  private readonly smartMoneyEngine = new SmartMoneyEngine();
  private readonly backtestEngine = new BacktestEngine();

  build(input: BuildReportInput): StrategyReport {
    const marketBias = input.signalEngineResult
      ? marketBiasFromSignal(input.signalEngineResult)
      : this.marketBiasEngine.analyze({ ...input.marketBias, dataGaps: input.dataGaps });
    const smartMoney = input.signalEngineResult
      ? smartMoneyFromSignal(input.signalEngineResult)
      : this.smartMoneyEngine.classify(input.smartMoney ?? {});
    const usage = input.costUsage ?? {
      date: input.date ?? todayTaipei(),
      openaiRequests: 0,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0
    };
    const report = strategyReportSchema.parse({
      date: input.date ?? todayTaipei(),
      report_type: input.reportType,
      market: {
        bias: marketBias.bias,
        bias_score: marketBias.bias_score,
        likely_paths: marketBias.likely_paths,
        smart_money_phase: smartMoney.phase,
        smart_money_confidence: smartMoney.confidence_score,
        evidence: [...marketBias.evidence, ...smartMoney.evidence],
        data_quality: marketBias.data_quality
      },
      news_impact: input.newsImpact ?? [],
      sectors: input.sectors ?? [],
      holdings: input.holdings ?? [],
      daytrade_candidates: input.daytradeCandidates ?? [],
      swing_candidates: input.swingCandidates ?? [],
      avoid_list: input.avoidList ?? [],
      risk_alerts: input.riskAlerts ?? [],
      data_gaps: input.dataGaps ?? [],
      cost_guard: {
        ai_mode: config.aiMode,
        openai_requests_today: usage.openaiRequests,
        estimated_cost_today: usage.estimatedCostUsd,
        paid_data_api_used: false
      },
      disclaimer: "本報告僅供個人研究，不自動下單，沒有回測前不顯示勝率。"
    });
    return this.backtestEngine.sanitizeReport(report);
  }
}

function marketBiasFromSignal(signal: SignalEngineResult) {
  const bias = signal.market_bias === "bullish" ? "震盪偏多" : signal.market_bias === "bearish" ? "震盪偏空" : "中性";
  const biasScore = signal.market_bias === "bullish" ? 25 : signal.market_bias === "bearish" ? -25 : 0;
  return {
    bias,
    bias_score: biasScore,
    likely_paths: [{
      scenario: signal.market_phase === "rebound" ? "先殺後拉" : signal.market_phase === "panic" ? "開低走低" : "區間震盪",
      confidence_score: Math.max(30, Math.min(80, signal.data_quality_score)),
      confirmation: ["依 signal-engine market_phase 確認", `market_phase=${signal.market_phase}`],
      rejection: ["資料品質下降", "官方資料與盤中量價不一致"]
    }],
    evidence: [`signal-engine market_bias=${signal.market_bias}`, `market_phase=${signal.market_phase}`],
    invalidation: ["signal-engine 風險旗標升高"],
    data_quality: signal.data_quality_score >= 80 ? "high" : signal.data_quality_score >= 55 ? "medium" : "low"
  } as const;
}

function smartMoneyFromSignal(signal: SignalEngineResult) {
  if (signal.big_money_strategy.length === 1 && signal.big_money_strategy[0] === "wait") {
    return {
      phase: "無明顯方向" as const,
      confidence_score: Math.max(30, Math.min(65, signal.data_quality_score)),
      evidence: ["signal-engine big_money_strategy=wait；不得自行臆測誘多、誘空、吃貨或出貨"]
    };
  }
  const phase = signal.big_money_strategy.includes("distribution")
    ? "拉高出貨"
    : signal.big_money_strategy.includes("accumulation")
      ? "吃貨"
      : signal.big_money_strategy.includes("rotation")
        ? "換手"
        : "無明顯方向";
  return {
    phase: phase as "吃貨" | "換手" | "拉高出貨" | "無明顯方向",
    confidence_score: Math.max(30, Math.min(80, signal.data_quality_score)),
    evidence: [`signal-engine big_money_strategy=${signal.big_money_strategy.join(",")}`]
  };
}
