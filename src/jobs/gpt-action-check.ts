import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";
import { createApp } from "../index.js";
import { todayTaipei } from "../utils/date.js";

export type GptActionCheckResult = {
  openapi_valid: boolean;
  auth_required: boolean;
  endpoints: Record<string, number>;
  no_raw_line_user_id: boolean;
  no_paid_fulltext: boolean;
};

export async function runGptActionCheck(date = todayTaipei()): Promise<GptActionCheckResult> {
  const openapi = await readFile(path.resolve(process.cwd(), "openapi", "gpt-action.yaml"), "utf8");
  const openapiValid = openapi.includes("/reports/today") && openapi.includes("/manual-pack/{date}") && /bearer|Bearer/i.test(openapi);
  const app = createApp();
  const server = app.listen(0);
  try {
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const base = `http://127.0.0.1:${port}`;
    const noAuth = await fetch(`${base}/gpt/reports/today`);
    const headers = { Authorization: `Bearer ${config.gptActionBearerToken}` };
    const paths = [
      "/gpt/reports/today",
      `/gpt/reports/${date}`,
      `/gpt/manual-pack/${date}`,
      "/gpt/holdings"
    ];
    const endpoints: Record<string, number> = {};
    const bodies: string[] = [];
    for (const endpoint of paths) {
      const response = await fetch(`${base}${endpoint}`, { headers });
      endpoints[endpoint] = response.status;
      bodies.push(await response.text());
    }
    const bodyText = bodies.join("\n");
    return {
      openapi_valid: openapiValid,
      auth_required: noAuth.status === 401,
      endpoints,
      no_raw_line_user_id: !/U[a-fA-F0-9]{4,}|userId|lineUserId/.test(bodyText),
      no_paid_fulltext: !/paid_fulltext|vip_fulltext|會員全文/.test(bodyText)
    };
  } finally {
    server.close();
  }
}

if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  const date = process.argv[2] ?? todayTaipei();
  process.stdout.write(JSON.stringify(await runGptActionCheck(date), null, 2) + "\n");
}
