import type { DailyMarketSnapshot } from "../market/daily-market-snapshot.js";
import type { NewsImpact } from "./schemas.js";
import type { SectorStrength } from "./sector-strength-engine.js";
import type { TickerCandidate } from "./ticker-candidate-engine.js";

export type SignalEngineInput = {
  snapshot: DailyMarketSnapshot;
  newsImpact?: NewsImpact[];
  sectorStrength?: SectorStrength[];
  tickerCandidates?: TickerCandidate[];
  dataGaps?: string[];
};

export type SignalEngineResult = {
  market_bias: "bullish" | "neutral" | "bearish";
  market_phase: "trend_up" | "pullback" | "distribution" | "panic" | "rebound";
  big_money_strategy: Array<"accumulation" | "rotation" | "distribution" | "short_squeeze" | "wait">;
  risk_flags: string[];
  sector_strength: SectorStrength[];
  ticker_candidates: TickerCandidate[];
  data_quality_score: number;
};

export class SignalEngine {
  analyze(input: SignalEngineInput): SignalEngineResult {
    const snapshot = input.snapshot;
    const riskFlags = buildRiskFlags(snapshot, input.dataGaps ?? []);
    return {
      market_bias: snapshot.market_bias,
      market_phase: classifyPhase(snapshot),
      big_money_strategy: classifyBigMoney(snapshot, riskFlags),
      risk_flags: riskFlags,
      sector_strength: (input.sectorStrength ?? [])
        .filter((sector) => sector.score >= 35 && !sector.data_gaps.includes("sector_member_market_data_missing"))
        .sort((a, b) => b.score - a.score),
      ticker_candidates: (input.tickerCandidates ?? [])
        .filter((ticker) => ticker.score >= 25 || ticker.candidate_type === "watch")
        .sort((a, b) => b.score - a.score),
      data_quality_score: snapshot.data_quality_score
    };
  }
}

function classifyPhase(snapshot: DailyMarketSnapshot): SignalEngineResult["market_phase"] {
  const taiex = snapshot.taiex_change_pct ?? 0;
  const otc = snapshot.otc_change_pct ?? 0;
  const breadthWeak = (snapshot.advance_count ?? 0) < (snapshot.decline_count ?? 0);
  if (taiex < -2 || otc < -2) return "panic";
  if (taiex > 1 && otc > 1 && !breadthWeak) return "trend_up";
  if (taiex > 0 && breadthWeak) return "distribution";
  if (taiex < 0 && otc > 0) return "rebound";
  return "pullback";
}

function classifyBigMoney(
  snapshot: DailyMarketSnapshot,
  riskFlags: string[]
): SignalEngineResult["big_money_strategy"] {
  if (snapshot.data_quality_score < 50) return ["wait"];
  const strategies: SignalEngineResult["big_money_strategy"] = [];
  if ((snapshot.foreign_net_buy ?? 0) > 0 && (snapshot.investment_trust_net_buy ?? 0) > 0) strategies.push("accumulation");
  if (snapshot.market_bias === "bullish" && (snapshot.otc_change_pct ?? 0) > (snapshot.taiex_change_pct ?? 0)) strategies.push("rotation");
  if (riskFlags.includes("index_up_breadth_weak") || riskFlags.includes("high_margin_growth")) strategies.push("distribution");
  if ((snapshot.short_balance_change ?? 0) > 0 && snapshot.market_bias === "bullish") strategies.push("short_squeeze");
  return strategies.length ? Array.from(new Set(strategies)) : ["wait"];
}

function buildRiskFlags(snapshot: DailyMarketSnapshot, dataGaps: string[]): string[] {
  const flags: string[] = [];
  if ((snapshot.margin_balance_change ?? 0) > 5_000_000) flags.push("high_margin_growth");
  if ((snapshot.taiex_change_pct ?? 0) > 0 && (snapshot.advance_count ?? 0) < (snapshot.decline_count ?? 0)) {
    flags.push("index_up_breadth_weak");
  }
  if (snapshot.risk_level === "critical") flags.push("critical_market_risk");
  if (snapshot.data_quality_score < 70 || dataGaps.length > 0) flags.push("data_quality_gap");
  return flags;
}
