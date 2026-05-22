import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import type { ManualPackData, ManualPackInput } from "./schemas.js";
import { manualPackInputSchema } from "./schemas.js";

export type ManualGptPack = {
  date: string;
  packType: string;
  markdown: string;
  files: Record<string, string>;
};

export function buildManualGptPack(input: ManualPackInput): ManualGptPack {
  const data = manualPackInputSchema.parse(input);
  const safeData = sanitizeManualPackData(data);
  assertNoWinRate(safeData);
  const files = {
    "daily_digest_source.md": buildDigestMarkdown(safeData),
    "manual_gpt_pack.md": buildPromptReadyMarkdown(safeData),
    "manual_gpt_pack.json": JSON.stringify(safeData, null, 2),
    "ticker_mentions.csv": toCsv(extractTickerMentions(safeData)),
    "news_events.csv": toCsv([...safeData.newsEvents, ...safeData.mopsMaterialNews, ...safeData.lineManualNewsEvents]),
    "market_data.csv": toCsv(safeData.marketData),
    "institutional_flows.csv": toCsv(safeData.institutionalFlows),
    "margin_short.csv": toCsv(safeData.marginShort),
    "risk_flags.csv": toCsv(safeData.riskFlags),
    "evidence_index.csv": toCsv(safeData.evidence),
    "data_source_status.csv": toCsv(Object.entries(safeData.dataSourceStatus).map(([source, status]) => ({ source, status })))
  };

  return {
    date: safeData.date,
    packType: safeData.packType,
    markdown: files["daily_digest_source.md"],
    files
  };
}

export async function writeManualGptPack(pack: ManualGptPack, baseDir = config.manualPackDir): Promise<string> {
  const dir = path.join(baseDir, pack.date, pack.packType);
  await mkdir(dir, { recursive: true });
  await Promise.all(
    Object.entries(pack.files).map(([name, content]) => writeFile(path.join(dir, name), content, "utf8"))
  );
  await writeFile(path.join(dir, "manual_gpt_pack.manifest.json"), JSON.stringify(pack, null, 2), "utf8");
  return dir;
}

function buildDigestMarkdown(data: ManualPackData): string {
  return [
    `# ${data.date} manual_gpt_pack (${data.packType})`,
    "",
    "## 使用方式",
    "把本資料包貼給 ChatGPT 或其他人工分析流程。此模式不會呼叫 OpenAI API。",
    "",
    "## 成本與資料來源限制",
    "- AI_MODE: manual",
    "- OpenAI API called: false",
    "- Paid data API used: false",
    "- Auto trading: false",
    "- Futu: disabled by default; do not suggest buying quote cards.",
    "- 金十 / 華爾街見聞 / 富途新聞來源僅限 LINE、手動貼上、使用者上傳檔案。",
    "- 不可輸出勝率欄位，除非資料包明確提供 backtest 且 sample_size >= 30。",
    "",
    "## Official Market Snapshot",
    JSON.stringify(data.officialMarketSnapshot ?? {}, null, 2),
    "",
    "## Signal Engine Result",
    JSON.stringify(data.signalEngineResult ?? {}, null, 2),
    "",
    "## Sector Strength",
    JSON.stringify(data.sectorStrength, null, 2),
    "",
    "## Ticker Candidates",
    JSON.stringify(data.tickerCandidates, null, 2),
    "",
    "## Data Source Status",
    JSON.stringify(data.dataSourceStatus, null, 2),
    "",
    "## Cost Guard Status",
    JSON.stringify(data.costGuardStatus, null, 2),
    "",
    "## Institutional Flows",
    JSON.stringify(data.institutionalFlows, null, 2),
    "",
    "## Margin / Short",
    JSON.stringify(data.marginShort, null, 2),
    "",
    "## MOPS Material News",
    JSON.stringify(data.mopsMaterialNews, null, 2),
    "",
    "## LINE Manual News Events",
    JSON.stringify(data.lineManualNewsEvents, null, 2),
    "",
    "## Uploaded Attachments Metadata",
    JSON.stringify(data.uploadedAttachmentsMetadata.map(stripPrivatePath), null, 2),
    "",
    "## LINE 訊息摘要",
    JSON.stringify(data.lineMessages.map(stripPrivatePath), null, 2),
    "",
    "## 新聞事件",
    JSON.stringify(data.newsEvents, null, 2),
    "",
    "## 市場資料",
    JSON.stringify(data.marketData, null, 2),
    "",
    "## 風險旗標",
    JSON.stringify(data.riskFlags, null, 2),
    "",
    "## 證據索引",
    JSON.stringify(data.evidence, null, 2),
    "",
    "## Data Gaps",
    JSON.stringify(data.dataGaps, null, 2)
  ].join("\n");
}

