import type { StrategyReport } from "../analysis/schemas.js";

export function renderLineReportMessage(report: StrategyReport): string {
  if (report.cost_guard.ai_mode === "manual") {
    return `${report.date} ${report.report_type} manual_gpt_pack 已完成。AI_MODE=manual 不推送 AI 策略結論，請下載資料包後手動分析。`;
  }

  return [
    `${report.date} ${report.report_type} 台股策略`,
    `多空：${report.market.bias} (${report.market.bias_score})`,
    `大戶：${report.market.smart_money_phase} / 信心 ${report.market.smart_money_confidence}`,
    `資料缺口：${report.data_gaps.length ? report.data_gaps.join("、") : "無"}`,
    "提醒：不自動下單；沒有回測不顯示勝率。"
  ].join("\n");
}
