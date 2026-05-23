import type { Queryable } from "../db/client.js";
import { db } from "../db/client.js";

export type MarketReportRecord = {
  report_date: string;
  report_type: string;
  ai_mode?: string | null;
  data_quality_score?: number | null;
  data_gaps?: unknown;
  sample_size?: number | null;
  backtest_available?: boolean | null;
  confidence_score?: number | null;
  market_bias?: string | null;
  market_phase?: string | null;
  big_money_strategy?: string | null;
  risk_flags?: unknown;
  summary?: string | null;
  raw_payload?: unknown;
};

export class MarketReportsRepo {
  constructor(private readonly database: Queryable = db) {}

  async upsertMarketReport(record: MarketReportRecord): Promise<MarketReportRecord> {
    const result = await this.database.query<MarketReportRecord>(
      `insert into market_reports (
         report_date, report_type, ai_mode, data_quality_score, data_gaps,
         sample_size, backtest_available, confidence_score, market_bias,
         market_phase, big_money_strategy, risk_flags, summary, raw_payload
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       on conflict (report_date, report_type) do update set
         ai_mode = excluded.ai_mode,
         data_quality_score = excluded.data_quality_score,
         data_gaps = excluded.data_gaps,
         sample_size = excluded.sample_size,
         backtest_available = excluded.backtest_available,
         confidence_score = excluded.confidence_score,
         market_bias = excluded.market_bias,
         market_phase = excluded.market_phase,
         big_money_strategy = excluded.big_money_strategy,
         risk_flags = excluded.risk_flags,
         summary = excluded.summary,
         raw_payload = excluded.raw_payload,
         updated_at = now()
       returning report_date, report_type, ai_mode, data_quality_score,
                 data_gaps, sample_size, backtest_available, confidence_score,
                 market_bias, market_phase, big_money_strategy, risk_flags,
                 summary, raw_payload`,
      [
        record.report_date,
        record.report_type,
        record.ai_mode ?? "manual",
        record.data_quality_score ?? 0,
        record.data_gaps ?? [],
        record.sample_size ?? 0,
        record.backtest_available ?? false,
        record.confidence_score ?? 0,
        record.market_bias ?? null,
        record.market_phase ?? null,
        record.big_money_strategy ?? null,
        record.risk_flags ?? [],
        record.summary ?? null,
        record.raw_payload ?? {}
      ]
    );
    return result.rows[0] ?? record;
  }
}