function buildPromptReadyMarkdown(data: ManualPackData): string {
  return [
    `# ${data.date} 台股 manual_gpt_pack`,
    "",
    "請根據下列固定模板撰寫報告。不可輸出勝率欄位，除非資料包明確提供 backtest 且 sample_size >= 30。不可建議自動下單。MOPS 重大訊息只能作為觀察催化，不可單獨作為買進依據。",
    "",
    "## 1. 今日市場狀態",
    jsonBlock(data.officialMarketSnapshot ?? {}),
    "",
    "## 2. 多空判斷",
    jsonBlock(data.signalEngineResult ?? {}),
    "",
    "## 3. 可能走勢",
    "- 請根據 market_phase、risk_flags、data_quality_score 推估，並標示失效條件。",
    "",
    "## 4. 大戶策略推估",
    "- 使用 signal-engine 的 big_money_strategy 作為主判斷，不要自行臆測。",
    "",
    "## 5. 強勢族群",
    jsonBlock(data.sectorStrength.length ? data.sectorStrength : ((data.signalEngineResult?.sector_strength as unknown) ?? [])),
    "",
    "## 6. 續抱觀察",
    jsonBlock(data.tickerCandidates.filter((item) => ["hold", "reduce", "watch"].includes(String(item.candidate_type)))),
    "",
    "## 7. 當沖候選",
    jsonBlock(data.tickerCandidates.filter((item) => String(item.candidate_type).startsWith("daytrade"))),
    "",
    "## 8. 波段候選",
    jsonBlock(data.tickerCandidates.filter((item) => item.candidate_type === "swing")),
    "",
    "## 9. 風險警訊",
    jsonBlock(data.riskFlags),
    "",
    "## 10. 資料缺口",
    jsonBlock(data.dataGaps.length ? data.dataGaps : data.evidence.filter((item) => item.type === "data_gap")),
    "",
    "## 11. 明日觀察重點",
    jsonBlock(buildTomorrowWatch(data)),
    "",
    "## 官方資料",
    "### data_source_status",
    jsonBlock(data.dataSourceStatus),
    "### cost_guard_status",
    jsonBlock(data.costGuardStatus),
    "### Institutional Flows",
    jsonBlock(data.institutionalFlows),
    "### Margin / Short",
    jsonBlock(data.marginShort),
    "### MOPS Material News",
    jsonBlock(data.mopsMaterialNews),
    "### LINE Manual News Events",
    jsonBlock(data.lineManualNewsEvents),
    "### Uploaded Attachments Metadata",
    jsonBlock(data.uploadedAttachmentsMetadata.map(stripPrivatePath)),
    "",
    "## 明確限制",
    "- 不使用付費資料 API",
    "- Futu disabled 時只標示 disabled，不提示購買行情卡",
    "- 不自動下單",
    "- 沒有 backtest 且 sample_size >= 30，不輸出勝率欄位",
    "- 若資料不足，必須列資料缺口"
  ].join("\n");
}

function extractTickerMentions(data: ManualPackData): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  for (const item of [...data.lineMessages, ...data.newsEvents, ...data.mopsMaterialNews, ...data.lineManualNewsEvents]) {
    const tickers = Array.isArray(item.tickers) ? item.tickers : [];
    for (const ticker of tickers) {
      rows.push({
        date: data.date,
        ticker,
        source: String(item.source ?? item.source_type ?? "unknown"),
        title: String(item.title ?? item.raw_text ?? "").slice(0, 120)
      });
    }
  }
  return rows;
}

function stripPrivatePath(row: Record<string, unknown>): Record<string, unknown> {
  const { file_path: _filePath, filePath: _filePath2, private_path: _privatePath, privatePath: _privatePath2, ...rest } = row;
  return rest;
}

function sanitizeManualPackData(data: ManualPackData): ManualPackData {
  return {
    ...data,
    uploadedAttachmentsMetadata: data.uploadedAttachmentsMetadata.map(stripPrivatePath),
    lineMessages: data.lineMessages.map(stripPrivatePath),
    newsEvents: data.newsEvents.map(stripPrivatePath),
    mopsMaterialNews: data.mopsMaterialNews.map(stripPrivatePath),
    lineManualNewsEvents: data.lineManualNewsEvents.map(stripPrivatePath)
  };
}

function jsonBlock(value: unknown): string {
  return ["```json", JSON.stringify(value, null, 2), "```"].join("\n");
}

function buildTomorrowWatch(data: ManualPackData): Array<{ ticker: string; reason: string; action: string }> {
  const tickers = new Set<string>();
  for (const item of [...data.mopsMaterialNews, ...data.lineManualNewsEvents, ...data.newsEvents]) {
    const itemTickers = Array.isArray(item.tickers) ? item.tickers : [];
    itemTickers.forEach((ticker) => tickers.add(String(ticker)));
  }
  return [...tickers].map((ticker) => ({
    ticker,
    reason: "MOPS / LINE manual news catalyst; observe only unless price-volume and chip data confirm.",
    action: "明日觀察，不直接建議買進"
  }));
}

function assertNoWinRate(value: unknown): void {
  const text = JSON.stringify(value);
  if (/"win_rate"|"historical_hit_rate"/.test(text)) {
    throw new Error("manual_gpt_pack must not include win_rate unless validated backtest sample_size >= 30");
  }
}

function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const headers = Array.from(rows.reduce((set, row) => {
    Object.keys(row).forEach((key) => set.add(key));
    return set;
  }, new Set<string>()));
  return [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(","))
  ].join("\n");
}

function csvCell(value: unknown): string {
  if (value == null) return "";
  const text = Array.isArray(value) || typeof value === "object" ? JSON.stringify(value) : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}
