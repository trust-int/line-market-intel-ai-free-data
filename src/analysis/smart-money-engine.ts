import type { SmartMoneyPhase } from "./schemas.js";

export type SmartMoneyInput = {
  openedHighFailedVwap?: boolean;
  heavyVolumeUpperShadow?: boolean;
  priceRecoveredSupport?: boolean;
  brokeVwap?: boolean;
  financingSurgedWithoutPriceGain?: boolean;
  sectorLeaderWeak?: boolean;
  institutionsSelling?: boolean;
  communityOverheated?: boolean;
  volumeHeldKeyPrice?: boolean;
};

export class SmartMoneyEngine {
  classify(input: SmartMoneyInput): { phase: SmartMoneyPhase; confidence_score: number; evidence: string[] } {
    const evidence: string[] = [];
    const trapLong =
      countTrue(input.openedHighFailedVwap, input.heavyVolumeUpperShadow, input.financingSurgedWithoutPriceGain, input.communityOverheated) >= 2;
    const trapShort = countTrue(input.priceRecoveredSupport, !input.sectorLeaderWeak, !input.institutionsSelling) >= 2;
    const distribution = countTrue(input.heavyVolumeUpperShadow, input.brokeVwap, input.institutionsSelling, input.financingSurgedWithoutPriceGain) >= 3;
    const rotation = countTrue(input.volumeHeldKeyPrice, !input.institutionsSelling, !input.financingSurgedWithoutPriceGain) >= 2;

    if (distribution) {
      evidence.push("高檔量價與籌碼條件偏向拉高出貨");
      return { phase: "拉高出貨", confidence_score: 72, evidence };
    }
    if (trapLong) {
      evidence.push("開高不穩、融資或社群過熱，疑似誘多");
      return { phase: "誘多", confidence_score: 68, evidence };
    }
    if (trapShort) {
      evidence.push("破位後快速收回且族群未同步轉弱，疑似誘空");
      return { phase: "誘空", confidence_score: 64, evidence };
    }
    if (rotation) {
      evidence.push("爆量但守關鍵價，籌碼未明顯倒貨，偏換手");
      return { phase: "換手", confidence_score: 60, evidence };
    }
    return { phase: "無明顯方向", confidence_score: 45, evidence: ["條件不足，維持觀察"] };
  }
}

function countTrue(...values: Array<boolean | undefined>): number {
  return values.filter(Boolean).length;
}
