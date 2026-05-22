import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkDatabaseSchema } from "./db-bootstrap.js";
import { runDailyE2EDryRun } from "./e2e-daily-dry-run.js";
import { smokeGptAction } from "./gpt-action-production.js";
import { runLineProdCheck } from "./line-prod-check.js";
import { runProductionCheck } from "./prod-check.js";
import { diagnoseTls } from "./tls-diagnose.js";
import { runLiveFetchCheck, writeLiveFetchCheckOutputs } from "../providers/health/live-fetch-check.js";
import { todayTaipei } from "../utils/date.js";

export type BringupLiveResult = {
  ok: boolean;
  checked_at: string;
  production_readiness: {
    db: "ready" | "not_ready";
    line: "ready" | "not_ready";
    official_data: "ready" | "not_ready";
    tls: "ready" | "not_ready" | "not_run";
    gpt_action: "ready" | "not_ready";
    push: "ready" | "not_ready";
    e2e_auto_dry_run: "ready" | "not_ready";
  };
  blockers: string[];
  warnings: string[];
  next_steps: string[];
  details: Record<string, unknown>;
  output_paths?: {
    json: string;
    markdown: string;
  };
};

export type BringupLiveDeps = {
  prodCheck?: typeof runProductionCheck;
  dbCheck?: typeof checkDatabaseSchema;
  liveCheck?: typeof runLiveFetchCheck;
  tlsDiagnose?: typeof diagnoseTls;
  lineCheck?: typeof runLineProdCheck;
  gptSmoke?: typeof smokeGptAction;
  e2e?: typeof runDailyE2EDryRun;
};

export async function runBringupLive(
  date = todayTaipei(),
  outputDir = path.resolve(process.cwd(), "outputs", "bringup"),
  deps: BringupLiveDeps = {}
): Promise<BringupLiveResult> {
  const details: Record<string, unknown> = {};
  const blockers: string[] = [];
  const warnings: string[] = [];

  const prod = await safe("prod_check", () => (deps.prodCheck ?? runProductionCheck)(process.env));
  details.prod_check = prod.value ?? prod.error;
  if (prod.value?.blockers.length) blockers.push(...prod.value.blockers.map((item) => `prod:${item}`));
  if (prod.value?.warnings.length) warnings.push(...prod.value.warnings.map((item) => `prod:${item}`));

  const dbCheck = await safe("db_check", () => (deps.dbCheck ?? checkDatabaseSchema)());
  details.db_check = dbCheck.value ?? dbCheck.error;
  if (!dbCheck.value?.ok) blockers.push("db:not_ready");

  const live = await safe("live_check", async () => {
    const results = await (deps.liveCheck ?? runLiveFetchCheck)(date);
    const outputs = await writeLiveFetchCheckOutputs(date, results);
    return { results, outputs };
  });
  details.live_check = live.value ?? live.error;
  const liveResults = live.value?.results ?? [];
  const tlsNeeded = liveResults.some((item) => item.status === "tls_error");
  const tls = tlsNeeded ? await safe("tls_diagnose", () => (deps.tlsDiagnose ?? diagnoseTls)(date)) : undefined;
  if (tls) details.tls_diagnose = tls.value ?? tls.error;

  const line = await safe("line_prod_check", () => Promise.resolve((deps.lineCheck ?? runLineProdCheck)()));
  details.line_prod_check = line.value ?? line.error;
  if (!line.value?.ready) blockers.push("line:not_ready");

  const gpt = await safe("gpt_action_smoke", () => (deps.gptSmoke ?? smokeGptAction)(date));
  details.gpt_action_smoke = gpt.value ?? gpt.error;
  if (!gpt.value?.ok) warnings.push("gpt_action:not_ready");

  const e2e = await safe("e2e_auto_dry_run", () => (deps.e2e ?? runDailyE2EDryRun)(date, { mode: "auto", push: false }));
  details.e2e_auto_dry_run = e2e.value
    ? { reportPath: e2e.value.reportPath, paths: e2e.value.paths, dataQuality: e2e.value.dataQuality }
    : e2e.error;
  if (!e2e.value) blockers.push("e2e:not_ready");

  const officialReady = liveResults.length > 0 && liveResults.every((item) => item.status === "ok");
  if (!officialReady) warnings.push("official_data:not_ready");
  const result: BringupLiveResult = {
    ok: blockers.length === 0,
    checked_at: new Date().toISOString(),
    production_readiness: {
      db: dbCheck.value?.ok ? "ready" : "not_ready",
      line: line.value?.ready ? "ready" : "not_ready",
      official_data: officialReady ? "ready" : "not_ready",
      tls: tlsNeeded ? (tls?.value ? "not_ready" : "not_run") : "ready",
      gpt_action: gpt.value?.ok ? "ready" : "not_ready",
      push: process.env.ENABLE_LINE_PUSH === "true" && process.env.LINE_PUSH_TARGET_ID ? "ready" : "not_ready",
      e2e_auto_dry_run: e2e.value ? "ready" : "not_ready"
    },
    blockers: Array.from(new Set(blockers)),
    warnings: Array.from(new Set(warnings)),
    next_steps: buildNextSteps(blockers, warnings),
    details
  };
  const paths = await writeBringupOutputs(result, outputDir);
  return { ...result, output_paths: paths };
}

async function safe<T>(name: string, fn: () => Promise<T>): Promise<{ value?: T; error?: { name: string; message: string } }> {
  try {
    return { value: await fn() };
  } catch (error) {
    return { error: { name, message: String(error) } };
  }
}

function buildNextSteps(blockers: string[], warnings: string[]): string[] {
  const steps: string[] = [];
  if (blockers.some((item) => item.includes("DATABASE_URL") || item.includes("db"))) steps.push("設定 DATABASE_URL，執行 npm run db:migrate 與 npm run db:check。");
  if (blockers.some((item) => item.includes("LINE") || item.includes("line"))) steps.push("設定 LINE secrets，部署 webhook，執行 npm run line:prod-check。");
  if (warnings.some((item) => item.includes("official_data"))) steps.push("修正 TLS/網路後執行 npm run live:check 與 npm run tls:diagnose。");
  if (warnings.some((item) => item.includes("gpt_action"))) steps.push("設定 GPT_ACTION_BEARER_TOKEN 並執行 npm run gpt:action:smoke。");
  if (!steps.length) steps.push("Bring-up checks are ready for a real production dry run.");
  return steps;
}

async function writeBringupOutputs(result: BringupLiveResult, outputDir: string) {
  await mkdir(outputDir, { recursive: true });
  const json = path.join(outputDir, "latest.json");
  const markdown = path.join(outputDir, "latest.md");
  await writeFile(json, JSON.stringify(result, null, 2), "utf8");
  await writeFile(markdown, renderBringupMarkdown(result), "utf8");
  return { json, markdown };
}

function renderBringupMarkdown(result: BringupLiveResult): string {
  return [
    "# Bringup Live Report",
    "",
    `- ok: ${result.ok}`,
    "",
    "## Production Readiness",
    ...Object.entries(result.production_readiness).map(([key, value]) => `- ${key}: ${value}`),
    "",
    "## Blockers",
    result.blockers.length ? result.blockers.map((item) => `- ${item}`).join("\n") : "- none",
    "",
    "## Warnings",
    result.warnings.length ? result.warnings.map((item) => `- ${item}`).join("\n") : "- none",
    "",
    "## Next Steps",
    ...result.next_steps.map((item) => `- ${item}`)
  ].join("\n");
}

if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  process.stdout.write(JSON.stringify(await runBringupLive(), null, 2) + "\n");
}
