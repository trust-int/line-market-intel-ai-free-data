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
  collectedAt = new Date()
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
       interpretation_limit, collected_at, status, archived_at, archived_reason
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,coalesce($15::timestamptz, now()),'active',null,null)
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
       status = 'active',
       archived_at = null,
       archived_reason = null`,
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
