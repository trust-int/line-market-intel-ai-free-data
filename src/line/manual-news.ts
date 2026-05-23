import { createHash } from "node:crypto";
import type { Queryable } from "../db/client.js";

export type LineManualNewsKind = "news" | "manual";

export type LineManualNewsItem = {
  id: string;
  source: string;
  title: string;
  summary: string | null;
  full_text: null;
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
};

export function parseLineManualNewsText(
  text: string,
  kind: LineManualNewsKind,
  lineUserId: string,
  collectedAt = new Date()
): LineManualNewsItem | null {
  const prefix = kind === "news" ? "/news" : "/manual";
  if (!text.trim().toLowerCase().startsWith(prefix)) return null;
  const body = normalizeText(text.trim().slice(prefix.length));
  if (!body) return null;
  const timestamp = collectedAt.toISOString();
  const isManualPackNote = kind === "manual";
  const id = createHash("sha256").update(`${lineUserId}${body}${timestamp}`).digest("hex");

  return {
    id,
    source: isManualPackNote ? "line_manual_pack" : "line_manual",
    title: body.slice(0, 80),
    summary: body,
    full_text: null,
    source_url: null,
    related_tickers: extractTaiwanTickers(body),
    related_sectors: [],
    event_type: isManualPackNote ? "manual_pack_note" : "manual",
    importance: "medium",
    is_mops: false,
    data_quality_score: isManualPackNote ? 65 : 60,
    data_gaps: ["full_text_missing", "manual_source"],
    interpretation_limit: "title_or_summary_only",
    collected_at: timestamp
  };
}

export function buildLineImageNewsItem(messageId: string, collectedAt = new Date()): LineManualNewsItem {
  return {
    id: `line-image-${messageId}`,
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
    data_quality_score: 30,
    data_gaps: ["image_only", "ocr_not_available", "text_missing"],
    interpretation_limit: "image_without_ocr",
    collected_at: collectedAt.toISOString()
  };
}

export async function upsertLineManualNewsItem(database: Queryable, item: LineManualNewsItem): Promise<void> {
  await database.query(
    `insert into news_items (
       id, source, title, summary, full_text, source_url,
       related_tickers, related_sectors, event_type, importance,
       is_mops, data_quality_score, data_gaps,
       interpretation_limit, collected_at
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,coalesce($15::timestamptz, now()))
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
       collected_at = excluded.collected_at`,
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
      item.collected_at
    ]
  );
}

export function extractTaiwanTickers(text: string): string[] {
  return Array.from(new Set(text.match(/(?<!\d)\d{4}(?!\d)/g) ?? []));
}

export function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
