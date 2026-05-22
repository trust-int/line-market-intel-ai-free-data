export type RiskAlert = {
  level: "low" | "medium" | "high" | "critical";
  ticker?: string;
  message: string;
};

export class RiskEngine {
  detect(params: { dataGaps?: string[]; overheatedTickers?: string[]; providerFailures?: string[] }): RiskAlert[] {
    const alerts: RiskAlert[] = [];
    for (const ticker of params.overheatedTickers ?? []) {
      alerts.push({ level: "high", ticker, message: "標的過熱或社群熱度偏高，避免追價" });
    }
    if ((params.dataGaps?.length ?? 0) > 0) {
      alerts.push({ level: "medium", message: `資料缺口：${params.dataGaps?.join("、")}` });
    }
    if ((params.providerFailures?.length ?? 0) > 0) {
      alerts.push({ level: "medium", message: `部分 provider unavailable：${params.providerFailures?.join("、")}` });
    }
    return alerts;
  }
}
