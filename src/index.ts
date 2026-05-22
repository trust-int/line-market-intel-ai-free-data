import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { config } from "./config.js";
import { createAdminRouter } from "./api/admin.js";
import { createDataSourceRouter } from "./api/data-source.js";
import { createGptActionRouter } from "./api/gpt-action.js";
import { createHealthRouter } from "./api/health.js";
import { createHoldingsRouter } from "./api/holdings.js";
import { createReportsRouter } from "./api/reports.js";
import { createWatchlistRouter } from "./api/watchlist.js";
import { createLineWebhookRouter } from "./line/webhook.js";
import { startScheduler } from "./jobs/scheduler.js";
import { logger } from "./utils/logger.js";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");

  app.use("/line", createLineWebhookRouter());
  app.use(express.json({ limit: "2mb" }));

  app.get("/", (_req, res) => {
    res.json({
      name: "line-market-intel-ai-free-data",
      ai_mode: config.aiMode,
      no_paid_data_api: config.noPaidDataApi,
      paid_data_api_used: false,
      auto_trading: false
    });
  });

  app.use("/health", createHealthRouter());
  app.use("/admin", createAdminRouter());
  app.use("/api/reports", createReportsRouter());
  app.use("/api/holdings", createHoldingsRouter());
  app.use("/api/watchlist", createWatchlistRouter());
  app.use("/api/data-sources", createDataSourceRouter());
  app.use("/gpt", createGptActionRouter());

  return app;
}

if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  const app = createApp();
  app.listen(config.port, () => {
    logger.info("server started", { port: config.port, aiMode: config.aiMode });
    if (config.nodeEnv !== "test") startScheduler();
  });
}
