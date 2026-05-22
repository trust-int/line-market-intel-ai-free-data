import type { DaytradePlan, StrategyReport } from "./schemas.js";

export type SetupRule = {
  name: string;
  side: "long" | "short";
  conditions: string[];
  entry: string;
  stop: string;
  exit: string;
};

export type BacktestResult = {
  setup_name: string;
  lookback_days: number;
  sample_size: number;
  win_rate?: number;
  avg_return?: number;
  max_drawdown?: number;
  notes: string;
};

export class BacktestEngine {
  sanitizeDaytradePlan(plan: DaytradePlan, result?: BacktestResult): DaytradePlan {
    if (!result || result.sample_size < 30 || typeof result.win_rate !== "number") {
      const { historical_hit_rate: _drop, ...rest } = plan;
      return rest;
    }
    return {
      ...plan,
      historical_hit_rate: result.win_rate
    };
  }

  sanitizeReport(report: StrategyReport, results: BacktestResult[] = []): StrategyReport {
    const bySetup = new Map(results.map((result) => [result.setup_name, result]));
    return {
      ...report,
      daytrade_candidates: report.daytrade_candidates.map((plan) => this.sanitizeDaytradePlan(plan, bySetup.get(plan.setup)))
    };
  }
}
