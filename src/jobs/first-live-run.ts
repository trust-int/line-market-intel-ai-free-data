import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkDatabaseSchema, migrateDatabase } from "./db-bootstrap.js";
import { runBringupLive } from "./bringup-live.js";
import { runDailyE2EDryRun } from "./e2e-daily-dry-run.js";
import { smokeGptAction } from "./gpt-action-production.js";
import { runLineProdCheck } from "./line-prod-check.js";
import { runProductionCheck } from "./prod-check.js";
import { saveReportArtifacts } from "./report-persistence.js";
import { diagnoseTls } from "./tls-diagnose.js";
import { runLiveFetchCheck, writeLiveFetchCheckOutputs } from "../providers/health/live-fetch-check.js";
import { todayTaipei } from "../utils/date.js";

export type FirstLiveRunReadiness = {
  db: "ready" | "not_ready";
  line: "ready" | "not_ready";
  official_data: "ready" | "not_ready";
  tls: "ready" | "not_ready";
  gpt_action: "ready" | "not_ready";
  push: "ready" | "not_ready";
  report_generated: "ready" | "not_ready";
};

export type FirstLiveRunResult = {
  ok: boolean;
  checked_at: string;
  date: string;
  readiness: FirstLiveRunReadiness;
  blockers: string[];
  warnings: string[];
  next_actions: string[];
  steps: Record<string, unknown>;
  output_paths?: {
    json: string;
    markdown: string;
  };
};

export type FirstLiveRunDeps = {
  prodCheck?: typeof runProductionCheck;
  dbMigrate?: typeof migrateDatabase;
  dbCheck?: typeof checkDatabaseSchema;
  tlsDiagnose?: typeof diagnoseTls;
  liveCheck?: typeof runLiveFetchCheck;
  lineCheck?: typeof runLineProdCheck;
  gptSmoke?: typeof smokeGptAction;
  e2e?: typeof runDailyE2EDryRun;
  reportSave?: typeof saveReportArtifacts;
  bringup?: typeof runBringupLive;
};

export async function runFirstLiveRun(
  date = todayTaipei(),
  outputDir = path.resolve(process.cwd(), "outputs", "first-live-run"),
  deps: FirstLiveRunDeps = {}
): Promise<FirstLiveRunResult> {
  const steps: Record<string, unknown> = {};
  const blockers: string[] = [];
  const warnings: string[] = [];

  const prod = await safe("prod_check", () => (deps.prodCheck ?? runProductionCheck)(process.env));
  steps.prod_check = prod.value ?? prod.error;
  if (prod.value?.blockers.length) blockers.push(...prod.value.blockers.map((item) => `prod:${item}`));
  if (prod.value?.warnings.length) warnings.push(...prod.value.warnings.map((item) => `prod:${item}`));

  const migrate = await safe("db_migrate", () => (deps.dbMigrate ?? migrateDatabase)());
  steps.db_migrate = migrate.value ?? migrate.error;
  if (!migrate.value?.ok) blockers.push("db:migrate:not_ready");

  const dbCheck = await safe("db_check", () => (deps.dbCheck ?? checkDatabaseSchema)());
  steps.db_check = dbCheck.value ?? dbCheck.error;
  if (!dbCheck.value?.ok) blockers.push("db:check:not_ready");

  const tls = await safe("tls_diagnose", () => (deps.tlsDiagnose ?? diagnoseTls)(date));
  steps.tls_diagnose = tls.value ?? tls.error;
  const tlsReady = Boolean(tls.value?.providers.every((item) => item.ok));
  if (!tlsReady) warnings.push("tls:not_ready");

  const live = await safe("live_check", async () => {
    const results = await (deps.liveCheck ?? runLiveFetchCheck)(date);
    const outputs = await writeLiveFetchCheckOutputs(date, results);
    return { results, outputs };
  });
  steps.live_check = live.value ?? live.error;
  const officialReady = Boolean(live.value?.results.length) && Boolean(live.value?.results.every((item) => item.status === "ok"));
  if (!officialReady) warnings.push("official_data:not_ready");

  const line = await safe("line_prod_check", () => Promise.resolve((deps.lineCheck ?? runLineProdCheck)()));
  steps.line_prod_check = line.value ?? line.error;
  if (!line.value?.ready) blockers.push("line:not_ready");

  const gpt = await safe("gpt_action_smoke", () => (deps.gptSmoke ?? smokeGptAction)(date));
  steps.gpt_action_smoke = gpt.value ?? gpt.error;
  if (!gpt.value?.ok) warnings.push("gpt_action:not_ready");

  const e2e = await safe("e2e_daily_auto", () => (deps.e2e ?? runDailyE2EDryRun)(date, { mode: "auto", push: false }));
  steps.e2e_daily_auto = e2e.value
    ? { reportPath: e2e.value.reportPath, paths: e2e.value.paths, dataQuality: e2e.value.dataQuality }
    : e2e.error;
  if (!e2e.value) blockers.push("report:not_generated");

  const reportSave = await safe("report_save", () => (deps.reportSave ?? saveReportArtifacts)(date, "postmarket"));
  steps.report_save = reportSave.value ?? reportSave.error;
  if (!reportSave.value?.ok) warnings.push("report:save:not_ready");

  const bringup = await safe("bringup_live", () => (deps.bringup ?? runBringupLive)(date));
  steps.bringup_live = bringup.value
    ? { readiness: bringup.value.production_readiness, blockers: bringup.value.blockers, warnings: bringup.value.warnings, output_paths: bringup.value.output_paths }
    : bringup.error;
  if (bringup.value?.blockers.length) blockers.push(...bringup.value.blockers.map((item) => `bringup:${item}`));
  if (bringup.value?.warnings.length) warnings.push(...bringup.value.warnings.map((item) => `bringup:${item}`));

  const result: FirstLiveRunResult = {
    ok: blockers.length === 0,
    checked_at: new Date().toISOString(),
    date,
    readiness: {
      db: dbCheck.value?.ok ? "ready" : "not_ready",
      line: line.value?.ready ? "ready" : "not_ready",
      official_data: officialReady ? "ready" : "not_ready",
      tls: tlsReady ? "ready" : "not_ready",
      gpt_action: gpt.value?.ok ? "ready" : "not_ready",
      push: process.env.ENABLE_LINE_PUSH === "true" && Boolean(process.env.LINE_PUSH_TARGET_ID) ? "ready" : "not_ready",
      report_generated: e2e.value ? "ready" : "not_ready"
    },
    blockers: Array.from(new Set(blockers)),
    warnings: Array.from(new Set(warnings)),
    next_actions: buildNextActions(blockers, warnings),
    steps
  };
  const outputPaths = await writeFirstLiveRunOutputs(result, outputDir);
  return { ...result, output_paths: outputPaths };
}

