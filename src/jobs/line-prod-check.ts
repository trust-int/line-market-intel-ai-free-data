import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";

export type LineProdCheckResult = {
  ready: boolean;
  webhook_url: string;
  checks: Record<string, "ok" | "missing" | "warning">;
  checklist: string[];
  notes: string[];
};

export function runLineProdCheck(env: NodeJS.ProcessEnv = process.env): LineProdCheckResult {
  const webhookUrl = env.LINE_WEBHOOK_URL ?? config.lineWebhookUrl ?? `${config.publicBaseUrl.replace(/\/$/, "")}/line/webhook`;
  const checks: LineProdCheckResult["checks"] = {
    LINE_CHANNEL_SECRET: env.LINE_CHANNEL_SECRET ? "ok" : "missing",
    LINE_CHANNEL_ACCESS_TOKEN: env.LINE_CHANNEL_ACCESS_TOKEN ? tokenLooksUsable(env.LINE_CHANNEL_ACCESS_TOKEN) : "missing",
    USER_HASH_SECRET: env.USER_HASH_SECRET && env.USER_HASH_SECRET !== "change-me" ? "ok" : "warning",
    webhook_url: webhookUrl.startsWith("https://") || webhookUrl.includes("localhost") ? "ok" : "warning",
    callback_health_endpoint: config.publicBaseUrl ? "ok" : "missing"
  };
  return {
    ready: Object.values(checks).every((value) => value === "ok"),
    webhook_url: webhookUrl,
    checks,
    checklist: [
      "部署服務並確認 /health 可訪問。",
      "在 LINE Messaging API channel 設定 webhook URL。",
      "開啟 Use webhook。",
      "將 bot 加到群組並公告資料收集用途。",
      "發送 /成本 與 /觀察 2330 台積電 測試文字 ingestion。",
      "發送測試圖片與 PDF，確認 private storage 寫入。",
      "查詢 DB line_messages 並確認只保存 user_hash。",
      "執行 /手動包 確認 manual_gpt_pack 可產生。"
    ],
    notes: [
      "line:test-webhook 仍是 fixture 模式；line:prod-check 用於真實 webhook bring-up 前檢查。",
      "不得暴露 LINE secrets 或原始 userId。"
    ]
  };
}

function tokenLooksUsable(token: string): "ok" | "warning" {
  return token.length >= 20 ? "ok" : "warning";
}

if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  process.stdout.write(JSON.stringify(runLineProdCheck(), null, 2) + "\n");
}
