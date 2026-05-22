import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateDailyReport } from "../reports/daily.js";
import { generateIntradayReport } from "../reports/intraday.js";
import { generateWeeklyReport } from "../reports/weekly.js";

export async function reportJob(type: "daily" | "intraday" | "weekly" = "daily") {
  if (type === "weekly") return generateWeeklyReport();
  if (type === "intraday") return generateIntradayReport();
  return generateDailyReport();
}

if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  const type = (process.argv[2] as "daily" | "intraday" | "weekly" | undefined) ?? "daily";
  const result = await reportJob(type);
  process.stdout.write(result.markdown);
}
