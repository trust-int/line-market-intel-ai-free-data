import { config } from "../config.js";
import { ReportEngine, type BuildReportInput } from "../analysis/report-engine.js";
import { CostGuard } from "../cost/cost-guard.js";
import { renderStrategyReportMarkdown } from "./markdown.js";
import { generateMarketManualGptPack } from "./market-manual-pack.js";

export async function generateIntradayReport(input: Omit<BuildReportInput, "reportType" | "costUsage"> = {}) {
  if (config.aiMode === "manual") {
    return generateMarketManualGptPack(input.date, "intraday");
  }
  const costUsage = await new CostGuard().readUsage();
  const report = new ReportEngine().build({ ...input, reportType: "intraday", costUsage });
  return {
    report,
    markdown: renderStrategyReportMarkdown(report)
  };
}
