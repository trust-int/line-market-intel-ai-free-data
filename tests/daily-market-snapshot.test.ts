import { describe, expect, it } from "vitest";
import { buildDailyMarketSnapshotJob } from "../src/jobs/build-daily-market-snapshot.js";
import type { Queryable } from "../src/db/client.js";
import { DailyMarketSnapshotsRepo } from "../src/repositories/daily-market-snapshots.repo.js";
import type { DailyMarketSnapshot } from "../src/market/daily-market-snapshot.js";

class SnapshotFakeDb implements Queryable {
  snapshots = new Map<string, DailyMarketSnapshot>();
  upserts = 0;

  async query<T = unknown>(sql: string, params?: unknown[]) {
    if (sql.includes("from market_daily")) {
      return { rows: [
        { trade_date: "2026-05-07", symbol: "TAIEX", symbol_type: "index", close: 23500, change_pct: 0.5, volume: 1000, source: "fixture" },
        { trade_date: "2026-05-07", symbol: "TPEx", symbol_type: "index", close: 250, change_pct: -0.2, volume: 800, source: "fixture" },
        { trade_date: "2026-05-07", symbol: "2330", symbol_type: "stock", close: 1000, change_pct: 1.2, volume: 100, source: "fixture" },
        { trade_date: "2026-05-07", symbol: "2317", symbol_type: "stock", close: 200, change_pct: -0.5, volume: 80, source: "fixture" }
      ] as T[], rowCount: 4 };
    }
    if (sql.includes("from institutional_flows")) {
      return { rows: [{ ticker: "2330", foreignNet: 100, investmentTrustNet: 50, dealerNet: -10, totalNet: 140, source: "fixture" }] as T[], rowCount: 1 };
    }
    if (sql.includes("from margin_short")) {
      return { rows: [{ ticker: "2330", marginChange: 10, shortChange: -2, marginBalance: 1000, shortBalance: 100, source: "fixture" }] as T[], rowCount: 1 };
    }
    if (sql.includes("from news_events")) {
      return { rows: [{ count: "1" }] as T[], rowCount: 1 };
    }
    if (sql.includes("insert into daily_market_snapshots")) {
      this.upserts += 1;
      const snapshot = params?.[18] as DailyMarketSnapshot;
      this.snapshots.set(String(params?.[0]), snapshot);
      return { rows: [snapshot] as T[], rowCount: 1 };
    }
    if (sql.includes("select * from daily_market_snapshots where")) {
      return { rows: [this.snapshots.get(String(params?.[0]))].filter(Boolean) as T[], rowCount: 1 };
    }
    return { rows: [] as T[], rowCount: 0 };
  }
}

describe("daily_market_snapshots", () => {
  it("builds a 2026-05-07 fixture snapshot and upserts without duplicate semantics", async () => {
    const database = new SnapshotFakeDb();
    const repo = new DailyMarketSnapshotsRepo(database);
    const first = await buildDailyMarketSnapshotJob("2026-05-07", { database, repo });
    const second = await buildDailyMarketSnapshotJob("2026-05-07", { database, repo });
    expect(first.trade_date).toBe("2026-05-07");
    expect(second.trade_date).toBe("2026-05-07");
    expect(database.snapshots.size).toBe(1);
    expect(database.upserts).toBe(2);
    expect(second.data_quality_score).toBeGreaterThan(70);
  });
});
