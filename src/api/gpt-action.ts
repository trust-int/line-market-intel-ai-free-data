import express from "express";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { todayTaipei } from "../utils/date.js";
import { db } from "../db/client.js";
import { requireGptActionAuth } from "./auth.js";

export function createGptActionRouter() {
  const router = express.Router();
  router.use(requireGptActionAuth);

  router.get("/reports/today", async (_req, res) => {
    res.json(await fetchReport(todayTaipei(), "postmarket"));
  });

  router.get("/reports/:date", async (req, res) => {
    res.json(await fetchReport(req.params.date, String(req.query.type ?? "postmarket")));
  });

  router.get("/tickers/:ticker/today", async (req, res) => {
    const ticker = req.params.ticker;
    const date = todayTaipei();
    try {
      const rows = await db.query("select * from trade_candidates where report_date = $1 and ticker = $2", [date, ticker]);
      res.json({ date, ticker, rows: rows.rows });
    } catch {
      res.json({ date, ticker, rows: [], data_gap: "db_unavailable" });
    }
  });

  router.get("/tickers/:ticker/history", async (req, res) => {
    const days = Math.min(Number(req.query.days ?? 20), 120);
    try {
      const rows = await db.query("select * from trade_candidates where ticker = $1 order by report_date desc limit $2", [req.params.ticker, days]);
      res.json({ ticker: req.params.ticker, days, rows: rows.rows });
    } catch {
      res.json({ ticker: req.params.ticker, days, rows: [], data_gap: "db_unavailable" });
    }
  });

  router.get("/sectors/today", async (_req, res) => {
    const report = await fetchReport(todayTaipei(), "postmarket");
    const reportJson = report.report_json as { sectors?: unknown[] } | null | undefined;
    res.json({ date: todayTaipei(), sectors: reportJson?.sectors ?? [] });
  });

  router.get("/holdings", async (_req, res) => {
    try {
      const rows = await db.query("select ticker, name, qty, avg_cost, strategy, thesis, stop_loss, take_profit from holdings where active = true order by ticker");
      res.json({ rows: rows.rows });
    } catch {
      res.json({ rows: [], data_gap: "db_unavailable" });
    }
  });

  router.get("/news/today", async (_req, res) => {
    try {
      const rows = await db.query("select * from news_events where fetched_at::date = $1 order by fetched_at desc", [todayTaipei()]);
      res.json({ date: todayTaipei(), rows: rows.rows });
    } catch {
      res.json({ date: todayTaipei(), rows: [], data_gap: "db_unavailable" });
    }
  });

  router.get("/manual-pack/:date", async (req, res) => {
    let dbUnavailable = false;
    try {
      const rows = await db.query("select pack_date, pack_type, markdown, json_payload from manual_gpt_packs where pack_date = $1 order by pack_type", [req.params.date]);
      if (rows.rows.length) {
        res.json({ date: req.params.date, rows: rows.rows });
        return;
      }
    } catch {
      dbUnavailable = true;
    }
    const markdown = await readTextSafe(path.resolve(process.cwd(), "outputs", "manual-packs", `${req.params.date}.md`));
    res.json({
      date: req.params.date,
      rows: markdown ? [{ pack_date: req.params.date, pack_type: "postmarket", markdown, json_payload: { source: "file_fallback" } }] : [],
      source: markdown ? "file_fallback" : "db_or_file_empty",
      data_gap: dbUnavailable ? "db_unavailable" : undefined
    });
  });

  router.post("/query", async (req, res) => {
    res.json({
      answer: "Query accepted by skeleton API. Connect repository-specific retrieval here.",
      query: req.body?.query ?? null,
      policy: {
        paid_data_api_used: false,
        exposes_line_user_id: false,
        returns_paid_fulltext: false
      }
    });
  });

  return router;
}

async function fetchReport(date: string, reportType: string) {
  let dbUnavailable = false;
  try {
    const rows = await db.query<{ report_json: unknown; summary_md: string }>(
      "select report_json, summary_md from strategy_reports where report_date = $1 and report_type = $2 limit 1",
      [date, reportType]
    );
    if (rows.rows[0]) return rows.rows[0];
  } catch {
    dbUnavailable = true;
  }
  const [reportJson, summaryMd] = await Promise.all([
    readJsonSafe(path.resolve(process.cwd(), "outputs", "reports", `${date}.json`)),
    readTextSafe(path.resolve(process.cwd(), "outputs", "reports", `${date}.md`))
  ]);
  if (reportJson || summaryMd) {
    return {
      report_json: reportJson ?? { source: "file_fallback" },
      summary_md: summaryMd ?? null,
      source: "file_fallback",
      data_gap: dbUnavailable ? "db_unavailable" : undefined
    };
  }
  return { report_json: null, summary_md: null, data_gap: dbUnavailable ? "db_unavailable" : "report_not_found" };
}

async function readTextSafe(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return undefined;
  }
}

async function readJsonSafe(filePath: string): Promise<unknown | undefined> {
  const text = await readTextSafe(filePath);
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
