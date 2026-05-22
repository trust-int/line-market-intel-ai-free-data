import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runBringupLive } from "../src/jobs/bringup-live.js";

describe("bringup live command", () => {
  it("reports blockers and writes output without crashing", async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), "stock-bringup-"));
    const result = await runBringupLive("2026-05-07", outputDir, {
      prodCheck: async () => ({
        ready: false,
        checked_at: "2026-05-07T00:00:00Z",
        blockers: ["DATABASE_URL"],
        warnings: [],
        checks: []
      }),
      dbCheck: async () => ({ ok: false, action: "check", message: "DATABASE_URL missing" }),
      liveCheck: async () => [
        { provider: "TWSE", status: "network_error", url: "https://twse.example", checked_at: "2026-05-07T00:00:00Z" },
        { provider: "TPEx", status: "network_error", url: "https://tpex.example", checked_at: "2026-05-07T00:00:00Z" },
        { provider: "MOPS", status: "network_error", url: "https://mops.example", checked_at: "2026-05-07T00:00:00Z" }
      ],
      lineCheck: () => ({
        ready: false,
        webhook_url: "http://localhost:3000/line/webhook",
        checks: { LINE_CHANNEL_SECRET: "missing" },
        checklist: [],
        notes: []
      }),
      gptSmoke: async () => ({ ok: false, openapi_valid: true, auth_required: true, endpoints: {}, no_raw_line_user_id: true, no_paid_fulltext: true }),
      e2e: async () => ({
        date: "2026-05-07",
        reportPath: "outputs/reports/2026-05-07.md",
        markdown: "",
        snapshot: { trade_date: "2026-05-07", market_bias: "neutral", risk_level: "medium", data_quality_score: 0, data_gaps: [], source_status: {} },
        sourceStatus: {},
        dataGaps: [],
        dataQuality: { score: 0, level: "insufficient", reasons: [], source_status: {}, data_gaps: [] },
        paths: {
          reportMarkdown: "outputs/reports/2026-05-07.md",
          reportJson: "outputs/reports/2026-05-07.json",
          manualPackMarkdown: "outputs/manual-packs/2026-05-07.md",
          sourceStatus: "outputs/source-status/2026-05-07.json",
          dataQuality: "outputs/data-quality/2026-05-07.json"
        }
      } as never)
    });
    expect(result.ok).toBe(false);
    expect(result.blockers).toContain("prod:DATABASE_URL");
    await expect(stat(result.output_paths!.json)).resolves.toBeTruthy();
    await expect(stat(result.output_paths!.markdown)).resolves.toBeTruthy();
  });
});
