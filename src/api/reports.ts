import express from "express";
import { generateDailyReport } from "../reports/daily.js";
import { generateIntradayReport } from "../reports/intraday.js";
import { generateWeeklyReport } from "../reports/weekly.js";

export function createReportsRouter() {
  const router = express.Router();
  router.get("/daily/preview", async (_req, res) => res.json(await generateDailyReport()));
  router.get("/intraday/preview", async (_req, res) => res.json(await generateIntradayReport()));
  router.get("/weekly/preview", async (_req, res) => res.json(await generateWeeklyReport()));
  return router;
}
