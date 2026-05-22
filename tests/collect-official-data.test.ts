import { describe, expect, it } from "vitest";
import type { Queryable } from "../src/db/client.js";
import { collectOfficialDataJob } from "../src/jobs/collect-official-data.js";
import type { LiveFetchCheckResult } from "../src/providers/health/live-fetch-check.js";

class FakeDb implements Queryable {
  queries: Array<{ sql: string; params?: unknown[] }> = [];
  async query<T = unknown>(sql: string, params?: unknown[]) {
    this.queries.push({ sql, params });
    return { rows: [] as T[], rowCount: 1 };
  }
}

const failedLiveResults: LiveFetchCheckResult[] = [
  { provider: "TWSE", status: "network_error", url: "https://twse.example", checked_at: "2026-05-07T00:00:00Z" },
  { provider: "TPEx", status: "network_error", url: "https://tpex.example", checked_at: "2026-05-07T00:00:00Z" },
  { provider: "MOPS", status: "network_error", url: "https://mops.example", checked_at: "2026-05-07T00:00:00Z" }
];

describe("collect official data job", () => {
  it("upserts official datasets and does not crash on provider failure", async () => {
    const database = new FakeDb();
    const result = await collectOfficialDataJob("2026-05-07", { mode: "auto", database, liveResults: failedLiveResults });
    expect(result.upserts.market_daily).toBeGreaterThan(0);
    expect(result.upserts.institutional_flows).toBeGreaterThan(0);
    expect(result.upserts.margin_short).toBeGreaterThan(0);
    expect(result.upserts.news_events).toBeGreaterThan(0);
    expect(result.sourceStatus.twse_mi_index).toContain("fixture_fallback");
    expect(database.queries.some((query) => query.sql.includes("insert into market_daily"))).toBe(true);
    expect(database.queries.some((query) => query.sql.includes("insert into institutional_flows"))).toBe(true);
    expect(database.queries.some((query) => query.sql.includes("insert into margin_short"))).toBe(true);
    expect(database.queries.some((query) => query.sql.includes("insert into news_events"))).toBe(true);
  });
});
