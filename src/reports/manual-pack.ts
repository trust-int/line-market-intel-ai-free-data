import { todayTaipei } from "../utils/date.js";
import { buildManualGptPack, writeManualGptPack } from "../extract/manual-pack.js";
import type { ManualPackInput } from "../extract/schemas.js";
import type { Queryable } from "../db/client.js";
import { db } from "../db/client.js";
import { ManualGptPacksRepo } from "../repositories/manual-gpt-packs.repo.js";

export { buildManualGptPack, writeManualGptPack } from "../extract/manual-pack.js";
export type { ManualGptPack } from "../extract/manual-pack.js";

type LineManualPackScope = {
  scopeType?: "user" | "group" | "room";
  scopeId?: string;
};

type LineMessageRow = {
  source_type?: string;
  message_id?: string;
  message_type: string;
  raw_text?: string | null;
  extracted_text?: string | null;
  ai_summary?: string | null;
  file_name?: string | null;
  mime_type?: string | null;
  content_sha256?: string | null;
  tickers?: string[] | null;
  topics?: string[] | null;
  event_type?: string | null;
  catalyst_flags?: string[] | null;
  risk_flags?: string[] | null;
  message_time?: string | null;
  received_at?: string | null;
};

export async function generateManualReportPack(
  packType: ManualPackInput["packType"],
  input: Partial<Omit<ManualPackInput, "date" | "packType">> & { date?: string } = {}
) {
  const pack = buildManualGptPack({
    date: input.date ?? todayTaipei(),
    packType,
    officialMarketSnapshot: input.officialMarketSnapshot,
    institutionalFlows: input.institutionalFlows ?? [],
    marginShort: input.marginShort ?? [],
    mopsMaterialNews: input.mopsMaterialNews ?? [],
    lineManualNewsEvents: input.lineManualNewsEvents ?? [],
    uploadedAttachmentsMetadata: input.uploadedAttachmentsMetadata ?? [],
    signalEngineResult: input.signalEngineResult,
    sectorStrength: input.sectorStrength ?? [],
    tickerCandidates: input.tickerCandidates ?? [],
    dataSourceStatus: input.dataSourceStatus ?? {},
    costGuardStatus: input.costGuardStatus ?? {},
    dataGaps: input.dataGaps ?? [],
    lineMessages: input.lineMessages ?? [],
    newsEvents: input.newsEvents ?? [],
    marketData: input.marketData ?? [],
    riskFlags: input.riskFlags ?? [],
    evidence: input.evidence ?? []
  });
  const outputDir = await writeManualGptPack(pack);
  return {
    report: null,
    manualPack: pack,
    markdown: pack.markdown,
    outputDir
  };
}

export async function generateLineManualReportPack(
  packType: ManualPackInput["packType"] = "ad_hoc",
  options: { date?: string; database?: Queryable; scope?: LineManualPackScope } = {}
) {
  const date = options.date ?? todayTaipei();
  const database = options.database ?? db;
  const rows = await fetchLineMessagesForPack(database, date, options.scope);
  const contentRows = rows.filter((row) => !isLineCommand(row));
  const textRows = contentRows.filter((row) => row.message_type === "text" && primaryText(row));
  const attachmentRows = contentRows.filter((row) => row.message_type === "image" || row.message_type === "file");
  const lineMessages = contentRows.map(toManualPackLineMessage);
  const lineManualNewsEvents = textRows.map(toLineManualNewsEvent);
  const uploadedAttachmentsMetadata = attachmentRows.map(toUploadedAttachmentMetadata);
  const dataGaps = [
    rows.length ? undefined : "line_messages_empty",
    textRows.length ? undefined : "line_manual_news_empty",
    attachmentRows.length ? "attachments_metadata_only_no_ocr" : undefined
  ].filter((gap): gap is string => Boolean(gap));
  const result = await generateManualReportPack(packType, {
    date,
    lineMessages,
    lineManualNewsEvents,
    uploadedAttachmentsMetadata,
    dataSourceStatus: {
      line_messages: rows.length ? "ok" : "empty",
      line_manual_news: textRows.length ? "ok" : "empty",
      uploaded_attachments_metadata: attachmentRows.length ? "metadata_only" : "empty"
    },
    costGuardStatus: {
      ai_mode: "manual",
      openai_api_called: false,
      openai_requests_today: 0,
      estimated_cost_today: 0,
      paid_data_api_used: false
    },
    dataGaps,
    evidence: [
      {
        type: "line_manual_pack",
        date,
        line_message_count: lineMessages.length,
        line_manual_news_count: lineManualNewsEvents.length,
        attachment_metadata_count: uploadedAttachmentsMetadata.length
      }
    ]
  });
  await new ManualGptPacksRepo(database).upsertManualGptPack({
    pack_date: date,
    pack_type: packType,
    markdown: result.markdown,
    json_payload: JSON.parse(result.manualPack.files["manual_gpt_pack.json"] ?? "{}")
  });
  return {
    ...result,
    lineMessageCount: lineMessages.length,
    lineManualNewsCount: lineManualNewsEvents.length,
    attachmentMetadataCount: uploadedAttachmentsMetadata.length
  };
}

