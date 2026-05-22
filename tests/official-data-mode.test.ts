import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runDailyE2EDryRun } from "../src/jobs/e2e-daily-dry-run.js";
import type { LiveFetchCheckResult } from "../src/providers/health/live-fetch-check.js";

const failedLiveResults: LiveFetchCheckResult[] = [
  { provider: "TWSE", status: "network_error", url: "https://twse.example", checked_at: "2026-05-07T00:00:00Z" },
  { provider: "TPEx", status: "network_error", url: "https://tpex.example", checked_at: "2026-05-07T00:00:00Z" },
  { provider: "MOPS", status: "network_error", url: "https://mops.example", checked_at: "2026-05-07T00:00:00Z" }
];

describe("OFFICIAL_DATA_MODE", () => {
  it("live mode does not fallback to fixtures", async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), "stock-mode-live-"));
    const result = await runDailyE2EDryRun("2026-05-07", { mode: "live", liveResults: failedLiveResults, outputDir, writeManualPack: false });
    expect(result.snapshot.taiex_close).toBeUndefined();
    expect(result.sourceStatus.twse_mi_index).toBe("network_error");
    expect(result.dataGaps).not.toContain("twse_mi_index_fixture_fallback_from_network_error");
    expect(result.dataQuality.level).toBe("insufficient");
  });

  it("auto mode falls back to fixtures and lowers data quality", async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), "stock-mode-auto-"));
    const result = await runDailyE2EDryRun("2026-05-07", { mode: "auto", liveResults: failedLiveResults, outputDir, writeManualPack: false });
    expect(result.snapshot.taiex_close).toBe(23500.25);
    expect(result.sourceStatus.twse_mi_index).toBe("fixture_fallback_from_network_error");
    expect(result.dataQuality.score).toBeLessThanOrEqual(30);
    expect(result.dataQuality.level).toBe("fixture_only");
  });

  it("fixture mode marks test data", async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), "stock-mode-fixture-"));
    const result = await runDailyE2EDryRun("2026-05-07", { mode: "fixture", liveResults: failedLiveResults, outputDir, writeManualPack: false });
    expect(result.sourceStatus.twse_mi_index).toBe("fixture_only");
    expect(result.dataGaps).toContain("official_data_mode_fixture_test_data");
    expect(result.markdown).toContain("official_data_mode_fixture_test_data");
  });
});
