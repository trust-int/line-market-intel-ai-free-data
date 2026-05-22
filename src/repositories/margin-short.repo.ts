import type { Queryable } from "../db/client.js";
import { db } from "../db/client.js";
import type { MarginShort } from "../providers/market/provider.js";

export class MarginShortRepo {
  constructor(private readonly database: Queryable = db) {}

  async upsertMarginShort(rows: MarginShort[]): Promise<number> {
    let count = 0;
    for (const row of rows) {
      await this.database.query(
        `insert into margin_short (
          trade_date, ticker, margin_balance, margin_change,
          short_balance, short_change, daytrade_ratio, source
        ) values ($1,$2,$3,$4,$5,$6,$7,$8)
        on conflict (trade_date, ticker, source) do update set
          margin_balance = excluded.margin_balance,
          margin_change = excluded.margin_change,
          short_balance = excluded.short_balance,
          short_change = excluded.short_change,
          daytrade_ratio = excluded.daytrade_ratio`,
        [
          row.tradeDate,
          row.ticker,
          row.marginBalance,
          row.marginChange,
          row.shortBalance,
          row.shortChange,
          row.daytradeRatio,
          row.source
        ]
      );
      count += 1;
    }
    return count;
  }
}
