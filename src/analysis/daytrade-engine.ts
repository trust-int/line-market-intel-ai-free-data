import { clamp, roundToTick } from "../utils/math.js";
import type { DaytradePlan } from "./schemas.js";

export type DaytradeSignal = {
  ticker: string;
  name?: string;
  referencePrice: number;
  sectorTop3?: boolean;
  earlyVolumeMultiple?: number;
  aboveVwap?: boolean;
  heldVwapPullback?: boolean;
  breaksMorningHigh?: boolean;
  buyPressureRatio?: number;
  marketWeak?: boolean;
  failedHighVolumeOpen?: boolean;
  breaksOpenLow?: boolean;
  belowVwap?: boolean;
  reboundFailedVwap?: boolean;
  sellPressureRatio?: number;
  sectorLeaderWeak?: boolean;
};

export class DaytradeEngine {
  build(signals: DaytradeSignal[]): DaytradePlan[] {
    return signals.map((signal) => this.buildOne(signal));
  }

  private buildOne(signal: DaytradeSignal): DaytradePlan {
    const longScore = count(
      signal.sectorTop3,
      (signal.earlyVolumeMultiple ?? 0) >= 2,
      signal.aboveVwap,
      signal.heldVwapPullback,
      signal.breaksMorningHigh,
      (signal.buyPressureRatio ?? 0) > 1.2,
      !signal.marketWeak
    );
    const shortScore = count(
      signal.failedHighVolumeOpen,
      signal.breaksOpenLow,
      signal.belowVwap,
      signal.reboundFailedVwap,
      (signal.sellPressureRatio ?? 0) > 1.2,
      signal.sectorLeaderWeak,
      signal.marketWeak
    );
    const side: DaytradePlan["side"] = longScore >= 5 ? "做多" : shortScore >= 5 ? "做空" : "觀望";
    const price = signal.referencePrice;
    return {
      ticker: signal.ticker,
      name: signal.name ?? signal.ticker,
      side,
      setup: side === "做多" ? "族群強勢 + VWAP 站穩 + 放量突破" : side === "做空" ? "開高失敗 + 跌破 VWAP + 賣壓確認" : "訊號不足，等確認",
      entry_zone: {
        type: side === "做空" ? "跌破" : "突破",
        price_min: roundToTick(price * (side === "做空" ? 0.985 : 1.005)),
        price_max: roundToTick(price * (side === "做空" ? 0.995 : 1.015))
      },
      triggers: {
        volume_trigger: "開盤 5 分鐘成交量大於近 5 日同時段均量 2 倍",
        buy_sell_pressure_trigger: "委買委賣不可單獨使用，需搭配成交、VWAP、族群與大盤",
        vwap_trigger: side === "做空" ? "反彈不過 VWAP 或跌破 VWAP" : "站上 VWAP 且回測不破",
        sector_trigger: "族群排名前 3 或龍頭續強",
        market_trigger: "大盤與櫃買不可同步轉弱"
      },
      stop_loss: {
        price: roundToTick(price * (side === "做空" ? 1.02 : 0.98)),
        reason: "觸發價失效或 VWAP 反向站回"
      },
      take_profit: {
        price_min: roundToTick(price * (side === "做空" ? 0.96 : 1.03)),
        price_max: roundToTick(price * (side === "做空" ? 0.94 : 1.06)),
        reason: "分批停利，避免追價"
      },
      confidence_score: clamp((side === "做多" ? longScore : side === "做空" ? shortScore : Math.max(longScore, shortScore)) * 12, 20, 85),
      risks: ["當沖波動高，不自動下單", "委買委賣可能造假，需成交確認"]
    };
  }
}

function count(...values: Array<boolean | undefined>): number {
  return values.filter(Boolean).length;
}
