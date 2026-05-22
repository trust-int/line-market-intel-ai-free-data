import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Queryable } from "../db/client.js";
import type { PrivateStorage, StoredObject } from "../storage/storage.js";
import { processLineEvent, type LineWebhookEvent } from "../line/webhook.js";

class CaptureDb implements Queryable {
  queries: Array<{ sql: string; params?: unknown[] }> = [];
  async query<T = unknown>(sql: string, params?: unknown[]) {
    this.queries.push({ sql, params });
    return { rows: [] as T[], rowCount: 1 };
  }
}

class CaptureStorage implements Pick<PrivateStorage, "putObject"> {
  writes: StoredObject[] = [];
  async putObject(params: { namespace: string; fileName: string; body: Buffer; mimeType?: string }): Promise<StoredObject> {
    const object = {
      filePath: `private://${params.namespace}/${params.fileName}`,
      sha256: "fixture-sha256",
      bytes: params.body.length,
      mimeType: params.mimeType
    };
    this.writes.push(object);
    return object;
  }
}

export async function runLineWebhookFixtureTest(): Promise<Record<string, unknown>> {
  const database = new CaptureDb();
  const storage = new CaptureStorage();
  const seen = new Set<string>();
  const events: LineWebhookEvent[] = [
    textEvent("line-text-1", "/觀察 2330 台積電 半導體"),
    fileEvent("line-image-1", "image", "chart.png"),
    fileEvent("line-file-1", "file", "memo.pdf"),
    { webhookEventId: "line-unsend-1", type: "unsend", unsend: { messageId: "line-text-1" } }
  ];
  for (const event of events) {
    await processLineEvent(event, {
      database,
      storage: storage as unknown as PrivateStorage,
      seen,
      downloadContent: async (messageId) => ({
        fileName: `${messageId}.bin`,
        mimeType: messageId.includes("image") ? "image/png" : "application/pdf",
        body: Buffer.from(`fixture:${messageId}`)
      })
    });
  }
  const params = database.queries.flatMap((query) => query.params ?? []);
  return {
    ok: true,
    simulated_events: events.length,
    db_queries: database.queries.length,
    storage_writes: storage.writes.length,
    user_hash_saved: params.some((value) => typeof value === "string" && value.length >= 32),
    raw_user_id_saved: params.includes("Ufixture"),
    attachment_private_paths: storage.writes.map((write) => write.filePath)
  };
}

function textEvent(id: string, text: string): LineWebhookEvent {
  return {
    webhookEventId: id,
    type: "message",
    timestamp: Date.now(),
    source: { type: "group", userId: "Ufixture", groupId: "Gfixture" },
    message: { id, type: "text", text }
  };
}

function fileEvent(id: string, type: "image" | "file", fileName: string): LineWebhookEvent {
  return {
    webhookEventId: id,
    type: "message",
    timestamp: Date.now(),
    source: { type: "group", userId: "Ufixture", groupId: "Gfixture" },
    message: { id, type, fileName }
  };
}

if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  process.stdout.write(JSON.stringify(await runLineWebhookFixtureTest(), null, 2) + "\n");
}
