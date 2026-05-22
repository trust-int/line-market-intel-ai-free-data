import { describe, expect, it } from "vitest";
import { checkDatabaseSchema, findMissingRequiredTables, seedDevDatabase } from "../src/jobs/db-bootstrap.js";

describe("DB bootstrap", () => {
  it("db:check returns a clear error without DATABASE_URL", async () => {
    const result = await checkDatabaseSchema(undefined);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("DATABASE_URL");
  });

  it("detects missing required tables", () => {
    const missing = findMissingRequiredTables(["data_sources", "line_messages"]);
    expect(missing).toContain("market_daily");
    expect(missing).toContain("manual_gpt_packs");
  });

  it("blocks dev seed in production unless explicitly allowed", async () => {
    const result = await seedDevDatabase("postgres://fixture", { NODE_ENV: "production" });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("blocked in production");
  });
});
