import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runProductionCheck } from "../src/jobs/prod-check.js";

const baseEnv: NodeJS.ProcessEnv = {
  DATABASE_URL: "postgres://user:pass@localhost:5432/db",
  LINE_CHANNEL_SECRET: "line-secret",
  LINE_CHANNEL_ACCESS_TOKEN: "line-access-token-long-enough",
  USER_HASH_SECRET: "user-hash-secret-long-enough",
  GPT_ACTION_BEARER_TOKEN: "gpt-action-token",
  NEWS_INGEST_ALLOWED_SOURCES: "manual_test,line_manual,line_manual_pack",
  OFFICIAL_DATA_MODE: "auto",
  AI_MODE: "manual",
  NO_PAID_DATA_API: "true",
  DISABLE_PAID_MARKET_DATA: "true",
  DISABLE_NEWS_SCRAPING: "true",
  ENABLE_FUTU: "false",
  ENABLE_LINE_PUSH: "false"
};

describe("production environment check", () => {
  it("marks missing DATABASE_URL as a blocker", async () => {
    const env = { ...baseEnv };
    delete env.DATABASE_URL;
    const result = await runProductionCheck(env, { skipDbConnection: true, outputDir: await tempDir() });
    expect(result.blockers).toContain("DATABASE_URL");
  });

  it("marks missing LINE secrets as blockers", async () => {
    const env = { ...baseEnv };
    delete env.LINE_CHANNEL_SECRET;
    delete env.LINE_CHANNEL_ACCESS_TOKEN;
    const result = await runProductionCheck(env, { skipDbConnection: true, outputDir: await tempDir() });
    expect(result.blockers).toContain("LINE_CHANNEL_SECRET");
    expect(result.blockers).toContain("LINE_CHANNEL_ACCESS_TOKEN");
  });

  it("blocks push enabled without target", async () => {
    const env = { ...baseEnv, ENABLE_LINE_PUSH: "true" };
    const result = await runProductionCheck(env, { skipDbConnection: true, outputDir: await tempDir() });
    expect(result.blockers).toContain("LINE_PUSH_TARGET_ID");
  });

  it("blocks paid data and unconfirmed Futu", async () => {
    const env = { ...baseEnv, NO_PAID_DATA_API: "false", DISABLE_PAID_MARKET_DATA: "false", ENABLE_FUTU: "true" };
    const result = await runProductionCheck(env, { skipDbConnection: true, outputDir: await tempDir() });
    expect(result.blockers).toContain("NO_PAID_DATA_API");
    expect(result.blockers).toContain("DISABLE_PAID_MARKET_DATA");
    expect(result.blockers).toContain("Futu_permission");
  });
});

function tempDir() {
  return mkdtemp(path.join(tmpdir(), "stock-prod-check-"));
}
