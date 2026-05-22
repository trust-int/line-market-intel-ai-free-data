import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import express from "express";
import type { Queryable } from "../db/client.js";
import { db } from "../db/client.js";

export type HealthStatus = {
  status: "ready" | "not_ready";
  db: "ready" | "missing_database_url" | "error";
  line: "ready" | "missing_secrets";
  official_data: "ready" | "tls_error" | "not_ready" | "unknown";
  gpt_action: "ready" | "missing_token";
  paid_data_api: "disabled" | "enabled";
  futu: "disabled" | "enabled_confirmed" | "enabled_without_permission";
  blockers: string[];
  checked_at: string;
};

export function createHealthRouter(deps: { database?: Queryable; env?: NodeJS.ProcessEnv } = {}) {
  const router = express.Router();

  router.get("/live", (_req, res) => {
    res.status(200).json({
      status: "live",
      service: "line-market-intel-ai-free-data",
      checked_at: new Date().toISOString()
    });
  });

  router.get("/ready", async (_req, res) => {
    const status = await evaluateHealthStatus({ ...deps, includeDbProbe: true });
    res.status(status.status === "ready" ? 200 : 503).json(status);
  });

  router.get("/", async (_req, res) => {
    res.json(await evaluateHealthStatus({ ...deps, includeDbProbe: true }));
  });

  return router;
}

export async function evaluateHealthStatus(
  options: { database?: Queryable; env?: NodeJS.ProcessEnv; includeDbProbe?: boolean } = {}
): Promise<HealthStatus> {
  const env = options.env ?? process.env;
  const blockers: string[] = [];
  const dbStatus = await evaluateDb(env, options.database ?? db, Boolean(options.includeDbProbe));
  if (dbStatus !== "ready") blockers.push(`db:${dbStatus}`);

  const lineStatus = env.LINE_CHANNEL_SECRET && env.LINE_CHANNEL_ACCESS_TOKEN && env.USER_HASH_SECRET && env.USER_HASH_SECRET !== "change-me"
    ? "ready"
    : "missing_secrets";
  if (lineStatus !== "ready") blockers.push("line:missing_secrets");

  const gptActionStatus = env.GPT_ACTION_BEARER_TOKEN && env.GPT_ACTION_BEARER_TOKEN !== "change-me-too"
    ? "ready"
    : "missing_token";
  if (gptActionStatus !== "ready") blockers.push("gpt_action:missing_token");

  const paidDataApi = env.NO_PAID_DATA_API === "false" || env.DISABLE_PAID_MARKET_DATA === "false"
    ? "enabled"
    : "disabled";
  if (paidDataApi !== "disabled") blockers.push("paid_data_api:enabled");

  const futu = env.ENABLE_FUTU === "true"
    ? env.FUTU_PERMISSION_CONFIRMED === "true" ? "enabled_confirmed" : "enabled_without_permission"
    : "disabled";
  if (futu === "enabled_without_permission") blockers.push("futu:enabled_without_permission");

  const officialData = await readLatestOfficialDataStatus();
  if (officialData === "tls_error") blockers.push("official_data:tls_error");

  return {
    status: blockers.length === 0 ? "ready" : "not_ready",
    db: dbStatus,
    line: lineStatus,
    official_data: officialData,
    gpt_action: gptActionStatus,
    paid_data_api: paidDataApi,
    futu,
    blockers,
    checked_at: new Date().toISOString()
  };
}

async function evaluateDb(env: NodeJS.ProcessEnv, database: Queryable, includeDbProbe: boolean): Promise<HealthStatus["db"]> {
  if (!env.DATABASE_URL) return "missing_database_url";
  if (!includeDbProbe) return "ready";
  try {
    await database.query("select 1");
    return "ready";
  } catch {
    return "error";
  }
}

async function readLatestOfficialDataStatus(): Promise<HealthStatus["official_data"]> {
  const dir = path.resolve(process.cwd(), "outputs", "live-check");
  try {
    const files = (await readdir(dir, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name)
      .sort();
    const latest = files.at(-1);
    if (!latest) return "unknown";
    const payload = JSON.parse(await readFile(path.join(dir, latest), "utf8")) as {
      results?: Array<{ status?: string }>;
    };
    const statuses = payload.results?.map((item) => item.status).filter(Boolean) ?? [];
    if (!statuses.length) return "unknown";
    if (statuses.every((status) => status === "ok")) return "ready";
    if (statuses.some((status) => status === "tls_error")) return "tls_error";
    return "not_ready";
  } catch {
    return "unknown";
  }
}
