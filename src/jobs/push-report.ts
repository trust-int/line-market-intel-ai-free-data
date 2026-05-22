import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";
import { pushLineText } from "../line/push.js";
import { todayTaipei } from "../utils/date.js";

export type PushReportResult = {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  message?: string;
};

export async function pushReportJob(
  date = todayTaipei(),
  reportType = "postmarket",
  deps: {
    enabled?: boolean;
    targetId?: string;
    sendText?: (text: string, targetId?: string) => Promise<unknown>;
    dataQualityPath?: string;
    reportPath?: string;
    reportJsonPath?: string;
    officialDataMode?: string;
  } = {}
): Promise<PushReportResult> {
  const enabled = deps.enabled ?? config.enableLinePush;
  if (!enabled) return { ok: true, skipped: true, reason: "ENABLE_LINE_PUSH_false" };
  const targetId = deps.targetId ?? config.linePushTargetId;
  if (!targetId) return { ok: false, skipped: true, reason: "LINE_PUSH_TARGET_ID_missing" };
  const dataQuality = await readJsonSafe(deps.dataQualityPath ?? path.resolve(process.cwd(), "outputs", "data-quality", `${date}.json`));
  const score = Number(dataQuality?.score ?? 0);
  const gaps = Array.isArray(dataQuality?.data_gaps) ? dataQuality.data_gaps.slice(0, 3) : [];
  const reportPath = deps.reportPath ?? path.resolve(process.cwd(), "outputs", "reports", `${date}.md`);
  const reportJson = await readJsonSafe(deps.reportJsonPath ?? path.resolve(process.cwd(), "outputs", "reports", `${date}.json`));
  const signal = typeof reportJson === "object" && reportJson ? (reportJson as { signalEngineResult?: Record<string, unknown> }).signalEngineResult : undefined;
  const marketBias = typeof signal?.market_bias === "string" ? signal.market_bias : "unknown";
  const bigMoneyStrategy = Array.isArray(signal?.big_money_strategy) ? signal.big_money_strategy.join(", ") : "unknown";
  const mode = deps.officialDataMode ?? config.officialDataMode;
  const firstLine = buildFirstLine(mode, score);
  const message = [
    firstLine,
    `${date} ${reportType}`,
    `market_bias: ${marketBias}`,
    `big_money_strategy: ${bigMoneyStrategy}`,
    `data_quality_score: ${score}`,
    gaps.length ? `data_gaps: ${gaps.join(", ")}` : "data_gaps: none",
    `report: ${reportPath}`,
    config.aiMode === "manual" ? "AI_MODE=manual：manual_gpt_pack 已完成，未呼叫 OpenAI。" : "AI_MODE=openai：已受 cost guard 限制。",
    "僅供研究與人工判讀。"
  ].join("\n");
  assertPushMessageSafe(message);
  await (deps.sendText ?? pushLineText)(message, targetId);
  return { ok: true, message };
}

async function readJsonSafe(filePath: string): Promise<Record<string, unknown> | undefined> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function assertPushMessageSafe(message: string): void {
  if (message.includes("win_rate") || message.includes("historical_hit_rate")) throw new Error("LINE push must not include win_rate.");
  if (/自動下單|自動交易|直接買進|立即買進|立即放空/.test(message)) throw new Error("LINE push must not include automated trading or direct trade instructions.");
}

function buildFirstLine(mode: string, score: number): string {
  if (mode === "fixture") return "🧪 Fixture 測試資料，勿作真實交易判斷";
  if (mode === "live" && score < 50) return "⚠️ Live 資料不足";
  if (score < 50) return "⚠️ 資料品質不足，僅供流程測試";
  return "日報摘要已完成，仍需人工確認";
}

if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  const [dateArg, typeArg] = process.argv.slice(2);
  const date = !dateArg || dateArg === "today" ? todayTaipei() : dateArg;
  process.stdout.write(JSON.stringify(await pushReportJob(date, typeArg ?? "postmarket"), null, 2) + "\n");
}
