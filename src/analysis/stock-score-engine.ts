import { average, clamp } from "../utils/math.js";
import type { StockScore } from "./schemas.js";

export type StockSignal = {
  ticker: string;
  name?: string;
  themeScore?: number;
  priceVolumeScore?: number;
  institutionScore?: number;
  riskScore?: number;
  fundamentalScore?: number;
  newsScore?: number;
};

export class StockScoreEngine {
  score(signals: StockSignal[]): StockScore[] {
    return signals.map((signal) => {
      const riskScore = clamp(signal.riskScore ?? 50, 0, 100);
      const total = average([
        signal.themeScore ?? 50,
        signal.priceVolumeScore ?? 50,
        signal.institutionScore ?? 50,
        100 - riskScore,
        signal.fundamentalScore ?? 50,
        signal.newsScore ?? 50
      ]);
      return {
        ticker: signal.ticker,
        name: signal.name ?? signal.ticker,
        total_score: Math.round(total),
        theme_score: clamp(signal.themeScore ?? 50, 0, 100),
        price_volume_score: clamp(signal.priceVolumeScore ?? 50, 0, 100),
        institution_score: clamp(signal.institutionScore ?? 50, 0, 100),
        risk_score: riskScore,
        fundamental_score: clamp(signal.fundamentalScore ?? 50, 0, 100),
        news_score: clamp(signal.newsScore ?? 50, 0, 100),
        stage: stageFrom(total, riskScore),
        action: actionFrom(total, riskScore)
      };
    });
  }
}

function stageFrom(total: number, risk: number): StockScore["stage"] {
  if (risk > 80) return "過熱";
  if (total >= 75) return "主升段";
  if (total >= 60) return "剛發動";
  if (total >= 45) return "換手整理";
  return "轉弱";
}

function actionFrom(total: number, risk: number): StockScore["action"] {
  if (risk > 85) return "避開";
  if (total >= 75) return "續抱";
  if (total >= 65) return "可小量試單";
  if (total >= 50) return "等回測";
  return "可觀察";
}
