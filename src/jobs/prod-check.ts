import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { config } from "../config.js";
import { REQUIRED_TABLES } from "../db/tables.js";

const { Pool } = pg;

export type CheckSeverity = "ready" | "warning" | "blocker";

export type ProductionCheckItem = {
  name: string;
  status: CheckSeverity;
  message: string;
  suggested_fix?: string;
};

export type ProductionCheckResult = {
  ready: boolean;
  checked_at: string;
  blockers: string[];
  warnings: string[];
  checks: ProductionCheckItem[];
  output_paths?: {
    json: string;
    markdown: string;
  };
};

export async function runProductionCheck(
  env: NodeJS.ProcessEnv = process.env,
  options: { outputDir?: string; skipDbConnection?: boolean } = {}
): Promise<ProductionCheckResult> {
  const checks: ProductionCheckItem[] = [];
  const add = (item: ProductionCheckItem) => checks.push(item);

  requireEnv(add, env, "DATABASE_URL", "設定 Supabase/PostgreSQL 連線字串。");
  requireEnv(add, env, "LINE_CHANNEL_SECRET", "到 LINE Messaging API channel 複製 channel secret。");
  requireEnv(add, env, "LINE_CHANNEL_ACCESS_TOKEN", "到 LINE Messaging API channel 建立 long-lived access token。");
  requireEnv(add, env, "USER_HASH_SECRET", "設定一組長隨機字串，用於 HMAC hash LINE userId。", "change-me");
  requireEnv(add, env, "GPT_ACTION_BEARER_TOKEN", "設定 Custom GPT Action 專用 Bearer token。", "change-me-too");
  requireEnv(add, env, "NEWS_INGEST_ALLOWED_SOURCES", "設定 crawler/admin 可寫入的 news_items.source 白名單。");
  requireEnv(add, env, "OFFICIAL_DATA_MODE", "設定 auto、live 或 fixture。");
  requireEnv(add, env, "AI_MODE", "設定 manual 或 openai。");
  requireEnv(add, env, "NO_PAID_DATA_API", "production 必須為 true。");
  requireEnv(add, env, "DISABLE_PAID_MARKET_DATA", "production 必須為 true。");
  requireEnv(add, env, "ENABLE_FUTU", "production 預設必須為 false。");
  requireEnv(add, env, "ENABLE_LINE_PUSH", "未啟用推播時設 false；啟用時另設 LINE_PUSH_TARGET_ID。");

  if (env.OFFICIAL_DATA_MODE && !["auto", "live", "fixture"].includes(env.OFFICIAL_DATA_MODE)) {
    add({
      name: "OFFICIAL_DATA_MODE",
      status: "blocker",
      message: `不支援的 OFFICIAL_DATA_MODE=${env.OFFICIAL_DATA_MODE}`,
      suggested_fix: "改成 auto、live 或 fixture。"
    });
  }
  if (env.OFFICIAL_DATA_MODE === "fixture") {
    add({
      name: "OFFICIAL_DATA_MODE_fixture",
      status: "warning",
      message: "目前使用 fixture 測試資料，不可用於真實市場判斷。",
      suggested_fix: "實機驗證通過後改用 auto 或 live。"
    });
  }
  if (env.AI_MODE && !["manual", "openai"].includes(env.AI_MODE)) {
    add({
      name: "AI_MODE",
      status: "blocker",
      message: `production 僅支援 AI_MODE=manual/openai，目前為 ${env.AI_MODE}`,
      suggested_fix: "改成 manual；確認成本上限後再使用 openai。"
    });
  }
  if (env.NO_PAID_DATA_API != null && env.NO_PAID_DATA_API !== "true") {
    add({
      name: "NO_PAID_DATA_API",
      status: "blocker",
      message: "NO_PAID_DATA_API 必須為 true。",
      suggested_fix: "設定 NO_PAID_DATA_API=true。"
    });
  }
  if (env.DISABLE_PAID_MARKET_DATA != null && env.DISABLE_PAID_MARKET_DATA !== "true") {
    add({
      name: "DISABLE_PAID_MARKET_DATA",
      status: "blocker",
      message: "DISABLE_PAID_MARKET_DATA 必須為 true。",
      suggested_fix: "設定 DISABLE_PAID_MARKET_DATA=true。"
    });
  }
  if (env.DISABLE_NEWS_SCRAPING && env.DISABLE_NEWS_SCRAPING !== "true") {
    add({
      name: "DISABLE_NEWS_SCRAPING",
      status: "blocker",
      message: "DISABLE_NEWS_SCRAPING 必須維持 true，金十/華爾街見聞只做 manual ingestion。",
      suggested_fix: "設定 DISABLE_NEWS_SCRAPING=true。"
    });
  }
  if (env.ENABLE_FUTU === "true" && env.FUTU_PERMISSION_CONFIRMED !== "true") {
    add({
      name: "Futu_permission",
      status: "blocker",
      message: "ENABLE_FUTU=true 但尚未確認使用者已有免費行情權限。",
      suggested_fix: "維持 ENABLE_FUTU=false；只有已有免費權限時才設定 FUTU_PERMISSION_CONFIRMED=true。"
    });
  }
  if (env.ENABLE_LINE_PUSH === "true" && !env.LINE_PUSH_TARGET_ID) {
    add({
      name: "LINE_PUSH_TARGET_ID",
      status: "blocker",
      message: "ENABLE_LINE_PUSH=true 時必須設定 LINE_PUSH_TARGET_ID。",
      suggested_fix: "填入要推送的 groupId/userId，或先設定 ENABLE_LINE_PUSH=false。"
    });
  }
  if (env.ENABLE_FUTU !== "true") {
    add({ name: "Futu", status: "ready", message: "Futu provider disabled。" });
  }

  add(await checkPrivateStorage());
  if (!options.skipDbConnection) {
    checks.push(...await checkDatabase(env.DATABASE_URL));
  }

  const result = summarize(checks);
  const outputDir = options.outputDir ?? path.resolve(process.cwd(), "outputs", "prod-check");
  const paths = await writeProductionCheckOutputs(result, outputDir);
  return { ...result, output_paths: paths };
}

