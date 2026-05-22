import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { pushReportJob } from "../src/jobs/push-report.js";

describe("LINE report push", () => {
  it("skips when disabled", async () => {
    const result = await pushReportJob("2026-05-07", "postmarket", { enabled: false });
    expect(result.skipped).toBe(true);
  });

  it("does not crash when enabled but target is missing", async () => {
    const result = await pushReportJob("2026-05-07", "postmarket", { enabled: true, targetId: "" });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("LINE_PUSH_TARGET_ID_missing");
  });

  it("marks low data quality and avoids banned fields", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "stock-push-"));
    const dataQualityPath = path.join(dir, "dq.json");
    await writeFile(dataQualityPath, JSON.stringify({ score: 10, data_gaps: ["twse_error"] }), "utf8");
    let sent = "";
    const result = await pushReportJob("2026-05-07", "postmarket", {
      enabled: true,
      targetId: "G1",
      dataQualityPath,
      sendText: async (text) => { sent = text; }
    });
    expect(result.ok).toBe(true);
    expect(sent).toContain("資料品質不足");
    expect(sent).not.toContain("win_rate");
    expect(sent).not.toContain("自動下單");
  });
});
