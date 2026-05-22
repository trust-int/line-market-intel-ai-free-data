import cron from "node-cron";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";
import { analyzeJob } from "./analyze.js";
import { collectMarketJob } from "./collect-market.js";
import { collectNewsJob } from "./collect-news.js";
import { reportJob } from "./reports.js";
import { buildDailyMarketSnapshotJob } from "./build-daily-market-snapshot.js";

const TAIPEI_CRON_OPTIONS = { timezone: "Asia/Taipei" };

export function startScheduler(): void {
  schedule("10 8 * * 1-5", "premarket_report", () => reportJob("daily"));
  schedule("55 8 * * 1-5", "auction_snapshot_report", () => collectMarketJob());
  schedule("15 9 * * 1-5", "open_reaction_report", () => reportJob("intraday"));
  schedule("0 10 * * 1-5", "trend_confirmation_report", () => reportJob("intraday"));
  schedule("30 11 * * 1-5", "midday_report", () => reportJob("intraday"));
  schedule("20 13 * * 1-5", "preclose_report", () => reportJob("intraday"));
  schedule("35 15 * * 1-5", "postmarket_snapshot", () => buildDailyMarketSnapshotJob());
  schedule("30 18 * * 1-5", "institutional_update_report", () => collectNewsJob());
  schedule("30 20 * * 1-5", "final_daily_report", async () => {
    await buildDailyMarketSnapshotJob();
    return analyzeJob();
  });
  schedule("0 21 * * 5", "weekly_report", () => reportJob("weekly"));

  logger.info("scheduler started", { aiMode: config.aiMode });
}

function schedule(name: string, label: string, task: () => Promise<unknown>): void {
  cron.schedule(name, () => {
    logger.info("scheduled job started", { label });
    task().catch((error) => logger.error("scheduled job failed", { label, error: String(error) }));
  }, TAIPEI_CRON_OPTIONS);
}
