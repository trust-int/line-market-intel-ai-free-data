import { generateDailyReport } from "../reports/daily.js";

export async function analyzeJob() {
  return generateDailyReport();
}
