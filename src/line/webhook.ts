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
import { detectImageDimensions } from "./image-dimensions.js";
import { buildLineFileNewsItemFromExtraction, buildLineImageNewsItemFromOcr, parseLineManualNewsText, upsertLineManualNewsItem } from "./manual-news.js";
import type { OcrConfig, OcrErrorCode, OcrService, OcrStatus } from "./ocr-service.js";
import { resolveOcrConfig, TesseractCliOcrService } from "./ocr-service.js";
import { safeOcrErrorSummary } from "./ocr-service.js";
import type { FileIngestConfig, FileTextExtractor } from "./file-text-extractor.js";
import { DefaultFileTextExtractor, detectFileType, resolveFileIngestConfig } from "./file-text-extractor.js";

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
  ocrConfig?: Partial<OcrConfig>;
  ocrService?: OcrService;
  fileIngestConfig?: Partial<FileIngestConfig>;
  fileTextExtractor?: FileTextExtractor;
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
        event.timestamp ? new Date(event.timestamp) : new Date(),
        base.user_hash
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
      if (text.trim() === "/清空今日新聞" && !isAuthorizedManualNewsUser(event.source?.userId, base.user_hash, deps.manualNewsAuth)) {
        await replyText(event.replyToken, "unauthorized");
        return;
      }
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
    const ocrConfig = resolveOcrConfig(deps.ocrConfig);
    if (!isAuthorizedManualNewsUser(event.source?.userId, base.user_hash, deps.manualNewsAuth)) {
      logger.warn("unauthorized LINE image ingestion", {
        has_line_user_id: Boolean(event.source?.userId),
        user_hash: base.user_hash
      });
      logLineImageOcr("warn", {
        lineUserAuthorized: false,
        messageId: event.message.id,
        downloadStatus: "skipped",
        ocrEnabled: ocrConfig.enabled,
        tesseractFound: null,
        ocrLang: ocrConfig.lang,
        ocrStatus: "skipped_unauthorized",
        ocrTextLength: 0,
        dataGaps: ["unauthorized"]
      });
      await replyText(event.replyToken, "unauthorized");
      return;
    }

    const collectedAt = event.timestamp ? new Date(event.timestamp) : new Date();
    const ocrService = deps.ocrService ?? new TesseractCliOcrService(ocrConfig);
    let fileRow: Record<string, unknown> = {};
    try {
      const downloaded = await downloadContent(event.message.id);
      const imageDimensions = detectImageDimensions(downloaded.body);
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
      await insertLineMessage(database, {
        ...base,
        ...fileRow
      });

      const imageBase = {
        lineUserHash: base.user_hash,
        lineUserIdForHash: event.source?.userId,
        messageId: event.message.id,
        imageHash: stored.sha256,
        imageSizeBytes: stored.bytes,
        imageWidth: imageDimensions?.width,
        imageHeight: imageDimensions?.height,
        imagePixels: imageDimensions?.pixels,
        ocrProvider: ocrConfig.provider,
        ocrLang: ocrConfig.lang,
        ocrEnabled: ocrConfig.enabled,
        collectedAt,
        mimeType: stored.mimeType,
        filePath: stored.filePath
      };

      if (!ocrConfig.enabled) {
        const item = buildLineImageNewsItemFromOcr({ ...imageBase, ocrStatus: "disabled", tesseractFound: null });
        await upsertLineManualNewsItem(database, item);
        logLineImageOcr("info", {
          lineUserAuthorized: true,
          messageId: event.message.id,
          downloadStatus: "success",
          imageSizeBytes: stored.bytes,
          ocrEnabled: ocrConfig.enabled,
          tesseractFound: null,
          ocrLang: ocrConfig.lang,
          ocrStatus: "disabled",
          ocrTextLength: 0,
          dataGaps: item.data_gaps
        });
        await replyText(event.replyToken, imageOcrReply("disabled"));
        return;
      }

      if (stored.bytes > ocrConfig.maxImageBytes || (imageDimensions?.pixels ?? 0) > ocrConfig.maxImagePixels) {
        const reason = stored.bytes > ocrConfig.maxImageBytes
          ? `image bytes ${stored.bytes} exceeds max ${ocrConfig.maxImageBytes}`
          : `image pixels ${imageDimensions?.pixels ?? 0} exceeds max ${ocrConfig.maxImagePixels}`;
        const item = buildLineImageNewsItemFromOcr({
          ...imageBase,
          ocrStatus: "too_large",
          ocrErrorCode: "TOO_LARGE",
          ocrErrorMessage: reason,
          tesseractFound: null
        });
        await upsertLineManualNewsItem(database, item);
        logLineImageOcr("warn", {
          lineUserAuthorized: true,
          messageId: event.message.id,
          downloadStatus: "success",
          imageSizeBytes: stored.bytes,
          ocrEnabled: ocrConfig.enabled,
          tesseractFound: null,
          ocrLang: ocrConfig.lang,
          ocrStatus: "too_large",
          ocrTextLength: 0,
          ocrErrorCode: "TOO_LARGE",
          dataGaps: item.data_gaps
        });
        await replyText(event.replyToken, imageOcrReply("too_large"));
        return;
      }

      let ocrStatus: OcrStatus = "failed";
      let ocrText: string | null = null;
      let ocrErrorCode: OcrErrorCode | null = null;
      let ocrErrorMessage: string | null = null;
      try {
        const result = await ocrService.recognizeImage({
          imagePath: stored.filePath,
          imageBytes: stored.bytes,
          imagePixels: imageDimensions?.pixels
        });
        ocrStatus = result.status;
        ocrText = result.text;
        ocrErrorCode = result.errorCode ?? null;
        ocrErrorMessage = result.error ?? null;
      } catch (error) {
        ocrErrorMessage = safeOcrErrorSummary(error);
        logger.warn("LINE image OCR failed", { error: ocrErrorMessage, messageId: event.message.id });
        ocrStatus = "failed";
        ocrErrorCode = "EXEC_ERROR";
      }
      const tesseractFound = inferTesseractFound(ocrStatus);
      const item = buildLineImageNewsItemFromOcr({
        ...imageBase,
        ocrStatus,
        ocrText,
        ocrErrorCode,
        ocrErrorMessage,
        tesseractFound
      });
      await upsertLineManualNewsItem(database, item);
      logLineImageOcr(ocrStatus === "success" ? "info" : "warn", {
        lineUserAuthorized: true,
        messageId: event.message.id,
        downloadStatus: "success",
        imageSizeBytes: stored.bytes,
        ocrEnabled: ocrConfig.enabled,
        tesseractFound,
        ocrLang: ocrConfig.lang,
        ocrStatus,
        ocrTextLength: ocrText?.length ?? 0,
        ocrErrorCode,
        dataGaps: item.data_gaps
      });
      await replyText(event.replyToken, imageOcrReply(ocrStatus));
      return;
    } catch (error) {
      const ocrErrorMessage = safeOcrErrorSummary(error);
      logger.warn("LINE image download failed; preserving message id only", { error: ocrErrorMessage, messageId: event.message.id });
      await insertLineMessage(database, {
        ...base,
        ...fileRow
      });
      const item = buildLineImageNewsItemFromOcr({
        lineUserHash: base.user_hash,
        lineUserIdForHash: event.source?.userId,
        messageId: event.message.id,
        ocrProvider: ocrConfig.provider,
        ocrLang: ocrConfig.lang,
        ocrEnabled: ocrConfig.enabled,
        ocrStatus: "failed",
        ocrErrorCode: "DOWNLOAD_ERROR",
        ocrErrorMessage,
        tesseractFound: null,
        collectedAt
      });
      await upsertLineManualNewsItem(database, item);
      logLineImageOcr("warn", {
        lineUserAuthorized: true,
        messageId: event.message.id,
        downloadStatus: "failed",
        ocrEnabled: ocrConfig.enabled,
        tesseractFound: null,
        ocrLang: ocrConfig.lang,
        ocrStatus: "failed",
        ocrTextLength: 0,
        ocrErrorCode: "DOWNLOAD_ERROR",
        dataGaps: item.data_gaps
      });
      await replyText(event.replyToken, imageOcrReply("failed"));
      return;
    }
  }

  if (event.message.type === "file") {
    if (!isAuthorizedManualNewsUser(event.source?.userId, base.user_hash, deps.manualNewsAuth)) {
      logger.warn("unauthorized LINE file ingestion", {
        has_line_user_id: Boolean(event.source?.userId),
        user_hash: base.user_hash
      });
      await replyText(event.replyToken, "unauthorized");
      return;
    }

    const collectedAt = event.timestamp ? new Date(event.timestamp) : new Date();
    const fileIngestConfig = resolveFileIngestConfig(deps.fileIngestConfig);
    const fileTextExtractor = deps.fileTextExtractor ?? new DefaultFileTextExtractor(fileIngestConfig);
    try {
      const downloaded = await downloadContent(event.message.id);
      const fileName = event.message.fileName ?? downloaded.fileName;
      const stored = await storage.putObject({
        namespace: "line",
        fileName,
        body: downloaded.body,
        mimeType: downloaded.mimeType
      });
      await insertLineMessage(database, {
        ...base,
        file_name: fileName,
        mime_type: downloaded.mimeType,
        file_path: stored.filePath,
        content_sha256: stored.sha256
      });

      const extraction = await fileTextExtractor.extractText({
        body: downloaded.body,
        fileName,
        mimeType: downloaded.mimeType
      });
      await upsertLineManualNewsItem(
        database,
        buildLineFileNewsItemFromExtraction({
          lineUserHash: base.user_hash,
          lineUserIdForHash: event.source?.userId,
          messageId: event.message.id,
          fileName,
          fileHash: stored.sha256,
          fileSizeBytes: stored.bytes,
          fileType: extraction.fileType,
          mimeType: stored.mimeType,
          filePath: stored.filePath,
          extractionStatus: extraction.status,
          extractedText: extraction.text,
          extractionDataGaps: extraction.dataGaps,
          extractionMetadata: extraction.metadata,
          collectedAt
        })
      );
      await replyText(event.replyToken, fileExtractionReply(extraction.status));
      return;
    } catch (error) {
      logger.warn("LINE file download or text extraction failed", { error: String(error), messageId: event.message.id });
      await insertLineMessage(database, base);
      await upsertLineManualNewsItem(
        database,
        buildLineFileNewsItemFromExtraction({
          lineUserHash: base.user_hash,
          lineUserIdForHash: event.source?.userId,
          messageId: event.message.id,
          fileName: event.message.fileName ?? "LINE file message",
          fileType: detectFileType(event.message.fileName ?? ""),
          extractionStatus: "error",
          extractionDataGaps: ["file_only", "text_extraction_failed", "text_missing"],
          extractionMetadata: { error: String(error).slice(0, 240) },
          collectedAt
        })
      );
      await replyText(event.replyToken, fileExtractionReply("error"));
      return;
    }
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

function inferTesseractFound(status: OcrStatus): boolean | null {
  if (status === "provider_missing") return false;
  if (status === "disabled" || status === "too_large") return null;
  return true;
}

function logLineImageOcr(
  level: "info" | "warn",
  context: {
    lineUserAuthorized: boolean;
    messageId: string;
    downloadStatus: "success" | "failed" | "skipped";
    imageSizeBytes?: number;
    ocrEnabled: boolean;
    tesseractFound: boolean | null;
    ocrLang: string;
    ocrStatus: string;
    ocrTextLength: number;
    ocrErrorCode?: OcrErrorCode | null;
    dataGaps: string[];
  }
): void {
  logger[level]("line_image_ocr", {
    event: "line_image_ocr",
    line_user_authorized: context.lineUserAuthorized,
    message_id: context.messageId,
    download_status: context.downloadStatus,
    image_size_bytes: context.imageSizeBytes ?? null,
    ocr_enabled: context.ocrEnabled,
    tesseract_found: context.tesseractFound,
    ocr_lang: context.ocrLang,
    ocr_status: context.ocrStatus,
    ocr_text_length: context.ocrTextLength,
    ocr_error_code: context.ocrErrorCode ?? null,
    data_gaps: context.dataGaps
  });
}

function imageOcrReply(status: OcrStatus): string {
  if (status === "success") {
    return "已收到圖片並完成 OCR，已收錄到今日 manual news，可由 /gpt/news/today/summary 讀取。";
  }
  if (status === "disabled") {
    return "已收到圖片，但目前 OCR 未啟用。請補 /news 文字摘要或原始連結。";
  }
  if (status === "too_large") {
    return "已收到圖片，但圖片過大，已略過 OCR。請補 /news 文字摘要或原始連結。";
  }
  return "已收到圖片，但 OCR 未取得有效文字。請補 /news 文字摘要或原始連結。";
}

function fileExtractionReply(status: "success" | "empty" | "unsupported" | "too_large" | "disabled" | "error"): string {
  if (status === "success") {
    return "已收到檔案並讀取文字，已收錄到今日 manual news。";
  }
  return "已收到檔案，但目前未讀取到有效文字。請補 /news 文字摘要或改傳可選取文字的 PDF / TXT。";
}
