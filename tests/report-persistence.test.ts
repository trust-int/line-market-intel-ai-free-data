import { mkdir, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { Queryable } from "../src/db/client.js";
import { loadReportArtifacts, saveReportArtifacts } from "../src/jobs/report-persistence.js";

class FakeDb implements Queryable {
  queries: Array<{ sql: string; params?: unknown[] }> = [];
  async query<T = unknown>(sql: string, params?: unknown[]) {
    this.queries.push({ sql, params });
    return { rows: [] as T[], rowCount: 1 };
  }
}

describe("report persistence", () => {
  it("upserts strategy_reports and manual_gpt_packs", async () => {
    const date = "2099-01-01";
    await writeArtifacts(date);
    const database = new FakeDb();
    const result = await saveReportArtifacts(date, "postmarket", { database, databaseAvailable: true });
    expect(result.ok).toBe(true);
    expect(result.strategy_reports).toBe("saved");
    expect(result.manual_gpt_packs).toBe("saved");
    expect(database.queries.some((query) => query.sql.includes("insert into strategy_reports"))).toBe(true);
    expect(database.queries.some((query) => query.sql.includes("insert into manual_gpt_packs"))).toBe(true);
  });

  it("falls back to files when DB is unavailable", async () => {
    const date = "2099-01-02";
    await writeArtifacts(date);
    const saved = await saveReportArtifacts(date, "postmarket", { databaseAvailable: false });
    expect(saved.db_unavailable).toBe(true);
    const loaded = await loadReportArtifacts(date, "postmarket", { databaseAvailable: false });
    expect(loaded.ok).toBe(true);
    expect(loaded.source).toBe("file");
  });
});

async function writeArtifacts(date: string): Promise<void> {
  await mkdir("outputs/reports", { recursive: true });
  await mkdir("outputs/manual-packs", { recursive: true });
  await writeFile(`outputs/reports/${date}.md`, `# ${date} report`, "utf8");
  await writeFile(
    `outputs/reports/${date}.json`,
    JSON.stringify({ signalEngineResult: { market_bias: "neutral", big_money_strategy: ["wait"] } }),
    "utf8"
  );
  await writeFile(`outputs/manual-packs/${date}.md`, `# ${date} manual pack`, "utf8");
}
