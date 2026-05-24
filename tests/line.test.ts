import express from "express";
import { describe, expect, it } from "vitest";
import { createGptActionRouter } from "../src/api/gpt-action.js";
import { config } from "../src/config.js";
import type { Queryable } from "../src/db/client.js";
import type { FileExtractionStatus, FileTextExtractor } from "../src/line/file-text-extractor.js";
import type { OcrService, OcrStatus } from "../src/line/ocr-service.js";
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
        collected_at: params?.[14] ?? "2026-05-24T01:00:00.000Z",
        metadata: JSON.parse(String(params?.[15] ?? "{}")),
        raw_payload: JSON.parse(String(params?.[16] ?? "{}")),
        market_date: params?.[17],
        parser_version: params?.[18],
        archived: false
      };
      this.newsItems = this.newsItems.filter((item) => item.id !== row.id);
      this.newsItems.push(row);
      return { rows: [] as T[], rowCount: 1 };
    }
    if (sql.includes("from news_items")) {
      const marketDateParam = params?.find((param) => typeof param === "string" && /^\d{4}-\d{2}-\d{2}$/.test(param));
      const rows = this.newsItems.filter((item) => {
        if (sql.includes("market_date") && marketDateParam && item.market_date !== marketDateParam) return false;
        if (sql.includes("coalesce(archived, false) = false") && item.archived === true) return false;
        return true;
      });
      return {
        rows: rows.map((item) => ({
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
          collected_at: item.collected_at,
          market_date: item.market_date
        })) as T[],
        rowCount: rows.length
      };
    }
    if (sql.includes("update news_items") && sql.includes("archived = true")) {
      const marketDate = params?.[0];
      const manualSources = new Set(["line_manual", "line_manual_pack", "line_image_manual", "line_image_ocr", "line_file_text", "line_file_manual"]);
      const manualTypes = new Set(["manual", "manual_pack_note", "image_manual", "image_ocr", "file_manual", "file_text"]);
      const matches = (item: Record<string, unknown>) =>
        item.archived !== true &&
        item.market_date === marketDate &&
        (manualSources.has(String(item.source)) || manualTypes.has(String(item.event_type)));
      const before = this.newsItems.filter(matches).length;
      this.newsItems = this.newsItems.map((item) => matches(item) ? { ...item, archived: true, archived_at: "2026-05-24T01:00:00.000Z" } : item);
      return { rows: [] as T[], rowCount: before };
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
    expect(params?.[11]).toBe(55);
    expect(JSON.parse(String(params?.[12]))).toEqual(expect.arrayContaining(["full_text_missing", "source_url_missing", "summary_too_short"]));
    expect(params?.[13]).toBe("brief_manual_note_only");
    expect(params?.[17]).toBe("2026-05-24");
    expect(params?.[18]).toBe("line_manual_v2");
    expect(JSON.parse(String(params?.[16]))).toMatchObject({
      raw_text: "/news 2330 台積電 AI 伺服器出貨升溫",
      line_message_type: "text",
      line_message_id: "m-event-news",
      line_user_id_hash: expect.any(String),
      parser_version: "line_manual_v2"
    });
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
    expect(params?.[11]).toBe(60);
    expect(JSON.parse(String(params?.[12]))).toEqual(expect.arrayContaining(["full_text_missing", "source_url_missing", "summary_too_short"]));
    expect(params?.[13]).toBe("brief_manual_note_only");
    expect(params?.[17]).toBe("2026-05-24");
    expect(params?.[18]).toBe("line_manual_v2");
    expect(JSON.parse(String(params?.[16]))).toMatchObject({
      raw_text: "/manual 2454 聯發科 法說重點摘要",
      line_message_type: "text",
      line_message_id: "m-event-manual",
      line_user_id_hash: expect.any(String),
      parser_version: "line_manual_v2"
    });
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
    expect(JSON.parse(String(params?.[7]))).toEqual(expect.arrayContaining(["AI伺服器", "PCB", "散熱", "記憶體"]));
    expect(JSON.parse(String(params?.[12]))).toEqual(expect.arrayContaining(["full_text_missing", "source_url_missing", "summary_too_short"]));
  });

  it("/news extracts source_url and keeps the full body in summary", async () => {
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
    expect(params?.[5]).toBe("https://example.com/news/ai-pcb-thermal-memory");
    expect(JSON.parse(String(params?.[6]))).toEqual(["2330", "2454"]);
    expect(JSON.parse(String(params?.[7]))).toEqual(expect.arrayContaining(["AI伺服器", "PCB", "散熱", "記憶體"]));
    expect(params?.[11]).toBe(65);
    expect(params?.[13]).toBe("title_or_summary_only");
  });

  it("/news URL-only notes are link_only", async () => {
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
    expect(params?.[5]).toBe("https://example.com/link-only");
    expect(params?.[11]).toBe(45);
    expect(params?.[13]).toBe("link_only");
    expect(gaps).toContain("summary_too_short");
    expect(gaps).not.toContain("source_url_missing");
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
          market_date?: string;
          raw_payload?: unknown;
        }>;
      };
      expect(response.status).toBe(200);
      expect(body.status).toBe("ok");
      expect(body.line_manual_news[0]?.title).toContain("2330");
      expect(body.line_manual_news[0]?.summary).toContain("AI 題材同步升溫");
      expect(body.line_manual_news[0]?.source_url).toBeNull();
      expect(body.line_manual_news[0]?.related_tickers).toEqual(["2330", "2454"]);
      expect(body.line_manual_news[0]?.related_sectors).toEqual(["AI伺服器"]);
      expect(body.line_manual_news[0]?.interpretation_limit).toBe("brief_manual_note_only");
      expect(body.line_manual_news[0]?.data_gaps).toContain("summary_too_short");
      expect(body.line_manual_news[0]?.collected_at).toBe("2026-05-24T01:00:00.000Z");
      expect(body.line_manual_news[0]?.market_date).toBe("2026-05-24");
      expect(body.line_manual_news[0]?.raw_payload).toBeUndefined();
    } finally {
      close();
    }
  });

  it("does not write ordinary text messages into news_items", async () => {
    const database = new FakeDb();
    await processLineEvent(textEvent("2330 台積電一般聊天文字", "event-ordinary"), { database, seen: new Set<string>() });
    expect(database.queries.some((query) => query.sql.includes("insert into news_items"))).toBe(false);
  });

  it("OCR_ENABLED=false image messages write line_image_manual with OCR disabled gaps", async () => {
    const database = new FakeDb();
    const replies: string[] = [];

    await processLineEvent(
      imageEvent("image-disabled", "event-image-disabled"),
      {
        database,
        storage: fakeStorage(),
        seen: new Set<string>(),
        downloadContent: async () => ({ body: Buffer.from("image"), mimeType: "image/png", fileName: "image-1.png" }),
        ocrConfig: { enabled: false },
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
    expect(JSON.parse(String(params?.[15]))).toMatchObject({
      user_hash: expect.any(String),
      message_id: "image-disabled",
      message_type: "image",
      image_hash: "image-sha",
      image_size_bytes: 5,
      ocr_provider: "tesseract",
      ocr_enabled: false,
      ocr_status: "disabled",
      ocr_text_length: 0
    });
    expect(replies[0]).toBe("已收到圖片，但目前 OCR 未啟用。請補 /news 文字摘要或原始連結。");
  });

  it("OCR success image messages write line_image_ocr and are readable from news summary", async () => {
    const database = new FakeDb();
    const replies: string[] = [];
    const text = "2330 台積電與 2454 聯發科受 AI 伺服器、PCB、散熱、記憶體需求帶動，市場關注 GB200 與液冷供應鏈，後續仍需確認成交量、外資買賣超與官方資料。";

    await processLineEvent(imageEvent("image-ocr", "event-image-ocr"), {
      database,
      storage: fakeStorage(),
      seen: new Set<string>(),
      downloadContent: async () => ({ body: Buffer.from("image"), mimeType: "image/png", fileName: "image-ocr.png" }),
      ocrConfig: { enabled: true, minTextLength: 10, maxImageBytes: 5242880 },
      ocrService: fakeOcrService("success", text),
      replyText: async (_token, reply) => {
        replies.push(reply);
        return {};
      }
    });

    const params = findNewsInsert(database);
    expect(params?.[1]).toBe("line_image_ocr");
    expect(params?.[3]).toBe(text);
    expect(JSON.parse(String(params?.[6]))).toEqual(["2330", "2454"]);
    expect(JSON.parse(String(params?.[7]))).toEqual(expect.arrayContaining(["AI伺服器", "PCB", "散熱", "記憶體"]));
    expect(JSON.parse(String(params?.[12]))).toEqual(expect.arrayContaining(["ocr_extracted_text", "source_url_missing"]));
    expect(params?.[13]).toBe("ocr_text_available");
    expect(replies[0]).toBe("已收到圖片並完成 OCR，已收錄到今日 manual news，可由 /gpt/news/today/summary 讀取。");

    const { base, close } = await startGptRouter(database);
    try {
      const response = await fetch(`${base}/gpt/news/today/summary?limit=20`, {
        headers: { Authorization: `Bearer ${config.gptActionBearerToken}` }
      });
      const body = await response.json() as { line_manual_news: Array<{ source: string; summary: string; related_tickers: string[] }> };
      expect(response.status).toBe(200);
      expect(body.line_manual_news[0]?.source).toBe("line_image_ocr");
      expect(body.line_manual_news[0]?.summary).toContain("台積電");
      expect(body.line_manual_news[0]?.related_tickers).toEqual(["2330", "2454"]);
    } finally {
      close();
    }
  });

  it("OCR success with short text is marked brief_ocr_text_only", async () => {
    const database = new FakeDb();
    await processLineEvent(imageEvent("image-short-success", "event-image-short-success"), {
      database,
      storage: fakeStorage(),
      seen: new Set<string>(),
      downloadContent: async () => ({ body: Buffer.from("image"), mimeType: "image/png", fileName: "image-short.png" }),
      ocrConfig: { enabled: true, minTextLength: 10 },
      ocrService: fakeOcrService("success", "2330 AI 題材"),
      replyText: async () => ({})
    });
    const params = findNewsInsert(database);
    expect(params?.[1]).toBe("line_image_ocr");
    expect(params?.[11]).toBe(55);
    expect(JSON.parse(String(params?.[12]))).toEqual(expect.arrayContaining(["ocr_extracted_text", "summary_too_short"]));
    expect(params?.[13]).toBe("brief_ocr_text_only");
  });

  it("OCR enabled but empty text writes image_manual with ocr_failed", async () => {
    const database = new FakeDb();
    const replies: string[] = [];
    await processLineEvent(imageEvent("image-empty", "event-image-empty"), {
      database,
      storage: fakeStorage(),
      seen: new Set<string>(),
      downloadContent: async () => ({ body: Buffer.from("image"), mimeType: "image/png", fileName: "image-empty.png" }),
      ocrConfig: { enabled: true, minTextLength: 10 },
      ocrService: fakeOcrService("failed", ""),
      replyText: async (_token, text) => {
        replies.push(text);
        return {};
      }
    });
    const params = findNewsInsert(database);
    expect(params?.[1]).toBe("line_image_manual");
    expect(JSON.parse(String(params?.[12]))).toEqual(expect.arrayContaining(["ocr_failed", "text_missing"]));
    expect(params?.[13]).toBe("image_without_ocr");
    expect(replies[0]).toBe("已收到圖片，但 OCR 未取得有效文字。請補 /news 文字摘要或原始連結。");
  });

  it("large image skips OCR and records image_too_large", async () => {
    const database = new FakeDb();
    const calls: string[] = [];
    await processLineEvent(imageEvent("image-large", "event-image-large"), {
      database,
      storage: fakeStorage(6),
      seen: new Set<string>(),
      downloadContent: async () => ({ body: Buffer.from("image!"), mimeType: "image/png", fileName: "image-large.png" }),
      ocrConfig: { enabled: true, maxImageBytes: 5 },
      ocrService: {
        async recognizeImage() {
          calls.push("called");
          return { status: "success", provider: "tesseract", text: "should not run", textLength: 14 };
        }
      },
      replyText: async () => ({})
    });
    const params = findNewsInsert(database);
    expect(calls).toHaveLength(0);
    expect(params?.[11]).toBe(25);
    expect(JSON.parse(String(params?.[12]))).toEqual(expect.arrayContaining(["image_too_large", "ocr_skipped", "text_missing"]));
    expect(params?.[13]).toBe("image_without_ocr");
  });

  it("high pixel image skips OCR before invoking tesseract", async () => {
    const database = new FakeDb();
    const calls: string[] = [];
    const image = pngWithDimensions(200, 200);
    await processLineEvent(imageEvent("image-pixels-large", "event-image-pixels-large"), {
      database,
      storage: fakeStorage(image.length),
      seen: new Set<string>(),
      downloadContent: async () => ({ body: image, mimeType: "image/png", fileName: "image-pixels-large.png" }),
      ocrConfig: { enabled: true, maxImageBytes: 5242880, maxImagePixels: 100 },
      ocrService: {
        async recognizeImage() {
          calls.push("called");
          return { status: "success", provider: "tesseract", text: "should not run", textLength: 14 };
        }
      },
      replyText: async () => ({})
    });
    const params = findNewsInsert(database);
    expect(calls).toHaveLength(0);
    expect(params?.[11]).toBe(25);
    expect(JSON.parse(String(params?.[12]))).toEqual(expect.arrayContaining(["image_too_large", "ocr_skipped", "text_missing"]));
    expect(JSON.parse(String(params?.[15]))).toMatchObject({
      image_width: 200,
      image_height: 200,
      image_pixels: 40000
    });
  });

  it("does not download or write image news_items for unauthorized LINE user", async () => {
    const database = new FakeDb();
    const replies: string[] = [];
    const downloads: string[] = [];
    await processLineEvent(imageEvent("image-unauthorized", "event-image-unauthorized"), {
      database,
      storage: fakeStorage(),
      seen: new Set<string>(),
      manualNewsAuth: { allowedUserIds: ["U999"] },
      downloadContent: async () => {
        downloads.push("called");
        return { body: Buffer.from("image"), mimeType: "image/png", fileName: "image.png" };
      },
      replyText: async (_token, text) => {
        replies.push(text);
        return {};
      }
    });
    expect(downloads).toHaveLength(0);
    expect(database.queries.some((query) => query.sql.includes("insert into news_items"))).toBe(false);
    expect(database.queries.some((query) => query.sql.includes("insert into line_messages"))).toBe(false);
    expect(replies).toEqual(["unauthorized"]);
  });

  it("/清空今日新聞 archives image OCR and image manual items", async () => {
    const database = new FakeDb();
    await processLineEvent(textEvent("/清空今日新聞", "event-clear-images"), {
      database,
      seen: new Set<string>(),
      replyText: async () => ({})
    });
    const archiveQuery = database.queries.find((query) => query.sql.includes("update news_items"));
    expect(archiveQuery?.sql).toContain("line_image_ocr");
    expect(archiveQuery?.sql).toContain("line_image_manual");
    expect(archiveQuery?.sql).toContain("line_file_text");
    expect(archiveQuery?.sql).toContain("line_file_manual");
  });

  it("/清空今日新聞 requires an authorized LINE user", async () => {
    const database = new FakeDb();
    const replies: string[] = [];
    await processLineEvent(textEvent("/清空今日新聞", "event-clear-unauthorized"), {
      database,
      seen: new Set<string>(),
      manualNewsAuth: { allowedUserIds: ["U999"] },
      replyText: async (_token, text) => {
        replies.push(text);
        return {};
      }
    });
    expect(replies).toEqual(["unauthorized"]);
    expect(database.queries.some((query) => query.sql.includes("update news_items"))).toBe(false);
  });

  it("/清空今日新聞 keeps DB rows but removes them from GPT summary", async () => {
    const database = new FakeDb();
    await processLineEvent(textEvent("/news 2330 台積電 AI 伺服器需求強 https://example.com/news", "event-clear-readable"), {
      database,
      seen: new Set<string>(),
      manualNewsAuth: { allowedUserIds: ["U123"] },
      replyText: async () => ({})
    });
    expect(database.newsItems).toHaveLength(1);
    await processLineEvent(textEvent("/清空今日新聞", "event-clear-after-news"), {
      database,
      seen: new Set<string>(),
      manualNewsAuth: { allowedUserIds: ["U123"] },
      replyText: async () => ({})
    });
    expect(database.newsItems[0]?.archived).toBe(true);

    const { base, close } = await startGptRouter(database);
    try {
      const response = await fetch(`${base}/gpt/news/today/summary?limit=20`, {
        headers: { Authorization: `Bearer ${config.gptActionBearerToken}` }
      });
      const body = await response.json() as { status: string; line_manual_news: unknown[]; data_gaps: string[] };
      expect(response.status).toBe(200);
      expect(body.status).toBe("empty");
      expect(body.line_manual_news).toEqual([]);
      expect(body.data_gaps).toEqual(["news_empty"]);
    } finally {
      close();
    }
  });

  it("/清空今日新聞 does not archive non-manual crawler rows", async () => {
    const database = new FakeDb();
    database.newsItems.push({
      id: "crawler-1",
      source: "crawler_public",
      event_type: "other",
      title: "crawler row",
      market_date: "2026-05-24",
      archived: false
    });
    await processLineEvent(textEvent("/清空今日新聞", "event-clear-crawler"), {
      database,
      seen: new Set<string>(),
      manualNewsAuth: { allowedUserIds: ["U123"] },
      replyText: async () => ({})
    });
    expect(database.newsItems[0]?.archived).toBe(false);
  });

  it("/gpt/news/today/summary returns OCR failed rows with null summary and data_gaps", async () => {
    const database = new FakeDb();
    await processLineEvent(imageEvent("image-summary-failed", "event-image-summary-failed"), {
      database,
      storage: fakeStorage(),
      seen: new Set<string>(),
      downloadContent: async () => ({ body: Buffer.from("image"), mimeType: "image/png", fileName: "image-failed.png" }),
      ocrConfig: { enabled: true, minTextLength: 10 },
      ocrService: fakeOcrService("failed", ""),
      replyText: async () => ({})
    });

    const { base, close } = await startGptRouter(database);
    try {
      const response = await fetch(`${base}/gpt/news/today/summary?limit=20`, {
        headers: { Authorization: `Bearer ${config.gptActionBearerToken}` }
      });
      const body = await response.json() as { line_manual_news: Array<{ source: string; summary: string | null; data_gaps: string[] }> };
      expect(response.status).toBe(200);
      expect(body.line_manual_news[0]?.source).toBe("line_image_manual");
      expect(body.line_manual_news[0]?.summary).toBeNull();
      expect(body.line_manual_news[0]?.data_gaps).toEqual(expect.arrayContaining(["ocr_failed", "text_missing"]));
    } finally {
      close();
    }
  });

  it("file message txt extracts text into line_file_text", async () => {
    const database = new FakeDb();
    const text = "2330 台積電與 2454 聯發科 AI 伺服器、PCB、散熱、記憶體 供應鏈觀察。後續仍需確認成交量、法人買賣超與官方資料，並比對大盤風險與產業新聞，不直接作為買進依據。";
    await processLineEvent(fileEvent("file-txt", "event-file-txt", "note.txt"), {
      database,
      storage: fakeStorage(),
      seen: new Set<string>(),
      downloadContent: async () => ({ body: Buffer.from(text, "utf8"), mimeType: "text/plain", fileName: "note.txt" }),
      replyText: async () => ({})
    });
    const params = findNewsInsert(database);
    expect(params?.[1]).toBe("line_file_text");
    expect(params?.[3]).toContain("台積電");
    expect(params?.[4]).toContain("聯發科");
    expect(JSON.parse(String(params?.[6]))).toEqual(["2330", "2454"]);
    expect(JSON.parse(String(params?.[7]))).toEqual(expect.arrayContaining(["AI伺服器", "PCB", "散熱", "記憶體"]));
    expect(JSON.parse(String(params?.[12]))).toEqual(expect.arrayContaining(["file_extracted_text", "source_url_missing"]));
    expect(params?.[13]).toBe("short_file_text_available");
  });

  it("file message pdf with text mock writes file_text_available", async () => {
    const database = new FakeDb();
    const text = "2330 台積電法說會摘要：AI 伺服器需求延續，CoWoS 先進封裝產能擴張，2454 聯發科同步受惠。仍需搭配成交量、法人買賣超、融資融券與大盤風險確認，不直接作為買進依據。".repeat(4);
    await processLineEvent(fileEvent("file-pdf", "event-file-pdf", "report.pdf"), {
      database,
      storage: fakeStorage(),
      seen: new Set<string>(),
      downloadContent: async () => ({ body: Buffer.from("%PDF fake"), mimeType: "application/pdf", fileName: "report.pdf" }),
      fileTextExtractor: fakeFileTextExtractor("success", text, "pdf"),
      replyText: async () => ({})
    });
    const params = findNewsInsert(database);
    expect(params?.[1]).toBe("line_file_text");
    expect(params?.[3]).toContain("CoWoS");
    expect(params?.[13]).toBe("file_text_available");
  });

  it("unsupported file writes line_file_manual with file_type_not_supported", async () => {
    const database = new FakeDb();
    await processLineEvent(fileEvent("file-unsupported", "event-file-unsupported", "archive.zip"), {
      database,
      storage: fakeStorage(),
      seen: new Set<string>(),
      downloadContent: async () => ({ body: Buffer.from("zip"), mimeType: "application/zip", fileName: "archive.zip" }),
      fileTextExtractor: fakeFileTextExtractor("unsupported", null, "unsupported", ["file_only", "file_type_not_supported", "text_missing"]),
      replyText: async () => ({})
    });
    const params = findNewsInsert(database);
    expect(params?.[1]).toBe("line_file_manual");
    expect(params?.[2]).toBe("archive.zip");
    expect(JSON.parse(String(params?.[12]))).toEqual(expect.arrayContaining(["file_type_not_supported", "text_missing"]));
    expect(params?.[13]).toBe("file_without_text");
  });

  it("oversized file records file_too_large and skips extraction", async () => {
    const database = new FakeDb();
    await processLineEvent(fileEvent("file-large", "event-file-large", "large.txt"), {
      database,
      storage: fakeStorage(11),
      seen: new Set<string>(),
      fileIngestConfig: { maxBytes: 10 },
      downloadContent: async () => ({ body: Buffer.from("large file!!"), mimeType: "text/plain", fileName: "large.txt" }),
      replyText: async () => ({})
    });
    const params = findNewsInsert(database);
    expect(params?.[1]).toBe("line_file_manual");
    expect(params?.[11]).toBe(25);
    expect(JSON.parse(String(params?.[12]))).toEqual(expect.arrayContaining(["file_too_large", "text_extraction_skipped", "text_missing"]));
  });

  it("does not download or write file news_items for unauthorized LINE user", async () => {
    const database = new FakeDb();
    const downloads: string[] = [];
    const replies: string[] = [];
    await processLineEvent(fileEvent("file-unauthorized", "event-file-unauthorized", "note.txt"), {
      database,
      seen: new Set<string>(),
      manualNewsAuth: { allowedUserIds: ["U999"] },
      downloadContent: async () => {
        downloads.push("called");
        return { body: Buffer.from("text"), mimeType: "text/plain", fileName: "note.txt" };
      },
      replyText: async (_token, text) => {
        replies.push(text);
        return {};
      }
    });
    expect(downloads).toHaveLength(0);
    expect(database.queries.some((query) => query.sql.includes("insert into news_items"))).toBe(false);
    expect(replies).toEqual(["unauthorized"]);
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

function imageEvent(messageId: string, eventId: string): LineWebhookEvent {
  return {
    webhookEventId: eventId,
    type: "message",
    replyToken: "reply-token",
    timestamp: Date.parse("2026-05-24T01:00:00Z"),
    source: { type: "user", userId: "U123" },
    message: { id: messageId, type: "image" }
  };
}

function fileEvent(messageId: string, eventId: string, fileName: string): LineWebhookEvent {
  return {
    webhookEventId: eventId,
    type: "message",
    replyToken: "reply-token",
    timestamp: Date.parse("2026-05-24T01:00:00Z"),
    source: { type: "user", userId: "U123" },
    message: { id: messageId, type: "file", fileName }
  };
}

function fakeStorage(bytes?: number): StorageProvider {
  return {
    async putObject(params) {
      return {
        filePath: `/tmp/${params.fileName}`,
        sha256: "image-sha",
        bytes: bytes ?? params.body.length,
        mimeType: params.mimeType
      };
    }
  };
}

function pngWithDimensions(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(24);
  buffer.set(Buffer.from("89504e470d0a1a0a", "hex"), 0);
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

function fakeOcrService(status: OcrStatus, text: string | null): OcrService {
  return {
    async recognizeImage() {
      return {
        status,
        provider: "tesseract",
        text,
        textLength: text?.length ?? 0
      };
    }
  };
}

function fakeFileTextExtractor(
  status: FileExtractionStatus,
  text: string | null,
  fileType: string,
  dataGaps: string[] = status === "success" ? ["file_extracted_text"] : ["file_only", "text_extraction_failed", "text_missing"]
): FileTextExtractor {
  return {
    async extractText() {
      return {
        status,
        text,
        fileType,
        dataGaps,
        metadata: {
          file_type: fileType,
          extracted_text_length: text?.length ?? 0
        }
      };
    }
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