async function fetchLineMessagesForPack(
  database: Queryable,
  date: string,
  scope?: LineManualPackScope
): Promise<LineMessageRow[]> {
  const where = ["(received_at at time zone 'Asia/Taipei')::date = $1", "status = 'active'"];
  const params: unknown[] = [date];
  if (scope?.scopeType && scope.scopeId) {
    if (scope.scopeType === "group") {
      params.push(scope.scopeId);
      where.push(`source_type = 'group' and group_id = $${params.length}`);
    } else if (scope.scopeType === "room") {
      params.push(scope.scopeId);
      where.push(`source_type = 'room' and room_id = $${params.length}`);
    } else {
      params.push(scope.scopeId);
      where.push(`source_type = 'user' and user_hash = $${params.length}`);
    }
  }
  const result = await database.query<LineMessageRow>(
    `select source_type, message_id, message_type, raw_text, extracted_text, ai_summary,
            file_name, mime_type, content_sha256, tickers, topics, event_type,
            catalyst_flags, risk_flags, message_time::text, received_at::text
       from line_messages
      where ${where.join(" and ")}
      order by received_at asc`,
    params
  );
  return result.rows;
}

function toManualPackLineMessage(row: LineMessageRow): Record<string, unknown> {
  return {
    source: "line_manual",
    message_id: row.message_id,
    message_type: row.message_type,
    text: primaryText(row),
    file_name: row.file_name,
    mime_type: row.mime_type,
    content_sha256: row.content_sha256,
    tickers: normalizedTickers(row),
    topics: row.topics ?? [],
    event_type: row.event_type,
    catalyst_flags: row.catalyst_flags ?? [],
    risk_flags: row.risk_flags ?? [],
    received_at: row.received_at,
    interpretation_limit: row.message_type === "text" ? "user_provided_text" : "metadata_only"
  };
}

function toLineManualNewsEvent(row: LineMessageRow): Record<string, unknown> {
  const text = primaryText(row);
  return {
    source: "line_manual",
    title: text.slice(0, 80),
    summary: text,
    raw_text: text,
    tickers: normalizedTickers(row),
    topics: row.topics ?? [],
    event_type: row.event_type ?? "line_manual",
    importance: "medium",
    license_status: "user_provided_or_forwarded",
    interpretation_limit: "user_provided_text",
    data_quality_score: text.length >= 30 ? 70 : 45,
    data_gaps: text.length >= 30 ? [] : ["short_text_only"],
    fetched_at: row.received_at
  };
}

function toUploadedAttachmentMetadata(row: LineMessageRow): Record<string, unknown> {
  return {
    source: "line_upload",
    message_id: row.message_id,
    message_type: row.message_type,
    file_name: row.file_name,
    mime_type: row.mime_type,
    content_sha256: row.content_sha256,
    received_at: row.received_at,
    interpretation_limit: "metadata_only_no_ocr",
    data_gaps: ["attachment_text_not_extracted"]
  };
}

function primaryText(row: LineMessageRow): string {
  return String(row.extracted_text || row.ai_summary || row.raw_text || "").trim();
}

function isLineCommand(row: LineMessageRow): boolean {
  return row.message_type === "text" && primaryText(row).startsWith("/");
}

function normalizedTickers(row: LineMessageRow): string[] {
  return Array.from(new Set([...(row.tickers ?? []), ...extractTaiwanTickers(primaryText(row))]));
}

function extractTaiwanTickers(text: string): string[] {
  return Array.from(new Set(text.match(/(?<!\d)\d{4}(?!\d)/g) ?? []));
}
