import type { Queryable } from "../db/client.js";
import { db } from "../db/client.js";

export type StrategyReportRecord = {
  report_date: string;
  report_type: string;
  market_bias?: string;
  market_bias_score?: number;
  smart_money_phase?: string;
  summary_md: string;
  report_json: unknown;
};

export class StrategyReportsRepo {
  constructor(private readonly database: Queryable = db) {}

  async upsertStrategyReport(record: StrategyReportRecord): Promise<StrategyReportRecord> {
    const result = await this.database.query<StrategyReportRecord>(
      `insert into strategy_reports (
        report_date, report_type, market_bias, market_bias_score,
        smart_money_phase, summary_md, report_json
      ) values ($1,$2,$3,$4,$5,$6,$7)
      on conflict (report_date, report_type) do update set
        market_bias = excluded.market_bias,
        market_bias_score = excluded.market_bias_score,
        smart_money_phase = excluded.smart_money_phase,
        summary_md = excluded.summary_md,
        report_json = excluded.report_json,
        created_at = now()
      returning report_date, report_type, market_bias, market_bias_score, smart_money_phase, summary_md, report_json`,
      [
        record.report_date,
        record.report_type,
        record.market_bias,
        record.market_bias_score,
        record.smart_money_phase,
        record.summary_md,
        record.report_json
      ]
    );
    return result.rows[0] ?? record;
  }

  async getStrategyReport(date: string, reportType = "postmarket"): Promise<StrategyReportRecord | undefined> {
    const result = await this.database.query<StrategyReportRecord>(
      `select report_date, report_type, market_bias, market_bias_score,
              smart_money_phase, summary_md, report_json
       from strategy_reports
       where report_date = $1 and report_type = $2
       limit 1`,
      [date, reportType]
    );
    return result.rows[0];
  }
}
