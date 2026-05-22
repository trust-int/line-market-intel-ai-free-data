import { mkdtemp, stat } from "node:fs/promises";
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

describe("E2E production dry run modes", () => {
  it("generates fixed outputs in auto, live and fixture mode", async () => {
    for (const mode of ["auto", "live", "fixture"] as const) {
      const outputDir = await mkdtemp(path.join(tmpdir(), `stock-e2e-${mode}-`));
      const result = await runDailyE2EDryRun("2026-05-07", { mode, liveResults: failedLiveResults, outputDir, writeManualPack: false });
      await expect(stat(result.paths.reportMarkdown)).resolves.toBeTruthy();
      await expect(stat(result.paths.reportJson)).resolves.toBeTruthy();
      await expect(stat(result.paths.manualPackMarkdown)).resolves.toBeTruthy();
      await expect(stat(result.paths.sourceStatus)).resolves.toBeTruthy();
      await expect(stat(result.paths.dataQuality)).resolves.toBeTruthy();
      if (mode === "live") expect(result.sourceStatus.twse_mi_index).toBe("network_error");
      if (mode === "auto") expect(result.sourceStatus.twse_mi_index).toContain("fixture_fallback");
      if (mode === "fixture") expect(result.sourceStatus.twse_mi_index).toBe("fixture_only");
    }
  });
});
