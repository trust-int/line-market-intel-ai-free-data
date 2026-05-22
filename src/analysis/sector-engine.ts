import { clamp } from "../utils/math.js";
import type { SectorRanking } from "./schemas.js";

export type SectorSignal = {
  theme: string;
  breadth?: number;
  turnoverGrowth?: number;
  leaderStrength?: number;
  secondLineStrength?: number;
  institutionalBuying?: number;
  lineNewsHeat?: number;
  fundamentalSupport?: number;
  riskPenalty?: number;
  leaders?: string[];
  secondLine?: string[];
};

export class SectorEngine {
  rank(signals: SectorSignal[]): SectorRanking[] {
    return signals
      .map((signal) => {
        const score =
          pct(signal.breadth, 20) +
          pct(signal.turnoverGrowth, 15) +
          pct(signal.leaderStrength, 15) +
          pct(signal.secondLineStrength, 10) +
          pct(signal.institutionalBuying, 15) +
          pct(signal.lineNewsHeat, 10) +
          pct(signal.fundamentalSupport, 10) -
          pct(signal.riskPenalty, 5);
        return {
          theme: signal.theme,
          score: clamp(Math.round(score), 0, 100),
          phase: phaseFromScore(score, signal.riskPenalty ?? 0),
          leaders: signal.leaders ?? [],
          second_line: signal.secondLine ?? [],
          evidence: ["族群同步、量能、龍頭、法人與消息熱度綜合評分"],
          risk: signal.riskPenalty ? ["風險分數偏高，留意過熱或消息鈍化"] : []
        };
      })
      .sort((a, b) => b.score - a.score);
  }
}

function pct(value = 0, weight: number): number {
  return clamp(value, 0, 100) * (weight / 100);
}

function phaseFromScore(score: number, riskPenalty: number): SectorRanking["phase"] {
  if (riskPenalty > 70) return "過熱";
  if (score >= 75) return "主升段";
  if (score >= 55) return "剛發動";
  if (score >= 40) return "換手";
  return "轉弱";
}
