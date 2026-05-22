import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";

export type LineSendTestReplyResult = {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  hint?: string;
  status?: number;
};

export async function sendLineTestReply(
  deps: { targetId?: string; accessToken?: string; fetchImpl?: typeof fetch } = {}
): Promise<LineSendTestReplyResult> {
  const targetId = deps.targetId ?? config.lineTestTargetId ?? process.env.LINE_TEST_TARGET_ID;
  const accessToken = deps.accessToken ?? config.lineChannelAccessToken;
  if (!targetId) {
    return {
      ok: false,
      skipped: true,
      reason: "LINE_TEST_TARGET_ID_missing",
      hint: "先在 webhook logs 取得 groupId/userId，再設定 LINE_TEST_TARGET_ID。"
    };
  }
  if (!accessToken) {
    return {
      ok: false,
      skipped: true,
      reason: "LINE_CHANNEL_ACCESS_TOKEN_missing",
      hint: "到 LINE Messaging API channel 建立 long-lived access token。"
    };
  }
  const fetchImpl = deps.fetchImpl ?? fetch;
  const response = await fetchImpl("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      to: targetId,
      messages: [{ type: "text", text: "TrustInt market bot production test reply ok. 不含持股敏感資訊。" }]
    })
  });
  return response.ok
    ? { ok: true, status: response.status }
    : { ok: false, status: response.status, reason: `LINE_push_http_${response.status}` };
}

if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  process.stdout.write(JSON.stringify(await sendLineTestReply(), null, 2) + "\n");
}
