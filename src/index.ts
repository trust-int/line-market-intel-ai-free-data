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
import { createInternalIngestRouter, INTERNAL_DIAGNOSTICS_ROUTES } from "./api/internal-ingest.js";
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
  app.use("/internal", createInternalIngestRouter());

  return app;
}

if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  const app = createApp();
  app.listen(config.port, () => {
    logger.info("server started", {
      port: config.port,
      ai_mode: config.aiMode,
      node_env: config.nodeEnv,
      commit_sha: getCommitSha(),
      registered_internal_diagnostics_routes: INTERNAL_DIAGNOSTICS_ROUTES,
      ocr_diagnostics_route_enabled: INTERNAL_DIAGNOSTICS_ROUTES.includes("GET /internal/diagnostics/ocr")
    });
    if (config.nodeEnv !== "test") startScheduler();
  });
}

function getCommitSha(): string | null {
  return (
    process.env.RENDER_GIT_COMMIT ||
    process.env.COMMIT_SHA ||
    process.env.SOURCE_VERSION ||
    process.env.GIT_COMMIT ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    null
  );
}
