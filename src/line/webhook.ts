import type { Request, Response, Router } from "express";
import express from "express";
import { config } from "../config.js";
import type { Queryable } from "../db/client.js";
import { db } from "../db/client.js";
import { PrivateStorage } from "../storage/storage.js";
import type { StorageProvider } from "../storage/storage.js";
import { logger } from "../utils/logger.js";
import { downloadLineMessageContent } from "./download.js";
import { replyLineText } from "./push.js";
import { hashLineUserId, verifyLineSignature } from "./signature.js";
import { handleLineCommand } from "./commands.js";
import { buildLineImageNewsItem, parseLineManualNewsText, upsertLineManualNewsItem } from "./manual-news.js";

type ManualNewsAuth = {
  allowedUserIds?: string[];
  allowedUserHashes?: string[];
};

export type LineWebhookEvent = {
  webhookEventId?: string;
  type: string;
  timestamp?: number;
  replyToken?: string;
  source?: {
    type?: string;
    userId?: string;
    groupId?: string;
    roomId?: string;
  };
  message?: {
    id: string;
    type: "text" | "image" | "file" | "video" | "audio" | string;
    text?: string;
    fileName?: string;
  };
  unsend?: {
    messageId: string;
  };
};

export type LineWebhookBody = {
  destination?: string;
  events: LineWebhookEvent[];
};

export type LineWebhookDeps = {
  database?: Queryable;
  storage?: StorageProvider;
  downloadContent?: typeof downloadLineMessageContent;
  replyText?: typeof replyLineText;
  seen?: Set<string>;
  manualNewsAuth?: ManualNewsAuth;
};

const defaultSeen = new Set<string>();

export function createLineWebhookRouter(deps: LineWebhookDeps = {}): Router {
  const router = express.Router();
  router.post("/webhook", express.raw({ type: "*/*" }), async (req: Request, res: Response) => {
    const signature = req.header("x-line-signature") ?? undefined;
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(String(req.body ?? ""));
    const accepted = await acceptLineWebhook(rawBody, signature, deps);
    res.status(accepted.ok ? 200 : 401).json(accepted);
  });
  return router;
}

export async function acceptLineWebhook(
  rawBody: Buffer,
  signature: string | undefined,
  deps: LineWebhookDeps = {}
): Promise<{ ok: boolean; reason?: string; acceptedEvents?: number }> {
  if (!verifyLineSignature(rawBody, signature, config.lineChannelSecret)) {
    return { ok: false, reason: "invalid_line_signature" };
  }

  let body: LineWebhookBody;
  try {
    body = JSON.parse(rawBody.toString("utf8")) as LineWebhookBody;
  } catch {
    return { ok: false, reason: "invalid_json" };
  }

  queueMicrotask(() => {
    void Promise.all(body.events.map((event) => processLineEvent(event, deps))).catch((error) => {
      logger.error("LINE event processing failed", { error: String(error) });
    });
  });

  return { ok: true, acceptedEvents: body.events.length };
}

