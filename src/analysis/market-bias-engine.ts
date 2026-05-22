import { clamp } from "../utils/math.js";
import type { MarketBias, MarketPath } from "./schemas.js";

export type MarketBiasInput = {
  taiexTrendScore?: number;
  tpexTrendScore?: number;
  breadthScore?: number;
  volumeScore?: number;
  institutionalScore?: number;
  sectorRotationScore?: number;
  macroScore?: number;
  lineNewsScore?: number;
  evidence?: string[];
  dataGaps?: string[];
};

export class MarketBiasEngine {
  analyze(input: MarketBiasInput): MarketBias {
    const weighted =
      score(input.taiexTrendScore) * 0.2 +
      score(input.tpexTrendScore) * 0.15 +
      score(input.breadthScore) * 0.15 +
      score(input.volumeScore) * 0.1 +
      score(input.institutionalScore) * 0.15 +
      score(input.sectorRotationScore) * 0.15 +
      score(input.macroScore) * 0.05 +
      score(input.lineNewsScore) * 0.05;
    const biasScore = clamp(Math.round(weighted), -100, 100);
    return {
      bias: labelBias(biasScore),
      bias_score: biasScore,
      likely_paths: buildPaths(biasScore),
      evidence: input.evidence ?? ["資料不足時採保守中性評估"],
      invalidation: ["大盤與櫃買同步跌破關鍵支撐", "成交量失衡且法人籌碼轉弱"],
      data_quality: (input.dataGaps?.length ?? 0) > 3 ? "low" : (input.dataGaps?.length ?? 0) > 0 ? "medium" : "high"
    };
  }
}

function score(value?: number): number {
  return clamp(value ?? 0, -100, 100);
}

function labelBias(scoreValue: number): MarketBias["bias"] {
  if (scoreValue >= 45) return "多頭";
  if (scoreValue >= 15) return "震盪偏多";
  if (scoreValue <= -45) return "空頭";
  if (scoreValue <= -15) return "震盪偏空";
  return "中性";
}

function buildPaths(scoreValue: number): MarketPath[] {
  if (scoreValue > 20) {
    return [
      { scenario: "開低走高", confidence_score: 62, confirmation: ["回測 VWAP 不破", "族群龍頭續強"], rejection: ["櫃買轉弱", "量縮跌破支撐"] },
      { scenario: "區間震盪", confidence_score: 45, confirmation: ["量能不足", "法人買賣超分歧"], rejection: ["突破昨日高點且放量"] }
    ];
  }
  if (scoreValue < -20) {
    return [
      { scenario: "開高走低", confidence_score: 62, confirmation: ["開高不過前高", "跌破 VWAP"], rejection: ["櫃買與電子權值同步轉強"] },
      { scenario: "先殺後拉", confidence_score: 42, confirmation: ["下殺量縮", "支撐快速收回"], rejection: ["尾盤續破低"] }
    ];
  }
  return [
    { scenario: "區間震盪", confidence_score: 58, confirmation: ["量能普通", "族群輪動快速"], rejection: ["帶量突破區間"] }
  ];
}
