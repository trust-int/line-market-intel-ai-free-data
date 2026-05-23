import express from "express";
import { describe, expect, it } from "vitest";
import { createGptActionRouter } from "../src/api/gpt-action.js";
import { config } from "../src/config.js";
import type { Queryable } from "../src/db/client.js";
import { processLineEvent, type LineWebhookEvent } from "../src/line/webhook.js";
import { hashLineUserId, verifyLineSignature } from "../src/line/signature.js";
import type { StorageProvider } from "../src/storage/storage.js";
import { hmacSha256Base64 } from "../src/utils/hash.js";

class FakeDb implements Queryable {
  queries: Array<{ sql: string; params?: unknown[] }> = [];
  newsItems: Array<Record<string, unknown>> = [];

  async query<T = unknown>(sql: string, params?: unknown[]) {
    this.queries.push({ sql, params });
    if (sql.includes("insert into news_items")) {
      const row = {
        id: params?.[0],
        source: params?.[1],
        title: params?.[2],
        summary: params?.[3],
        full_text: params?.[4],
        source_url: params?.[5],
        related_tickers: JSON.parse(String(params?.[6] ?? "[]")),
        related_sectors: JSON.parse(String(params?.[7] ?? "[]")),
        event_type: params?.[8],
        importance: params?.[9],
        is_mops: params?.[10],
        data_quality_score: params?.[11],
        data_gaps: JSON.parse(String(params?.[12] ?? "[]")),
        interpretation_limit: params?.[13],
        collected_at: "2026-05-24T01:00:00.000Z"
      };
      this.newsItems = this.newsItems.filter((item) => item.id !== row.id);
      this.newsItems.push(row);
      return { rows: [] as T[], rowCount: 1 };
    }
    if (sql.includes("from news_items")) {
      return {
        rows: this.newsItems.map((item) => ({
          source: item.source,
          source_url: item.source_url,
          title: item.title,
          summary: item.summary,
          full_text: item.full_text,
          tickers: item.related_tickers,
          topics: item.related_sectors,
          event_type: item.event_type,
          event_importance: null,
          importance: item.importance,
          is_mops: item.is_mops,
          data_quality_score: item.data_quality_score,
          data_gaps: item.data_gaps,
          interpretation_limit: item.interpretation_limit,
          license_status: item.interpretation_limit,
          published_at: item.collected_at,
          fetched_at: item.collected_at,
          collected_at: item.collected_at
        })) as T[],
        rowCount: this.newsItems.length
      };
    }
    return { rows: [] as T[], rowCount: 1 };
  }
}

