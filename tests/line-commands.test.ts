import { describe, expect, it } from "vitest";
import { handleLineCommand } from "../src/line/commands.js";
import type { Queryable } from "../src/db/client.js";

class FakeDb implements Queryable {
  queries: Array<{ sql: string; params?: unknown[] }> = [];
  async query<T = unknown>(sql: string, params?: unknown[]) {
    this.queries.push({ sql, params });
    return { rows: [] as T[], rowCount: 1 };
  }
}

describe("LINE MVP commands", () => {
  it("adds, updates and deletes holdings", async () => {
    const database = new FakeDb();
    const add = await handleLineCommand("/持股 新增 6526 達發 成本 725 股數 1 策略 波段", {
      database,
      scope: { scopeType: "group", scopeId: "G1", userHash: "hash" }
    });
    const update = await handleLineCommand("/持股 更新 6526 成本 710 股數 2", {
      database,
      scope: { scopeType: "group", scopeId: "G1", userHash: "hash" }
    });
    const remove = await handleLineCommand("/持股 刪除 6526", {
      database,
      scope: { scopeType: "group", scopeId: "G1", userHash: "hash" }
    });
    expect(add.replyText).toContain("已更新持股");
    expect(update.replyText).toContain("已更新持股");
    expect(remove.replyText).toContain("已刪除持股");
    expect(database.queries[0]?.sql).toContain("insert into holdings");
    expect(database.queries[1]?.sql).toContain("update holdings");
    expect(database.queries[2]?.sql).toContain("active = false");
  });

  it("adds and removes watchlist tickers", async () => {
    const database = new FakeDb();
    const add = await handleLineCommand("/觀察 2492 華新科 被動元件", { database, scope: { scopeType: "group", scopeId: "G1" } });
    const remove = await handleLineCommand("/刪除觀察 2492", { database, scope: { scopeType: "group", scopeId: "G1" } });
    expect(add.handled).toBe(true);
    expect(remove.handled).toBe(true);
    expect(database.queries[0]?.params?.[0]).toBe("2492");
    expect(database.queries[0]?.params?.[2]).toEqual(["被動元件"]);
    expect(database.queries[1]?.params?.[0]).toBe("2492");
  });

  it("returns cost status without paid data", async () => {
    const result = await handleLineCommand("/成本", { database: new FakeDb() });
    expect(result.replyText).toContain("Paid data API used: false");
  });
});
