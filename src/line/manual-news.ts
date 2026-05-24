import type { Queryable } from "../db/client.js";
import { config } from "../config.js";
import { getTaipeiDateString } from "../utils/date.js";
import { sha256Hex } from "../utils/hash.js";

export type LineManualNewsKind = "news" | "manual";
export const LINE_MANUAL_NEWS_PARSER_VERSION = "line_manual_v2";

export type LineManualNewsItem = {
  id: string;
  source: string;
  title: string;
  summary: string | null;
  full_text: string | null;
  source_url: string | null;
  related_tickers: string[];
  related_sectors: string[];
  event_type: string;
  importance: "medium";
  is_mops: false;
  data_quality_score: number;
  data_gaps: string[];
  interpretation_limit: string;
  collected_at?: string;
  metadata?: Record<string, unknown>;
  raw_payload?: Record<string, unknown>;
  market_date?: string;
  parser_version?: string;
};

export type LineImageNewsBuildParams = {
  lineUserHash?: string;
  lineUserIdForHash?: string;
  messageId: string;
  imageHash?: string;
  imageSizeBytes?: number;
  imageWidth?: number;
  imageHeight?: number;
  imagePixels?: number;
  ocrProvider?: string;
  ocrEnabled: boolean;
  ocrStatus: "success" | "failed" | "disabled" | "too_large" | "provider_missing" | "error";
  ocrText?: string | null;
  collectedAt?: Date;
  mimeType?: string;
  filePath?: string;
};

export type LineFileNewsBuildParams = {
  lineUserHash?: string;
  lineUserIdForHash?: string;
  messageId: string;
  fileName?: string;
  fileHash?: string;
  fileSizeBytes?: number;
  fileType?: string;
  mimeType?: string;
  filePath?: string;
  extractionStatus: "success" | "empty" | "unsupported" | "too_large" | "disabled" | "error";
  extractedText?: string | null;
  extractionDataGaps?: string[];
  extractionMetadata?: Record<string, unknown>;
  collectedAt?: Date;
};

const sectorRules: Array<{ sector: string; keywords: string[] }> = [
  { sector: "AI伺服器", keywords: ["AI", "AI伺服器", "GB200", "伺服器"] },
  { sector: "PCB", keywords: ["PCB", "ABF", "CCL", "載板"] },
  { sector: "散熱", keywords: ["散熱", "水冷", "液冷"] },
  { sector: "記憶體", keywords: ["DRAM", "NAND", "記憶體"] },
  { sector: "半導體封測", keywords: ["CoWoS", "先進封裝", "封測"] },
  { sector: "機器人", keywords: ["機器人"] },
  { sector: "軍工", keywords: ["軍工", "無人機"] }
];

export function parseLineManualNewsText(
  text: string,
  kind: LineManualNewsKind,
  messageId: string,
  collectedAt = new Date(),
  lineUserHash?: string
): LineManualNewsItem | null {
  const prefix = kind === "news" ? "/news" : "/manual";
  if (!text.trim().toLowerCase().startsWith(prefix)) return null;
  const body = normalizeText(text.trim().slice(prefix.length));
  if (!body) return null;
  const timestamp = collectedAt.toISOString();
  const isManualPackNote = kind === "manual";
  const sourceUrl = extractFirstUrl(body);
  const bodyWithoutUrls = normalizeText(body.replace(/https?:\/\/\S+/gi, ""));
  const urlOnly = Boolean(sourceUrl) && bodyWithoutUrls.length === 0;
  const baseScore = urlOnly ? 45 : body.length >= 80 ? 65 : 55;
  const dataGaps = [
    "full_text_missing",
    !sourceUrl && "source_url_missing",
    body.length < 80 && "summary_too_short"
  ].filter((gap): gap is string => Boolean(gap));

  return {
    id: `line-${kind}-${messageId}`,
    source: isManualPackNote ? "line_manual_pack" : "line_manual",
    title: body.slice(0, 80),
    summary: body,
    full_text: null,
    source_url: sourceUrl,
    related_tickers: extractTaiwanTickers(body),
    related_sectors: classifyRelatedSectors(body),
    event_type: isManualPackNote ? "manual_pack_note" : "manual",
    importance: "medium",
    is_mops: false,
    data_quality_score: isManualPackNote ? Math.min(baseScore + 5, 70) : baseScore,
    data_gaps: dataGaps,
    interpretation_limit: urlOnly ? "link_only" : body.length >= 80 ? "title_or_summary_only" : "brief_manual_note_only",
    collected_at: timestamp,
    market_date: getTaipeiDateString(collectedAt),
    parser_version: LINE_MANUAL_NEWS_PARSER_VERSION,
    raw_payload: {
      raw_text: text,
      line_message_type: "text",
      line_message_id: messageId,
      line_user_id_hash: lineUserHash,
      received_at: timestamp,
      parser_version: LINE_MANUAL_NEWS_PARSER_VERSION
    }
  };
}