export async function processLineEvent(event: LineWebhookEvent, deps: LineWebhookDeps = {}): Promise<void> {
  const database = deps.database ?? db;
  const storage = deps.storage ?? new PrivateStorage();
  const downloadContent = deps.downloadContent ?? downloadLineMessageContent;
  const replyText = deps.replyText ?? replyLineText;
  const seen = deps.seen ?? defaultSeen;
  const eventId = event.webhookEventId ?? buildFallbackEventId(event);

  if (seen.has(eventId)) return;
  seen.add(eventId);

  if (event.type === "unsend" && event.unsend?.messageId) {
    await markUnsent(database, event.unsend.messageId);
    return;
  }

  if (event.type !== "message" || !event.message) return;

  const base = {
    webhook_event_id: eventId,
    source_type: event.source?.type,
    group_id: event.source?.groupId,
    room_id: event.source?.roomId,
    user_hash: hashLineUserId(event.source?.userId),
    message_id: event.message.id,
    message_type: event.message.type,
    raw_text: event.message.text,
    message_time: event.timestamp ? new Date(event.timestamp).toISOString() : undefined
  };

  if (event.message.type === "text") {
    const text = event.message.text ?? "";
    await insertLineMessage(database, base);
    const manualKind = detectManualNewsKind(text);
    if (manualKind) {
      if (!isAuthorizedManualNewsUser(event.source?.userId, base.user_hash, deps.manualNewsAuth)) {
        logger.warn("unauthorized LINE manual news ingestion", {
          has_line_user_id: Boolean(event.source?.userId),
          user_hash: base.user_hash
        });
        await replyText(event.replyToken, "unauthorized");
        return;
      }
      const manualNews = parseLineManualNewsText(
        text,
        manualKind,
        event.message.id,
        event.timestamp ? new Date(event.timestamp) : new Date()
      );
      if (!manualNews) {
        await replyText(event.replyToken, manualKind === "news" ? "格式：/news 文字內容" : "格式：/manual 文字內容");
        return;
      }
      await upsertLineManualNewsItem(database, manualNews);
      await replyText(event.replyToken, "已收錄到今日 manual news，可由 /gpt/news/today/summary 讀取。");
      return;
    }
    if (text.startsWith("/")) {
      const result = await handleLineCommand(text, {
        database,
        scope: {
          scopeType: event.source?.groupId ? "group" : event.source?.roomId ? "room" : "user",
          scopeId: event.source?.groupId ?? event.source?.roomId ?? base.user_hash,
          userHash: base.user_hash
        }
      });
      if (result.handled && result.replyText) {
        await replyText(event.replyToken, result.replyText);
      }
      logger.info("LINE command handled", { command: result.command, handled: result.handled });
    }
    return;
  }

  if (event.message.type === "image") {
    let fileRow: Record<string, unknown> = {};
    try {
      const downloaded = await downloadContent(event.message.id);
      const stored = await storage.putObject({
        namespace: "line",
        fileName: event.message.fileName ?? downloaded.fileName,
        body: downloaded.body,
        mimeType: downloaded.mimeType
      });
      fileRow = {
        file_name: event.message.fileName ?? downloaded.fileName,
        mime_type: downloaded.mimeType,
        file_path: stored.filePath,
        content_sha256: stored.sha256
      };
    } catch (error) {
      logger.warn("LINE image download failed; preserving message id only", { error: String(error), messageId: event.message.id });
    }
    await insertLineMessage(database, {
      ...base,
      ...fileRow
    });
    await upsertLineManualNewsItem(database, buildLineImageNewsItem(event.message.id, event.timestamp ? new Date(event.timestamp) : new Date()));
    await replyText(event.replyToken, "已收到圖片，但目前尚未 OCR，請補文字摘要或原始連結。");
    return;
  }

  if (event.message.type === "file") {
    const downloaded = await downloadContent(event.message.id);
    const stored = await storage.putObject({
      namespace: "line",
      fileName: event.message.fileName ?? downloaded.fileName,
      body: downloaded.body,
      mimeType: downloaded.mimeType
    });
    await insertLineMessage(database, {
      ...base,
      file_name: event.message.fileName ?? downloaded.fileName,
      mime_type: downloaded.mimeType,
      file_path: stored.filePath,
      content_sha256: stored.sha256
    });
  }
}

async function insertLineMessage(database: Queryable, row: Record<string, unknown>): Promise<void> {
  await database.query(
    `insert into line_messages (
      webhook_event_id, source_type, group_id, room_id, user_hash, message_id,
      message_type, raw_text, file_name, mime_type, file_path, content_sha256, message_time
    ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
    on conflict (webhook_event_id) do nothing`,
    [
      row.webhook_event_id,
      row.source_type,
      row.group_id,
      row.room_id,
      row.user_hash,
      row.message_id,
      row.message_type,
      row.raw_text,
      row.file_name,
      row.mime_type,
      row.file_path,
      row.content_sha256,
      row.message_time
    ]
  );
}

async function markUnsent(database: Queryable, messageId: string): Promise<void> {
  await database.query(
    `update line_messages set status = 'unsent', raw_text = null, extracted_text = null, ai_summary = null
     where message_id = $1`,
    [messageId]
  );
}

function buildFallbackEventId(event: LineWebhookEvent): string {
  const messagePart = event.message?.id ?? event.unsend?.messageId ?? "unknown";
  return `${event.type}:${messagePart}:${event.timestamp ?? 0}`;
}

function detectManualNewsKind(text?: string): "news" | "manual" | undefined {
  const normalized = text?.trim().toLowerCase() ?? "";
  if (normalized === "/news" || normalized.startsWith("/news ")) return "news";
  if (normalized === "/manual" || normalized.startsWith("/manual ")) return "manual";
  return undefined;
}

function isAuthorizedManualNewsUser(lineUserId?: string, userHash?: string, auth: ManualNewsAuth = {}): boolean {
  const allowedUserIds = auth.allowedUserIds ?? config.lineAllowedUserIds;
  const allowedUserHashes = auth.allowedUserHashes ?? config.lineAllowedUserHashes;
  if (allowedUserIds.length === 0 && allowedUserHashes.length === 0) return true;
  return Boolean(
    (lineUserId && allowedUserIds.includes(lineUserId)) ||
    (userHash && allowedUserHashes.includes(userHash))
  );
}
