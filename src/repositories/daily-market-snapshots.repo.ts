import type { Queryable } from "../db/client.js";
import { db } from "../db/client.js";
import type { DailyMarketSnapshot } from "../market/daily-market-snapshot.js";

export class DailyMarketSnapshotsRepo {
  constructor(private readonly database: Queryable = db) {}

  async upsertDailyMarketSnapshot(snapshot: DailyMarketSnapshot): Promise<DailyMarketSnapshot> {
    const result = await this.database.query<DailyMarketSnapshot>(
      `insert into daily_market_snapshots (
        trade_date, taiex_close, taiex_change_pct, taiex_volume,
        otc_close, otc_change_pct, advance_count, decline_count,
        foreign_net_buy, investment_trust_net_buy, dealer_net_buy,
        margin_balance_change, short_balance_change,
        market_bias, risk_level, data_quality_score,
        data_gaps, source_status, snapshot_json
      ) values (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19
      )
      on conflict (trade_date) do update set
        taiex_close = excluded.taiex_close,
        taiex_change_pct = excluded.taiex_change_pct,
        taiex_volume = excluded.taiex_volume,
        otc_close = excluded.otc_close,
        otc_change_pct = excluded.otc_change_pct,
        advance_count = excluded.advance_count,
        decline_count = excluded.decline_count,
        foreign_net_buy = excluded.foreign_net_buy,
        investment_trust_net_buy = excluded.investment_trust_net_buy,
        dealer_net_buy = excluded.dealer_net_buy,
        margin_balance_change = excluded.margin_balance_change,
        short_balance_change = excluded.short_balance_change,
        market_bias = excluded.market_bias,
        risk_level = excluded.risk_level,
        data_quality_score = excluded.data_quality_score,
        data_gaps = excluded.data_gaps,
        source_status = excluded.source_status,
        snapshot_json = excluded.snapshot_json,
        created_at = now()
      returning *`,
      [
        snapshot.trade_date,
        snapshot.taiex_close,
        snapshot.taiex_change_pct,
        snapshot.taiex_volume,
        snapshot.otc_close,
        snapshot.otc_change_pct,
        snapshot.advance_count,
        snapshot.decline_count,
        snapshot.foreign_net_buy,
        snapshot.investment_trust_net_buy,
        snapshot.dealer_net_buy,
        snapshot.margin_balance_change,
        snapshot.short_balance_change,
        snapshot.market_bias,
        snapshot.risk_level,
        snapshot.data_quality_score,
        snapshot.data_gaps,
        snapshot.source_status,
        snapshot
      ]
    );
    return result.rows[0] ?? snapshot;
  }

  async getDailyMarketSnapshot(date: string): Promise<DailyMarketSnapshot | undefined> {
    const result = await this.database.query<DailyMarketSnapshot>(
      "select * from daily_market_snapshots where trade_date = $1 limit 1",
      [date]
    );
    return hydrateSnapshot(result.rows[0]);
  }

  async getLatestDailyMarketSnapshot(): Promise<DailyMarketSnapshot | undefined> {
    const result = await this.database.query<DailyMarketSnapshot>(
      "select * from daily_market_snapshots order by trade_date desc limit 1"
    );
    return hydrateSnapshot(result.rows[0]);
  }
}

export async function upsertDailyMarketSnapshot(snapshot: DailyMarketSnapshot): Promise<DailyMarketSnapshot> {
  return new DailyMarketSnapshotsRepo().upsertDailyMarketSnapshot(snapshot);
}

export async function getDailyMarketSnapshot(date: string): Promise<DailyMarketSnapshot | undefined> {
  return new DailyMarketSnapshotsRepo().getDailyMarketSnapshot(date);
}

export async function getLatestDailyMarketSnapshot(): Promise<DailyMarketSnapshot | undefined> {
  return new DailyMarketSnapshotsRepo().getLatestDailyMarketSnapshot();
}

function hydrateSnapshot(row?: DailyMarketSnapshot): DailyMarketSnapshot | undefined {
  if (!row) return undefined;
  return {
    ...row,
    data_gaps: row.data_gaps ?? [],
    source_status: row.source_status ?? {},
    created_at: row.created_at ?? new Date().toISOString()
  };
}
