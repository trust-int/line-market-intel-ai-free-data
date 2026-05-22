import { z } from "zod";

export const marketPathSchema = z.object({
  scenario: z.enum(["開高走高", "開高走低", "開低走高", "開低走低", "區間震盪", "先殺後拉", "先拉後殺"]),
  confidence_score: z.number().min(0).max(100),
  confirmation: z.array(z.string()),
  rejection: z.array(z.string())
});

export const smartMoneyPhaseSchema = z.enum(["吃貨", "換手", "洗盤", "誘多", "誘空", "拉高出貨", "軋空", "無明顯方向"]);

export const marketBiasSchema = z.object({
  bias: z.enum(["多頭", "空頭", "震盪偏多", "震盪偏空", "中性"]),
  bias_score: z.number().min(-100).max(100),
  likely_paths: z.array(marketPathSchema),
  evidence: z.array(z.string()),
  invalidation: z.array(z.string()),
  data_quality: z.enum(["high", "medium", "low"])
});

export const sectorRankingSchema = z.object({
  theme: z.string(),
  score: z.number().min(0).max(100),
  phase: z.enum(["剛發動", "主升段", "換手", "過熱", "轉弱"]),
  leaders: z.array(z.string()),
  second_line: z.array(z.string()),
  evidence: z.array(z.string()),
  risk: z.array(z.string())
});

export const stockScoreSchema = z.object({
  ticker: z.string(),
  name: z.string(),
  total_score: z.number().min(0).max(100),
  theme_score: z.number().min(0).max(100),
  price_volume_score: z.number().min(0).max(100),
  institution_score: z.number().min(0).max(100),
  risk_score: z.number().min(0).max(100),
  fundamental_score: z.number().min(0).max(100),
  news_score: z.number().min(0).max(100),
  stage: z.enum(["未發動", "剛發動", "主升段", "換手整理", "過熱", "轉弱"]),
  action: z.enum(["可觀察", "等回測", "可小量試單", "續抱", "減碼", "避開"])
});

export const daytradePlanSchema = z.object({
  ticker: z.string(),
  name: z.string(),
  side: z.enum(["做多", "做空", "觀望"]),
  setup: z.string(),
  entry_zone: z.object({
    type: z.enum(["突破", "回測", "跌破", "反彈不過"]),
    price_min: z.number(),
    price_max: z.number()
  }),
  triggers: z.object({
    volume_trigger: z.string(),
    buy_sell_pressure_trigger: z.string(),
    vwap_trigger: z.string(),
    sector_trigger: z.string(),
    market_trigger: z.string()
  }),
  stop_loss: z.object({
    price: z.number(),
    reason: z.string()
  }),
  take_profit: z.object({
    price_min: z.number(),
    price_max: z.number(),
    reason: z.string()
  }),
  confidence_score: z.number().min(0).max(100),
  historical_hit_rate: z.number().min(0).max(1).optional(),
  risks: z.array(z.string())
});

export const holdingDecisionSchema = z.object({
  ticker: z.string(),
  name: z.string(),
  current_price: z.number(),
  avg_cost: z.number(),
  unrealized_pnl_pct: z.number(),
  decision: z.enum(["續抱", "加碼觀察", "減碼", "停損", "換股"]),
  key_supports: z.array(z.number()),
  key_resistances: z.array(z.number()),
  stop_loss: z.number(),
  take_profit_zone: z.tuple([z.number(), z.number()]),
  reason: z.array(z.string()),
  invalidation: z.array(z.string())
});

export const newsImpactSchema = z.object({
  event_id: z.string(),
  title: z.string(),
  source: z.string(),
  impact_level: z.enum(["low", "medium", "high", "critical"]),
  market_direction: z.enum(["偏多", "偏空", "中性", "不確定"]),
  affected_themes: z.array(z.string()),
  affected_tickers: z.array(z.string()),
  reason: z.string(),
  confidence_score: z.number().min(0).max(100)
});

export const strategyReportSchema = z.object({
  date: z.string(),
  report_type: z.enum(["premarket", "intraday", "postmarket", "weekly"]),
  market: z.object({
    bias: marketBiasSchema.shape.bias,
    bias_score: z.number(),
    likely_paths: z.array(marketPathSchema),
    smart_money_phase: smartMoneyPhaseSchema,
    smart_money_confidence: z.number().min(0).max(100),
    evidence: z.array(z.string()),
    data_quality: z.enum(["high", "medium", "low"])
  }),
  news_impact: z.array(newsImpactSchema),
  sectors: z.array(sectorRankingSchema),
  holdings: z.array(holdingDecisionSchema),
  daytrade_candidates: z.array(daytradePlanSchema),
  swing_candidates: z.array(stockScoreSchema),
  avoid_list: z.array(z.object({ ticker: z.string(), reason: z.string() })),
  risk_alerts: z.array(z.object({
    level: z.enum(["low", "medium", "high", "critical"]),
    ticker: z.string().optional(),
    message: z.string()
  })),
  data_gaps: z.array(z.string()),
  cost_guard: z.object({
    ai_mode: z.string(),
    openai_requests_today: z.number(),
    estimated_cost_today: z.number(),
    paid_data_api_used: z.literal(false)
  }),
  disclaimer: z.string()
});

export type MarketPath = z.infer<typeof marketPathSchema>;
export type MarketBias = z.infer<typeof marketBiasSchema>;
export type SmartMoneyPhase = z.infer<typeof smartMoneyPhaseSchema>;
export type SectorRanking = z.infer<typeof sectorRankingSchema>;
export type StockScore = z.infer<typeof stockScoreSchema>;
export type DaytradePlan = z.infer<typeof daytradePlanSchema>;
export type HoldingDecision = z.infer<typeof holdingDecisionSchema>;
export type NewsImpact = z.infer<typeof newsImpactSchema>;
export type StrategyReport = z.infer<typeof strategyReportSchema>;