async function checkPrivateStorage(): Promise<ProductionCheckItem> {
  const dir = path.resolve(config.storageDir);
  const probe = path.join(dir, ".prod-check-write-test");
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(probe, "ok", "utf8");
    await rm(probe, { force: true });
    return { name: "private_storage", status: "ready", message: `${dir} 可寫入。` };
  } catch (error) {
    return {
      name: "private_storage",
      status: "blocker",
      message: `private storage path 不可寫入：${String(error)}`,
      suggested_fix: "檢查 STORAGE_DIR 權限，或改成服務可寫入的 private path。"
    };
  }
}

async function checkDatabase(databaseUrl?: string): Promise<ProductionCheckItem[]> {
  if (!databaseUrl) {
    return [{
      name: "database_connection",
      status: "blocker",
      message: "DATABASE_URL 未設定，目前只能使用 Noop DB。",
      suggested_fix: "設定 Supabase/PostgreSQL DATABASE_URL 後執行 npm run db:migrate 與 npm run db:check。"
    }];
  }
  const pool = new Pool({ connectionString: databaseUrl, max: 1, idleTimeoutMillis: 5_000 });
  try {
    await pool.query("select 1");
    const rows = await pool.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public' and table_name = any($1)",
      [REQUIRED_TABLES]
    );
    const found = new Set(rows.rows.map((row) => row.table_name));
    const missing = REQUIRED_TABLES.filter((table) => !found.has(table));
    return [
      { name: "database_connection", status: "ready", message: "DB connection ok。" },
      missing.length
        ? {
            name: "database_schema",
            status: "blocker",
            message: `缺少 table：${missing.join(", ")}`,
            suggested_fix: "執行 npm run db:migrate 後再跑 npm run db:check。"
          }
        : { name: "database_schema", status: "ready", message: "必要資料表都存在。" }
    ];
  } catch (error) {
    return [{
      name: "database_connection",
      status: "blocker",
      message: `DB 連線失敗：${String(error)}`,
      suggested_fix: "確認 DATABASE_URL、網路、防火牆、Supabase SSL 設定。"
    }];
  } finally {
    await pool.end().catch(() => undefined);
  }
}

function requireEnv(
  add: (item: ProductionCheckItem) => void,
  env: NodeJS.ProcessEnv,
  name: string,
  suggested_fix: string,
  forbiddenDefault?: string
): void {
  const value = env[name];
  if (!value || value === forbiddenDefault) {
    add({
      name,
      status: "blocker",
      message: forbiddenDefault && value === forbiddenDefault ? `${name} 仍是預設值。` : `${name} 未設定。`,
      suggested_fix
    });
    return;
  }
  add({ name, status: "ready", message: `${name} 已設定。` });
}

function summarize(checks: ProductionCheckItem[]): ProductionCheckResult {
  const blockers = checks.filter((item) => item.status === "blocker").map((item) => item.name);
  const warnings = checks.filter((item) => item.status === "warning").map((item) => item.name);
  return {
    ready: blockers.length === 0,
    checked_at: new Date().toISOString(),
    blockers,
    warnings,
    checks
  };
}

async function writeProductionCheckOutputs(result: ProductionCheckResult, outputDir: string) {
  await mkdir(outputDir, { recursive: true });
  const jsonPath = path.join(outputDir, "latest.json");
  const markdownPath = path.join(outputDir, "latest.md");
  await writeFile(jsonPath, JSON.stringify(result, null, 2), "utf8");
  await writeFile(markdownPath, renderProductionCheckMarkdown(result), "utf8");
  return { json: jsonPath, markdown: markdownPath };
}

function renderProductionCheckMarkdown(result: ProductionCheckResult): string {
  return [
    "# Production Environment Check",
    "",
    `- ready: ${result.ready}`,
    `- blockers: ${result.blockers.length ? result.blockers.join(", ") : "none"}`,
    `- warnings: ${result.warnings.length ? result.warnings.join(", ") : "none"}`,
    "",
    "| Check | Status | Message | Suggested Fix |",
    "|---|---|---|---|",
    ...result.checks.map((item) => `| ${item.name} | ${item.status} | ${item.message} | ${item.suggested_fix ?? ""} |`)
  ].join("\n");
}

if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  process.stdout.write(JSON.stringify(await runProductionCheck(), null, 2) + "\n");
}
