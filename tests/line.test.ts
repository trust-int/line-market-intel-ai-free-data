import { describe, expect, it } from "vitest";
import { hmacSha256Base64 } from "../src/utils/hash.js";
import { hashLineUserId, verifyLineSignature } from "../src/line/signature.js";
import { processLineEvent, type LineWebhookEvent } from "../src/line/webhook.js";
import type { Queryable } from "../src/db/client.js";

class FakeDb implements Queryable {
  queries: Array<{ sql: string; params?: unknown[] }> = [];
  async query<T = unknown>(sql: string, params?: unknown[]) {
    this.queries.push({ sql, params });
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
    const event: LineWebhookEvent = {
      webhookEventId: "event-1",
      type: "message",
      source: { type: "group", userId: "U123", groupId: "G123" },
      message: { id: "m1", type: "text", text: "2330 台積電 AI" }
    };
    const seen = new Set<string>();
    await processLineEvent(event, { database, seen });
    await processLineEvent(event, { database, seen });
    expect(database.queries).toHaveLength(1);
    expect(database.queries[0]?.params?.[4]).not.toBe("U123");
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
