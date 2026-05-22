import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runFirstLiveRun } from "../src/jobs/first-live-run.js";

describe("first live run", () => {
  it("does not crash without DATABASE_URL or LINE secrets and writes latest outputs", async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), "stock-first-live-run-"));
    const result = await runFirstLiveRun("2026-05-23", outputDir, {
      prodCheck: async () => ({
        ready: false,
        checked_at: "2026-05-23T00:00:00Z",
        blockers: ["DATABASE_URL", "LINE_CHANNEL_SECRET"],
        warnings: [],
        checks: []
      }),
      dbMigrate: async () => ({ ok: false, action: "migrate", message: "DATABASE_URL missing" }),
      dbCheck: async () => ({ ok: false, action: "check", message: "DATABASE_URL missing" }),
      tlsDiagnose: async () => ({
        checked_at: "2026-05-23T00:00:00Z",
        node_version: "test",
        platform: "test",
        openssl_version: "test",
        critical_warnings: [],
        providers: [
          { provider: "TWSE", url: "https://twse.example", ok: false, tls_error_code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE" }
        ]
      }),
      liveCheck: async () => [
        { provider: "TWSE", status: "tls_error", url: "https://twse.example", checked_at: "2026-05-23T00:00:00Z" },
        { provider: "TPEx", status: "tls_error", url: "https://tpex.example", checked_at: "2026-05-23T00:00:00Z" },
        { provider: "MOPS", status: "tls_error", url: "https://mops.example", checked_at: "2026-05-23T00:00:00Z" }
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
        date: "2026-05-23",
        reportPath: "outputs/reports/2026-05-23.md",
        markdown: "",
        snapshot: { trade_date: "2026-05-23", market_bias: "neutral", risk_level: "medium", data_quality_score: 0, data_gaps: [], source_status: {} },
        sourceStatus: {},
        dataGaps: [],
        dataQuality: { score: 0, level: "insufficient", reasons: [], source_status: {}, data_gaps: [] },
        paths: {
          reportMarkdown: "outputs/reports/2026-05-23.md",
          reportJson: "outputs/reports/2026-05-23.json",
          manualPackMarkdown: "outputs/manual-packs/2026-05-23.md",
          sourceStatus: "outputs/source-status/2026-05-23.json",
          dataQuality: "outputs/data-quality/2026-05-23.json"
        }
      } as never),
      reportSave: async () => ({ ok: true, date: "2026-05-23", report_type: "postmarket", db_unavailable: true }),
      bringup: async () => ({
        ok: false,
        checked_at: "2026-05-23T00:00:00Z",
        production_readiness: {
          db: "not_ready",
          line: "not_ready",
          official_data: "not_ready",
          tls: "not_ready",
          gpt_action: "not_ready",
          push: "not_ready",
          e2e_auto_dry_run: "ready"
        },
        blockers: ["db:not_ready", "line:not_ready"],
        warnings: ["official_data:not_ready"],
        next_steps: [],
        details: {}
      })
    });

    expect(result.ok).toBe(false);
    expect(result.blockers).toContain("prod:DATABASE_URL");
    expect(result.blockers).toContain("prod:LINE_CHANNEL_SECRET");
    expect(result.next_actions.length).toBeGreaterThan(0);
    await expect(stat(result.output_paths!.json)).resolves.toBeTruthy();
    await expect(stat(result.output_paths!.markdown)).resolves.toBeTruthy();
  });
});