describe("LINE ingestion", () => {
  it("verifies LINE signature", () => {
    const secret = "line-secret";
    const body = Buffer.from(JSON.stringify({ events: [] }));
    const signature = hmacSha256Base64(secret, body);
    expect(verifyLineSignature(body, signature, secret)).toBe(true);
    expect(verifyLineSignature(body, "bad", secret)).toBe(false);
  });

  it("hashes userId instead of storing raw userId", () => {
    const hashed = hashLineUserId("U123", "hash-secret");
    expect(hashed).toBeTruthy();
    expect(hashed).not.toBe("U123");
  });

  it("processes text idempotently", async () => {
    const database = new FakeDb();
    const event = textEvent("2330 台積電 AI", "event-1");
    const seen = new Set<string>();
    await processLineEvent(event, { database, seen });
    await processLineEvent(event, { database, seen });
    expect(database.queries).toHaveLength(1);
    expect(database.queries[0]?.params?.[4]).not.toBe("U123");
  });

  it("replies to handled commands", async () => {
    const database = new FakeDb();
    const replies: Array<{ token: string | undefined; text: string }> = [];
    await processLineEvent(textEvent("/成本", "event-command"), {
      database,
      seen: new Set<string>(),
      replyText: async (token, text) => {
        replies.push({ token, text });
        return {};
      }
    });
    expect(replies).toHaveLength(1);
    expect(replies[0]?.token).toBe("reply-token");
    expect(replies[0]?.text).toContain("Paid data API used: false");
  });

  it("/news writes into news_items", async () => {
    const database = new FakeDb();
    const replies: string[] = [];
    await processLineEvent(textEvent("/news 2330 台積電 AI 伺服器出貨升溫", "event-news"), {
      database,
      seen: new Set<string>(),
      manualNewsAuth: { allowedUserIds: ["U123"] },
      replyText: async (_token, text) => {
        replies.push(text);
        return {};
      }
    });
    const params = findNewsInsert(database);
    expect(params?.[1]).toBe("line_manual");
    expect(params?.[2]).toBe("2330 台積電 AI 伺服器出貨升溫");
    expect(params?.[3]).toBe("2330 台積電 AI 伺服器出貨升溫");
    expect(params?.[4]).toBeNull();
    expect(params?.[5]).toBeNull();
    expect(params?.[8]).toBe("manual");
    expect(params?.[9]).toBe("medium");
    expect(params?.[10]).toBe(false);
    expect(params?.[11]).toBe(60);
    expect(JSON.parse(String(params?.[12]))).toEqual(["full_text_missing", "manual_source"]);
    expect(params?.[13]).toBe("title_or_summary_only");
    expect(replies[0]).toBe("已收錄到今日 manual news，可由 /gpt/news/today/summary 讀取。");
  });

  it("/manual writes into news_items", async () => {
    const database = new FakeDb();
    await processLineEvent(textEvent("/manual 2454 聯發科 法說重點摘要", "event-manual"), {
      database,
      seen: new Set<string>(),
      manualNewsAuth: { allowedUserIds: ["U123"] },
      replyText: async () => ({})
    });
    const params = findNewsInsert(database);
    expect(params?.[1]).toBe("line_manual_pack");
    expect(params?.[8]).toBe("manual_pack_note");
    expect(params?.[11]).toBe(65);
    expect(JSON.parse(String(params?.[12]))).toEqual(["full_text_missing", "manual_source"]);
    expect(params?.[13]).toBe("title_or_summary_only");
  });

  it("extracts related_tickers from /news and /manual", async () => {
    const database = new FakeDb();
    await processLineEvent(textEvent("/news 2330 台積電與 2454 聯發科皆受 AI、PCB、散熱、記憶體 題材帶動", "event-tickers"), {
      database,
      seen: new Set<string>(),
      manualNewsAuth: { allowedUserIds: ["U123"] },
      replyText: async () => ({})
    });
    const params = findNewsInsert(database);
    expect(JSON.parse(String(params?.[6]))).toEqual(["2330", "2454"]);
    expect(JSON.parse(String(params?.[7]))).toEqual([]);
    expect(JSON.parse(String(params?.[12]))).toEqual(["full_text_missing", "manual_source"]);
  });

  it("/news keeps urls as manual text without extracting source_url", async () => {
    const database = new FakeDb();
    const body =
      "2330 台積電與 2454 聯發科受 AI 伺服器、PCB、散熱、記憶體 需求帶動，市場關注 GB200 與水冷供應鏈。完整連結 https://example.com/news/ai-pcb-thermal-memory";
    await processLineEvent(textEvent(`/news ${body}`, "event-url"), {
      database,
      seen: new Set<string>(),
      manualNewsAuth: { allowedUserIds: ["U123"] },
      replyText: async () => ({})
    });

    const params = findNewsInsert(database);
    expect(params?.[3]).toBe(body);
    expect(params?.[5]).toBeNull();
    expect(JSON.parse(String(params?.[6]))).toEqual(["2330", "2454"]);
    expect(JSON.parse(String(params?.[7]))).toEqual([]);
    expect(params?.[11]).toBe(60);
    expect(params?.[13]).toBe("title_or_summary_only");
  });

  it("/news URL-only notes are still manual summaries", async () => {
    const database = new FakeDb();
    await processLineEvent(textEvent("/news https://example.com/link-only", "event-link-only"), {
      database,
      seen: new Set<string>(),
      manualNewsAuth: { allowedUserIds: ["U123"] },
      replyText: async () => ({})
    });

    const params = findNewsInsert(database);
    const gaps = JSON.parse(String(params?.[12]));
    expect(params?.[3]).toBe("https://example.com/link-only");
    expect(params?.[5]).toBeNull();
    expect(params?.[11]).toBe(60);
    expect(params?.[13]).toBe("title_or_summary_only");
    expect(gaps).toEqual(["full_text_missing", "manual_source"]);
  });

  it("does not write news_items for unauthorized LINE user", async () => {
    const database = new FakeDb();
    const replies: string[] = [];
    await processLineEvent(textEvent("/news 2330 台積電 AI", "event-unauthorized"), {
      database,
      seen: new Set<string>(),
      manualNewsAuth: { allowedUserIds: ["U999"] },
      replyText: async (_token, text) => {
        replies.push(text);
        return {};
      }
    });
    expect(database.queries.some((query) => query.sql.includes("insert into news_items"))).toBe(false);
    expect(replies).toEqual(["unauthorized"]);
  });

  it("makes /news data readable from /gpt/news/today/summary", async () => {
    const database = new FakeDb();
    await processLineEvent(textEvent("/news 2330 台積電與 2454 聯發科 AI 題材同步升溫", "event-readable"), {
      database,
      seen: new Set<string>(),
      manualNewsAuth: { allowedUserIds: ["U123"] },
      replyText: async () => ({})
    });
    const { base, close } = await startGptRouter(database);
    try {
      const response = await fetch(`${base}/gpt/news/today/summary?limit=20`, {
        headers: { Authorization: `Bearer ${config.gptActionBearerToken}` }
      });
      const body = await response.json() as {
        status: string;
        line_manual_news: Array<{
          title: string;
          summary: string;
          source_url: string | null;
          related_tickers: string[];
          related_sectors: string[];
          interpretation_limit: string;
          data_gaps: string[];
          collected_at: string;
        }>;
      };
      expect(response.status).toBe(200);
      expect(body.status).toBe("ok");
      expect(body.line_manual_news[0]?.title).toContain("2330");
      expect(body.line_manual_news[0]?.summary).toContain("AI 題材同步升溫");
      expect(body.line_manual_news[0]?.source_url).toBeNull();
      expect(body.line_manual_news[0]?.related_tickers).toEqual(["2330", "2454"]);
      expect(body.line_manual_news[0]?.related_sectors).toEqual([]);
      expect(body.line_manual_news[0]?.interpretation_limit).toBe("title_or_summary_only");
      expect(body.line_manual_news[0]?.data_gaps).toEqual(["full_text_missing", "manual_source"]);
      expect(body.line_manual_news[0]?.collected_at).toBe("2026-05-24T01:00:00.000Z");
    } finally {
      close();
    }
  });

  it("does not write ordinary text messages into news_items", async () => {
    const database = new FakeDb();
    await processLineEvent(textEvent("2330 台積電一般聊天文字", "event-ordinary"), { database, seen: new Set<string>() });
    expect(database.queries.some((query) => query.sql.includes("insert into news_items"))).toBe(false);
  });

  it("image messages are recorded without OCR and ask for text context", async () => {
    const database = new FakeDb();
    const replies: string[] = [];
    const storage: StorageProvider = {
      async putObject(params) {
        return {
          filePath: `/tmp/${params.fileName}`,
          sha256: "image-sha",
          bytes: params.body.length,
          mimeType: params.mimeType
        };
      }
    };

    await processLineEvent(
      {
        webhookEventId: "event-image",
        type: "message",
        replyToken: "reply-token",
        timestamp: Date.parse("2026-05-24T01:00:00Z"),
        source: { type: "user", userId: "U123" },
        message: { id: "image-1", type: "image" }
      },
      {
        database,
        storage,
        seen: new Set<string>(),
        downloadContent: async () => ({ body: Buffer.from("image"), mimeType: "image/png", fileName: "image-1.png" }),
        replyText: async (_token, text) => {
          replies.push(text);
          return {};
        }
      }
    );

    const params = findNewsInsert(database);
    expect(params?.[1]).toBe("line_image_manual");
    expect(params?.[2]).toBe("LINE image message");
    expect(JSON.parse(String(params?.[12]))).toEqual(expect.arrayContaining(["image_only", "ocr_not_available", "text_missing"]));
    expect(params?.[13]).toBe("image_without_ocr");
    expect(replies[0]).toContain("尚未 OCR");
  });

  it("handles unsend event", async () => {
    const database = new FakeDb();
    await processLineEvent(
      { webhookEventId: "event-unsend", type: "unsend", unsend: { messageId: "m1" } },
      { database, seen: new Set<string>() }
    );
    expect(database.queries[0]?.sql).toContain("status = 'unsent'");
  });
});

function textEvent(text: string, eventId: string): LineWebhookEvent {
  return {
    webhookEventId: eventId,
    type: "message",
    replyToken: "reply-token",
    timestamp: Date.parse("2026-05-24T01:00:00Z"),
    source: { type: "user", userId: "U123" },
    message: { id: `m-${eventId}`, type: "text", text }
  };
}

function findNewsInsert(database: FakeDb): unknown[] | undefined {
  return database.queries.find((query) => query.sql.includes("insert into news_items"))?.params;
}

async function startGptRouter(database: Queryable): Promise<{ base: string; close: () => void }> {
  const app = express();
  app.use("/gpt", createGptActionRouter(database));
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => server.close()
  };
}