export function buildLineImageNewsItem(
  messageId: string,
  collectedAt = new Date(),
  overrides: Partial<Pick<LineManualNewsItem, "id" | "data_quality_score" | "data_gaps" | "metadata" | "raw_payload">> = {}
): LineManualNewsItem {
  return {
    id: overrides.id ?? `line-image-${messageId}`,
    source: "line_image_manual",
    title: "LINE image message",
    summary: null,
    full_text: null,
    source_url: null,
    related_tickers: [],
    related_sectors: [],
    event_type: "image_manual",
    importance: "medium",
    is_mops: false,
    data_quality_score: overrides.data_quality_score ?? 30,
    data_gaps: overrides.data_gaps ?? ["image_only", "ocr_not_available", "text_missing"],
    interpretation_limit: "image_without_ocr",
    collected_at: collectedAt.toISOString(),
    market_date: getTaipeiDateString(collectedAt),
    parser_version: LINE_MANUAL_NEWS_PARSER_VERSION,
    metadata: overrides.metadata,
    raw_payload: overrides.raw_payload
  };
}

export function buildLineImageNewsItemFromOcr(params: LineImageNewsBuildParams): LineManualNewsItem {
  const collectedAt = params.collectedAt ?? new Date();
  const metadata = buildImageMetadata(params);
  const hashInput = `${params.lineUserIdForHash ?? params.lineUserHash ?? "unknown"}:${params.messageId}:${params.imageHash ?? ""}`;
  const id = `line-image-ocr-${sha256Hex(hashInput)}`;

  if (params.ocrStatus === "success" && params.ocrText) {
    const ocrText = params.ocrText.slice(0, 4000);
    const dataGaps = [
      "ocr_extracted_text",
      "source_url_missing",
      ocrText.length < 80 && "summary_too_short",
      extractTaiwanTickers(ocrText).length === 0 && "related_tickers_missing",
      classifyRelatedSectors(ocrText).length === 0 && "related_sectors_missing"
    ].filter((gap): gap is string => Boolean(gap));

    return {
      id,
      source: "line_image_ocr",
      title: normalizeText(ocrText).slice(0, 80) || "LINE image OCR",
      summary: ocrText.slice(0, config.fileTextMaxChars),
      full_text: ocrText.slice(0, config.fileFullTextMaxChars),
      source_url: null,
      related_tickers: extractTaiwanTickers(ocrText),
      related_sectors: classifyRelatedSectors(ocrText),
      event_type: "image_ocr",
      importance: "medium",
      is_mops: false,
      data_quality_score: ocrText.length >= 80 ? 70 : 55,
      data_gaps: dataGaps,
      interpretation_limit: ocrText.length >= 80 ? "ocr_text_available" : "brief_ocr_text_only",
      collected_at: collectedAt.toISOString(),
      market_date: getTaipeiDateString(collectedAt),
      parser_version: LINE_MANUAL_NEWS_PARSER_VERSION,
      raw_payload: buildImageRawPayload(params, collectedAt),
      metadata
    };
  }

  const statusGaps = getImageOnlyGaps(params.ocrStatus);
  const score = params.ocrStatus === "too_large" ? 25 : 30;
  return buildLineImageNewsItem(params.messageId, collectedAt, {
    id: `line-image-${sha256Hex(hashInput)}`,
    data_quality_score: score,
    data_gaps: statusGaps,
    raw_payload: buildImageRawPayload(params, collectedAt),
    metadata
  });
}

