import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { pushReportJob } from "../src/jobs/push-report.js";

describe("LINE push production rules", () => {
  it("adds low data quality warning", async () => {
    const { dq, report } = await writePushInputs({ score: 10, data_gaps: ["twse_tls_error"] });
    let sent = "";
    await pushReportJob("2026-05-07", "postmarket", {
      enabled: true,
      targetId: "G1",
      dataQualityPath: dq,
      reportJsonPath: report,
      officialDataMode: "auto",
      sendText: async (text) => { sent = text; }
    });
    expect(sent.split("\n")[0]).toContain("資料品質不足");
    expect(sent).not.toContain("win_rate");
    expect(sent).not.toContain("自動下單");
  });

  it("adds fixture warning", async () => {
    const { dq, report } = await writePushInputs({ score: 20, data_gaps: ["fixture_only"] });
    let sent = "";
    await pushReportJob("2026-05-07", "postmarket", {
      enabled: true,
      targetId: "G1",
      dataQualityPath: dq,
      reportJsonPath: report,
      officialDataMode: "fixture",
      sendText: async (text) => { sent = text; }
    });
    expect(sent.split("\n")[0]).toContain("Fixture 測試資料");
  });

  it("adds live insufficient warning", async () => {
    const { dq, report } = await writePushInputs({ score: 0, data_gaps: ["twse_tls_error"] });
    let sent = "";
    await pushReportJob("2026-05-07", "postmarket", {
      enabled: true,
      targetId: "G1",
      dataQualityPath: dq,
      reportJsonPath: report,
      officialDataMode: "live",
      sendText: async (text) => { sent = text; }
    });
    expect(sent.split("\n")[0]).toContain("Live 資料不足");
  });
});

async function writePushInputs(dataQuality: { score: number; data_gaps: string[] }) {
  const dir = await mkdtemp(path.join(tmpdir(), "stock-line-push-prod-"));
  await mkdir(dir, { recursive: true });
  const dq = path.join(dir, "dq.json");
  const report = path.join(dir, "report.json");
  await writeFile(dq, JSON.stringify(dataQuality), "utf8");
  await writeFile(report, JSON.stringify({ signalEngineResult: { market_bias: "neutral", big_money_strategy: ["wait"] } }), "utf8");
  return { dq, report };
}
