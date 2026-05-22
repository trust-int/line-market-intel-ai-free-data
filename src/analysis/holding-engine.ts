import { roundToTick } from "../utils/math.js";
import type { HoldingDecision } from "./schemas.js";

export type HoldingInput = {
  ticker: string;
  name?: string;
  currentPrice: number;
  avgCost: number;
  stopLoss?: number;
  takeProfit?: number;
  thesis?: string;
};

export class HoldingEngine {
  decide(inputs: HoldingInput[]): HoldingDecision[] {
    return inputs.map((input) => {
      const pnl = ((input.currentPrice - input.avgCost) / input.avgCost) * 100;
      const stopLoss = input.stopLoss ?? roundToTick(input.avgCost * 0.92);
      const takeProfit = input.takeProfit ?? roundToTick(input.avgCost * 1.18);
      return {
        ticker: input.ticker,
        name: input.name ?? input.ticker,
        current_price: input.currentPrice,
        avg_cost: input.avgCost,
        unrealized_pnl_pct: Number(pnl.toFixed(2)),
        decision: pnl <= -8 ? "停損" : pnl >= 18 ? "減碼" : "續抱",
        key_supports: [stopLoss, roundToTick(input.currentPrice * 0.97)],
        key_resistances: [takeProfit, roundToTick(input.currentPrice * 1.06)],
        stop_loss: stopLoss,
        take_profit_zone: [roundToTick(takeProfit * 0.96), takeProfit],
        reason: [input.thesis ?? "依持股成本、停損與目前價格做保守續抱判斷"],
        invalidation: ["跌破停損且無法快速收回", "族群與大盤同步轉弱"]
      };
    });
  }
}
