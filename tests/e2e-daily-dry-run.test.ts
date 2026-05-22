import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runDailyE2EDryRun, type E2EOfficialData } from "../src/jobs/e2e-daily-dry-run.js";
import type { LiveFetchCheckResult } from "../src/providers/health/live-fetch-check.js";

const failedLiveResults: LiveFetchCheckResult[] = [
  { provider: "TWSE", status: "network_error", url: "https://twse.example", checked_at: "2026-05-07T00:00:00Z", error_message: "fetch failed" },
  { provider: "TPEx", status: "network_error", url: "https://tpex.example", checked_at: "2026-05-07T00:00:00Z", error_message: "fetch failed" },
  { provider: "MOPS", status: "network_error", url: "https://mops.example", checked_at: "2026-05-07T00:00:00Z", error_message: "fetch failed" }
];

describe("daily E2E dry run", () => {
  it("runs the daily production dry-run pipeline and writes markdown", async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), "stock-e2e-"));
    const result = await runDailyE2EDryRun("2026-05-07", {
      liveResults: failedLiveResults,
      outputDir
    });
    const markdown = await readFile(result.reportPath, "utf8");
    expect(result.reportPath).toBe(path.join(outputDir, "2026-05-07.md"));
    expect(markdown).toContain("# 2026-05-07 台股 Daily E2E Dry Run");
    expect(markdown).toContain("## data_source_status");
    expect(markdown).toContain("twse_mi_index_fixture_fallback_from_network_error");
    expect(markdown).not.toContain("win_rate");
    expect(markdown).not.toContain("historical_hit_rate");
  });

  it("falls back to fixtures when live fetch fails and records source status", async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), "stock-e2e-"));
    const result = await runDailyE2EDryRun("2026-05-07", {
      liveResults: failedLiveResults,
      outputDir
    });
    expect(result.snapshot.taiex_close).toBe(23500.25);
    expect(result.snapshot.otc_close).toBe(250.5);
    expect(result.sourceStatus.twse).toBe("network_error");
    expect(result.sourceStatus.twse_mi_index).toBe("fixture_fallback_from_network_error");
    expect(result.dataGaps).toContain("twse_live_fetch_network_error");
    expect(result.dataGaps).toContain("mops_material_news_fixture_fallback_from_network_error");
  });

  it("does not promote fixture-only market rows into watch candidates", async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), "stock-e2e-"));
    const result = await runDailyE2EDryRun("2026-05-07", {
      liveResults: failedLiveResults,
      outputDir
    });
    expect(result.markdown).toContain("2330 台積電：watch");
    expect(result.markdown).not.toContain("6488 環球晶：watch");
    expect(result.markdown).not.toContain("2317 鴻海：watch");
    expect(result.markdown).toContain("big_money_strategy：wait");
  });

  it("does not hallucinate sectors or trading candidates when data is insufficient", async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), "stock-e2e-"));
    const officialData: E2EOfficialData = {
      indexes: [],
      stockDaily: [],
      breadth: [],
      institutionalSummaries: [],
      institutionalFlows: [],
      marginSummaries: [],
      marginShort: [],
      mopsMaterialNews: [],
      sourceStatus: { twse_mi_index: "data_unavailable", tpex_index: "data_unavailable", mops_material_news: "data_unavailable" },
      dataGaps: ["official_market_data_missing"]
    };
    const result = await runDailyE2EDryRun("2026-05-07", {
      liveResults: failedLiveResults,
      officialData,
      outputDir,
      writeManualPack: false
    });
    expect(result.markdown).toContain("資料不足，未列強勢族群");
    expect(result.markdown).toContain("資料不足，未列當沖候選");
    expect(result.markdown).toContain("資料不足，未列波段候選");
    expect(result.markdown).not.toContain("daytrade_long");
    expect(result.markdown).not.toContain("swing_candidates");
    expect(result.markdown).not.toContain("2330");
  });
});
