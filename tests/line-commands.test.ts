import { describe, expect, it } from "vitest";
import { handleLineCommand } from "../src/line/commands.js";
import type { Queryable } from "../src/db/client.js";

class FakeDb implements Queryable {
  queries: Array<{ sql: string; params?: unknown[] }> = [];
  lineRows: Array<Record<string, unknown>> = [];
  newsItemRows: Array<Record<string, unknown>> = [];
  async query<T = unknown>(sql: string, params?: unknown[]) {
    this.queries.push({ sql, params });
    if (sql.includes("from news_items")) {
      return { rows: this.newsItemRows as T[], rowCount: this.newsItemRows.length };
    }
    if (sql.includes("from line_messages")) {
      return { rows: this.lineRows as T[], rowCount: this.lineRows.length };
    }
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

  it("builds manual pack from LINE messages", async () => {
    const database = new FakeDb();
    database.lineRows = [
      {
        source_type: "group",
        message_id: "m1",
        message_type: "text",
        raw_text: "2330 台積電 AI 伺服器題材升溫",
        tickers: [],
        topics: [],
        received_at: "2026-05-24T09:00:00+08:00"
      }
    ];
    const result = await handleLineCommand("/手動包", {
      database,
      scope: { scopeType: "group", scopeId: "G1", userHash: "hash" }
    });
    expect(result.replyText).toContain("LINE 訊息 1 筆");
    expect(database.queries.some((query) => query.sql.includes("from line_messages"))).toBe(true);
    expect(database.queries.some((query) => query.sql.includes("insert into manual_gpt_packs"))).toBe(true);
  });

  it("uses LINE manual rows as today news fallback", async () => {
    const database = new FakeDb();
    database.lineRows = [{ raw_text: "2454 聯發科 法說重點摘要", message_type: "text" }];
    const result = await handleLineCommand("/今日新聞", { database });
    expect(result.replyText).toContain("[LINE] 2454 聯發科");
  });

  it("uses active news_items before raw LINE fallback", async () => {
    const database = new FakeDb();
    database.newsItemRows = [{ source: "line_manual", title: "2330 台積電 今日新聞" }];
    database.lineRows = [{ raw_text: "不應優先顯示", message_type: "text" }];
    const result = await handleLineCommand("/今日新聞", { database });
    expect(result.replyText).toContain("[line_manual] 2330 台積電 今日新聞");
    expect(result.replyText).not.toContain("不應優先顯示");
    expect(database.queries[0]?.sql).toContain("coalesce(status, 'active') = 'active'");
    expect(database.queries[0]?.params?.[0]).toMatch(/^\d{4}-\d{2}-\d{2}T15:30:00\+08:00$/);
    expect(database.queries[0]?.params?.[1]).toMatch(/^\d{4}-\d{2}-\d{2}T15:30:00\+08:00$/);
  });

  it("archives today's manual news", async () => {
    const database = new FakeDb();
    const result = await handleLineCommand("/清空今日新聞", { database });
    expect(result.replyText).toContain("已清空今日 manual news");
    expect(database.queries[0]?.sql).toContain("update news_items");
    expect(database.queries[0]?.sql).toContain("status = 'archived'");
    expect(database.queries[0]?.params).toEqual(expect.arrayContaining(["line_clear_today"]));
  });

  it("archives today's manual news by ticker", async () => {
    const database = new FakeDb();
    const result = await handleLineCommand("/刪除新聞 2330", { database });
    expect(result.replyText).toContain("已刪除今日 2330 相關 manual news");
    expect(database.queries[0]?.sql).toContain("related_tickers ? $3");
    expect(database.queries[0]?.params).toEqual([expect.any(String), expect.any(String), "2330", "line_delete_ticker"]);
  });
});
