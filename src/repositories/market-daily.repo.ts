import type { Queryable } from "../db/client.js";
import { db } from "../db/client.js";
import type { IndexDaily, StockDaily } from "../providers/market/provider.js";

export type MarketDailyUpsertRow = (IndexDaily | StockDaily) & {
  symbolType: "index" | "listed_stock" | "otc_stock" | "stock";
};

export class MarketDailyRepo {
  constructor(private readonly database: Queryable = db) {}

  async upsertMarketDaily(rows: MarketDailyUpsertRow[]): Promise<number> {
    let count = 0;
    for (const row of rows) {
      await this.database.query(
        `insert into market_daily (
          trade_date, symbol, symbol_type, open, high, low, close, change_pct,
          volume, amount, turnover, source
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        on conflict (trade_date, symbol, source) do update set
          symbol_type = excluded.symbol_type,
          open = excluded.open,
          high = excluded.high,
          low = excluded.low,
          close = excluded.close,
          change_pct = excluded.change_pct,
          volume = excluded.volume,
          amount = excluded.amount,
          turnover = excluded.turnover`,
        [
          row.tradeDate,
          row.symbol,
          row.symbolType,
          row.open,
          row.high,
          row.low,
          row.close,
          row.changePct,
          row.volume,
          row.amount,
          "turnover" in row ? row.turnover : undefined,
          row.source
        ]
      );
      count += 1;
    }
    return count;
  }
}