export function buildLineFileNewsItemFromExtraction(params: LineFileNewsBuildParams): LineManualNewsItem {
  const collectedAt = params.collectedAt ?? new Date();
  const metadata = buildFileMetadata(params);
  const hashInput = `${params.lineUserIdForHash ?? params.lineUserHash ?? "unknown"}:${params.messageId}:${params.fileHash ?? ""}`;

  if (params.extractionStatus === "success" && params.extractedText) {
    const text = params.extractedText;
    const dataGaps = [
      "file_extracted_text",
      "source_url_missing",
      text.length < 80 && "summary_too_short",
      extractTaiwanTickers(text).length === 0 && "related_tickers_missing",
      classifyRelatedSectors(text).length === 0 && "related_sectors_missing"
    ].filter((gap): gap is string => Boolean(gap));

    return {
      id: `line-file-text-${sha256Hex(hashInput)}`,
      source: "line_file_text",
      title: normalizeText(`${params.fileName ?? ""} ${text.slice(0, 80)}`).slice(0, 120) || "LINE file text",
      summary: text.slice(0, config.fileTextMaxChars),
      full_text: text.slice(0, config.fileFullTextMaxChars),
      source_url: null,
      related_tickers: extractTaiwanTickers(text),
      related_sectors: classifyRelatedSectors(text),
      event_type: "file_text",
      importance: "medium",
      is_mops: false,
      data_quality_score: text.length >= 200 ? 75 : text.length >= 80 ? 65 : 55,
      data_gaps: dataGaps,
      interpretation_limit: text.length >= 200 ? "file_text_available" : text.length >= 80 ? "short_file_text_available" : "brief_file_text_only",
      collected_at: collectedAt.toISOString(),
      market_date: getTaipeiDateString(collectedAt),
      parser_version: LINE_MANUAL_NEWS_PARSER_VERSION,
      raw_payload: buildFileRawPayload(params, collectedAt),
      metadata
    };
  }

  const dataGaps = params.extractionDataGaps?.length ? params.extractionDataGaps : getFileOnlyGaps(params.extractionStatus);
  return {
    id: `line-file-${sha256Hex(hashInput)}`,
    source: "line_file_manual",
    title: params.fileName || "LINE file message",
    summary: null,
    full_text: null,
    source_url: null,
    related_tickers: [],
    related_sectors: [],
    event_type: "file_manual",
    importance: "medium",
    is_mops: false,
    data_quality_score: params.extractionStatus === "too_large" ? 25 : 30,
    data_gaps: dataGaps,
    interpretation_limit: "file_without_text",
    collected_at: collectedAt.toISOString(),
    market_date: getTaipeiDateString(collectedAt),
    parser_version: LINE_MANUAL_NEWS_PARSER_VERSION,
    raw_payload: buildFileRawPayload(params, collectedAt),
    metadata
  };
}

export async function upsertLineManualNewsItem(database: Queryable, item: LineManualNewsItem): Promise<void> {
  await database.query(
    `insert into news_items (
       id, source, title, summary, full_text, source_url,
       related_tickers, related_sectors, event_type, importance,
       is_mops, data_quality_score, data_gaps,
       interpretation_limit, collected_at, metadata, archived, archived_at, archived_reason,
       raw_payload, market_date, parser_version, status
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,coalesce($15::timestamptz, now()),coalesce($16::jsonb, '{}'::jsonb),false,null,null,coalesce($17::jsonb, '{}'::jsonb),$18::date,$19,'active')
     on conflict (id) do update set
       source = excluded.source,
       title = excluded.title,
       summary = excluded.summary,
       full_text = excluded.full_text,
       source_url = excluded.source_url,
       related_tickers = excluded.related_tickers,
       related_sectors = excluded.related_sectors,
       event_type = excluded.event_type,
       importance = excluded.importance,
       is_mops = excluded.is_mops,
       data_quality_score = excluded.data_quality_score,
       data_gaps = excluded.data_gaps,
       interpretation_limit = excluded.interpretation_limit,
       collected_at = excluded.collected_at,
       metadata = excluded.metadata,
       archived = false,
       status = 'active',
       archived_at = null,
       archived_reason = null,
       raw_payload = excluded.raw_payload,
       market_date = excluded.market_date,
       parser_version = excluded.parser_version`,
    [
      item.id,
      item.source,
      item.title,
      item.summary,
      item.full_text,
      item.source_url,
      JSON.stringify(item.related_tickers),
      JSON.stringify(item.related_sectors),
      item.event_type,
      item.importance,
      item.is_mops,
      item.data_quality_score,
      JSON.stringify(item.data_gaps),
      item.interpretation_limit,
      item.collected_at,
      JSON.stringify(item.metadata ?? {}),
      JSON.stringify(item.raw_payload ?? {}),
      item.market_date ?? getTaipeiDateString(item.collected_at ? new Date(item.collected_at) : new Date()),
      item.parser_version ?? LINE_MANUAL_NEWS_PARSER_VERSION
    ]
  );
}