async function safe<T>(name: string, fn: () => Promise<T>): Promise<{ value?: T; error?: { name: string; message: string } }> {
  try {
    return { value: await fn() };
  } catch (error) {
    return { error: { name, message: String(error) } };
  }
}

function buildNextActions(blockers: string[], warnings: string[]): string[] {
  const actions: string[] = [];
  if (blockers.some((item) => item.includes("DATABASE_URL") || item.includes("db:"))) {
    actions.push("設定 DATABASE_URL 後執行 npm run db:migrate 與 npm run db:check。");
  }
  if (blockers.some((item) => item.includes("LINE") || item.includes("line:"))) {
    actions.push("設定 LINE_CHANNEL_SECRET、LINE_CHANNEL_ACCESS_TOKEN、USER_HASH_SECRET，部署 webhook 後執行 npm run line:prod-check。");
  }
  if (blockers.some((item) => item.includes("GPT_ACTION_BEARER_TOKEN")) || warnings.some((item) => item.includes("gpt_action"))) {
    actions.push("設定 GPT_ACTION_BEARER_TOKEN 後執行 npm run gpt:action:smoke。");
  }
  if (warnings.some((item) => item.includes("tls") || item.includes("official_data"))) {
    actions.push("修正 CA 憑證鏈或設定 NODE_EXTRA_CA_CERTS，再執行 npm run tls:diagnose 與 npm run live:check。");
  }
  if (warnings.some((item) => item.includes("report:save"))) {
    actions.push("確認 DB 可用後重新執行 npm run report:save -- today postmarket。");
  }
  if (!actions.length) actions.push("first live run ready；可進入真實 LINE webhook 與推播測試。");
  return Array.from(new Set(actions));
}

async function writeFirstLiveRunOutputs(result: FirstLiveRunResult, outputDir: string) {
  await mkdir(outputDir, { recursive: true });
  const json = path.join(outputDir, "latest.json");
  const markdown = path.join(outputDir, "latest.md");
  await writeFile(json, JSON.stringify(result, null, 2), "utf8");
  await writeFile(markdown, renderFirstLiveRunMarkdown(result), "utf8");
  return { json, markdown };
}

function renderFirstLiveRunMarkdown(result: FirstLiveRunResult): string {
  return [
    "# First Live Run",
    "",
    `- ok: ${result.ok}`,
    `- date: ${result.date}`,
    "",
    "## Readiness",
    ...Object.entries(result.readiness).map(([key, value]) => `- ${key}: ${value}`),
    "",
    "## Blockers",
    result.blockers.length ? result.blockers.map((item) => `- ${item}`).join("\n") : "- none",
    "",
    "## Warnings",
    result.warnings.length ? result.warnings.map((item) => `- ${item}`).join("\n") : "- none",
    "",
    "## Next Actions",
    ...result.next_actions.map((item) => `- ${item}`)
  ].join("\n");
}

if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  process.stdout.write(JSON.stringify(await runFirstLiveRun(), null, 2) + "\n");
}
