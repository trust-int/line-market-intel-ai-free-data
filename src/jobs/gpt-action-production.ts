import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runGptActionCheck } from "./gpt-action-check.js";
import { todayTaipei } from "../utils/date.js";

export type GptActionExportResult = {
  ok: boolean;
  openapi_path: string;
  setup_path: string;
};

export async function exportGptActionAssets(outputDir = path.resolve(process.cwd(), "outputs", "gpt-action")): Promise<GptActionExportResult> {
  await mkdir(outputDir, { recursive: true });
  const openapi = await readFile(path.resolve(process.cwd(), "openapi", "gpt-action.yaml"), "utf8");
  const openapiPath = path.join(outputDir, "openapi.yaml");
  const setupPath = path.join(outputDir, "setup.md");
  await writeFile(openapiPath, openapi, "utf8");
  await writeFile(setupPath, renderSetupMarkdown(), "utf8");
  return { ok: true, openapi_path: openapiPath, setup_path: setupPath };
}

export async function smokeGptAction(date = todayTaipei()) {
  const result = await runGptActionCheck(date);
  return {
    ok: result.openapi_valid && result.auth_required && result.no_raw_line_user_id && result.no_paid_fulltext,
    ...result
  };
}

function renderSetupMarkdown(): string {
  return [
    "# Custom GPT Action Setup",
    "",
    "1. 建立 Custom GPT。",
    "2. 加入 Action。",
    "3. 貼上 `outputs/gpt-action/openapi.yaml` 或 `openapi/gpt-action.yaml`。",
    "4. Authentication 選 Bearer token，填入 `GPT_ACTION_BEARER_TOKEN`。",
    "5. 測試 `/gpt/reports/today`。",
    "6. 測試 `/gpt/holdings`。",
    "",
    "Safety rules:",
    "- API 不回傳 raw LINE userId。",
    "- API 不回傳付費來源全文。",
    "- 沒有 backtest sample_size >= 30 時不得輸出 win_rate。"
  ].join("\n");
}

if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  const [action = "smoke", dateArg] = process.argv.slice(2);
  const date = !dateArg || dateArg === "today" ? todayTaipei() : dateArg;
  const result = action === "export" ? await exportGptActionAssets() : await smokeGptAction(date);
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}