export function extractTaiwanTickers(text: string): string[] {
  return Array.from(new Set(text.match(/(?<!\d)\d{4}(?!\d)/g) ?? []));
}

export function extractFirstUrl(text: string): string | null {
  return text.match(/https?:\/\/\S+/i)?.[0] ?? null;
}

export function classifyRelatedSectors(text: string): string[] {
  const upperText = text.toUpperCase();
  return sectorRules
    .filter((rule) => rule.keywords.some((keyword) => upperText.includes(keyword.toUpperCase())))
    .map((rule) => rule.sector);
}

export function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function buildImageMetadata(params: LineImageNewsBuildParams): Record<string, unknown> {
  return {
    user_hash: params.lineUserHash,
    message_id: params.messageId,
    message_type: "image",
    image_hash: params.imageHash,
    image_size_bytes: params.imageSizeBytes,
    image_width: params.imageWidth,
    image_height: params.imageHeight,
    image_pixels: params.imagePixels,
    mime_type: params.mimeType,
    file_path: params.filePath,
    ocr_provider: params.ocrProvider ?? "tesseract",
    ocr_enabled: params.ocrEnabled,
    ocr_status: params.ocrStatus,
    ocr_text_length: params.ocrText?.length ?? 0
  };
}

function buildImageRawPayload(params: LineImageNewsBuildParams, collectedAt: Date): Record<string, unknown> {
  return {
    line_message_type: "image",
    line_message_id: params.messageId,
    line_user_id_hash: params.lineUserHash,
    image_hash: params.imageHash,
    file_size_bytes: params.imageSizeBytes,
    image_width: params.imageWidth,
    image_height: params.imageHeight,
    image_pixels: params.imagePixels,
    mime_type: params.mimeType,
    file_path: params.filePath,
    received_at: collectedAt.toISOString(),
    parser_version: LINE_MANUAL_NEWS_PARSER_VERSION
  };
}

function getImageOnlyGaps(status: LineImageNewsBuildParams["ocrStatus"]): string[] {
  if (status === "disabled") return ["image_only", "ocr_not_available", "text_missing"];
  if (status === "too_large") return ["image_only", "image_too_large", "ocr_skipped", "text_missing"];
  if (status === "provider_missing") return ["image_only", "ocr_failed", "ocr_provider_missing", "text_missing"];
  return ["image_only", "ocr_failed", "text_missing"];
}

function buildFileMetadata(params: LineFileNewsBuildParams): Record<string, unknown> {
  return {
    ...(params.extractionMetadata ?? {}),
    user_hash: params.lineUserHash,
    message_id: params.messageId,
    message_type: "file",
    filename: params.fileName,
    file_hash: params.fileHash,
    file_size_bytes: params.fileSizeBytes,
    mime_type: params.mimeType,
    file_path: params.filePath,
    file_type: params.fileType,
    extraction_status: params.extractionStatus,
    extracted_text_length: params.extractedText?.length ?? 0
  };
}

function buildFileRawPayload(params: LineFileNewsBuildParams, collectedAt: Date): Record<string, unknown> {
  return {
    line_message_type: "file",
    line_message_id: params.messageId,
    line_user_id_hash: params.lineUserHash,
    filename: params.fileName,
    file_size_bytes: params.fileSizeBytes,
    file_type: params.fileType,
    mime_type: params.mimeType,
    file_path: params.filePath,
    received_at: collectedAt.toISOString(),
    parser_version: LINE_MANUAL_NEWS_PARSER_VERSION
  };
}

function getFileOnlyGaps(status: LineFileNewsBuildParams["extractionStatus"]): string[] {
  if (status === "disabled") return ["file_only", "file_ingest_disabled", "text_missing"];
  if (status === "too_large") return ["file_only", "file_too_large", "text_extraction_skipped", "text_missing"];
  if (status === "unsupported") return ["file_only", "file_type_not_supported", "text_missing"];
  return ["file_only", "text_extraction_failed", "text_missing"];
}
