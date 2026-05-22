import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";

export type LineVerifyResult = {
  ok: boolean;
  checks: Record<string, "ok" | "missing" | "warning">;
  webhook_url: string;
  notes: string[];
};

export function verifyLineProductionConfig(): LineVerifyResult {
  const checks = {
    LINE_CHANNEL_SECRET: config.lineChannelSecret ? "ok" : "missing",
    LINE_CHANNEL_ACCESS_TOKEN: config.lineChannelAccessToken ? "ok" : "missing",
    USER_HASH_SECRET: config.userHashSecret && config.userHashSecret !== "change-me" ? "ok" : "warning",
    webhook_endpoint: config.publicBaseUrl ? "ok" : "missing"
  } satisfies LineVerifyResult["checks"];
  const notes = [
    checks.USER_HASH_SECRET === "warning" ? "USER_HASH_SECRET should be changed before production." : "",
    "Webhook endpoint should be reachable by LINE: /line/webhook",
    "Do not store raw LINE userId; only HMAC user_hash is stored."
  ].filter(Boolean);
  return {
    ok: Object.values(checks).every((status) => status === "ok"),
    checks,
    webhook_url: `${config.publicBaseUrl.replace(/\/$/, "")}/line/webhook`,
    notes
  };
}

if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  process.stdout.write(JSON.stringify(verifyLineProductionConfig(), null, 2) + "\n");
}
