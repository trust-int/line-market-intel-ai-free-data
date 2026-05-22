import { config } from "../config.js";

export async function pushLineText(text: string, targetId = config.linePushTargetId): Promise<{ skipped?: true; reason?: string }> {
  if (!config.enableLinePush) return { skipped: true, reason: "ENABLE_LINE_PUSH_false" };
  if (!targetId) return { skipped: true, reason: "LINE_PUSH_TARGET_ID_missing" };
  if (!config.lineChannelAccessToken) return { skipped: true, reason: "LINE_CHANNEL_ACCESS_TOKEN_missing" };

  const response = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.lineChannelAccessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      to: targetId,
      messages: [{ type: "text", text: text.slice(0, 4900) }]
    })
  });

  if (!response.ok) throw new Error(`LINE push failed: ${response.status}`);
  return {};
}

export function buildManualModePushMessage(packType: string, date: string): string {
  return `${date} ${packType} 資料包已完成。AI_MODE=manual 未呼叫 OpenAI API，請到 dashboard 或 manual-pack API 下載後手動分析。`;
}
