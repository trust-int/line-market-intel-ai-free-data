import express from "express";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { TickerCandidate } from "../analysis/ticker-candidate-engine.js";
import { db } from "../db/client.js";
import { todayTaipei } from "../utils/date.js";
import { requireGptActionAuth } from "./auth.js";

type AnyRecord = Record<string, unknown>;

type FetchedReport = {
  report_date?: string;
  report_type?: string;
  report_json: unknown;
  summary_md: string | null;
  source?: string;
  data_gap?: string;
};

type MarketCalendar = {
  today: string;
  market_status: "open" | "closed";
  is_trading_day: boolean;
  latest_trading_date: string;
  next_trading_date: string;
  available_reports: {
    latest_postmarket: string | null;
    latest_weekly: string | null;
  };
};

export function createGptActionRouter() {
  const router = express.Router();
  router.use(requireGptActionAuth);

  router.get("/market-calendar/today", async (_req, res) => {
    res.json(await buildMarketCalendar(todayTaipei()));
  });

  router.get("/reports/latest", async (req, res) => {
    const reportType = String(req.query.type ?? "postmarket");
    const latest = await fetchLatestReport(reportType);
    const calendar = await buildMarketCalendar(todayTaipei());
    res.json(latest ? summarizeReport(latest.date, latest.report, calendar) : { report_type: reportType, data_gap: "report_not_found" });
  });

  router.get("/reports/today/summary", async (_req, res) => {
    const calendar = await buildMarketCalendar(todayTaipei());
    const report = await fetchTodayOrLatestReport("postmarket", calendar);
    res.json(summarizeReport(report.date, report.report, calendar));
  });

  router.get("/reports/today/signal", async (_req, res) => {
    const calendar = await buildMarketCalendar(todayTaipei());
    const report = await fetchTodayOrLatestReport("postmarket", calendar);
    res.json(buildSignalResponse(report.date, report.report));
  });

  router.get("/reports/today/market-snapshot", async (_req, res) => {
    const calendar = await buildMarketCalendar(todayTaipei());
    const report = await fetchTodayOrLatestReport("postmarket", calendar);
    res.json(buildMarketSnapshotResponse(report.date, report.report, calendar));
  });

  router.get("/reports/today/sections", async (req, res) => {
    const calendar = await buildMarketCalendar(todayTaipei());
    const report = await fetchTodayOrLatestReport("postmarket", calendar);
    res.json(buildSectionResponse(String(req.query.section ?? "summary"), report.date, report.report));
  });

  router.get("/reports/today", async (_req, res) => {
    res.json(await fetchReport(todayTaipei(), "postmarket"));
  });

  router.get("/reports/:date", async (req, res) => {
    res.json(await fetchReport(req.params.date, String(req.query.type ?? "postmarket")));
  });

  router.get("/signals/today", async (_req, res) => {
    const calendar = await buildMarketCalendar(todayTaipei());
    const report = await fetchTodayOrLatestReport("postmarket", calendar);
    res.json(buildSignalResponse(report.date, report.report));
  });

  router.get("/signals/latest", async (_req, res) => {
    const latest = await fetchLatestReport("postmarket");
    res.json(latest ? buildSignalResponse(latest.date, latest.report) : { data_gap: "report_not_found" });
  });

  router.get("/sectors/today", async (_req, res) => {
    const calendar = await buildMarketCalendar(todayTaipei());
    const report = await fetchTodayOrLatestReport("postmarket", calendar);
    res.json(buildSectorsResponse(report.date, report.report));
  });

  router.get("/candidates/today", async (req, res) => {
    const calendar = await buildMarketCalendar(todayTaipei());
    const report = await fetchTodayOrLatestReport("postmarket", calendar);
    const requestedType = typeof req.query.type === "string" && req.query.type ? [req.query.type] : undefined;
    res.json(buildCandidatesResponse(report.date, report.report, requestedType));
  });

  router.get("/candidates/intraday", async (_req, res) => {
    const calendar = await buildMarketCalendar(todayTaipei());
    const report = await fetchTodayOrLatestReport("postmarket", calendar);
    res.json(buildCandidatesResponse(report.date, report.report, ["daytrade_long", "daytrade_short"]));
  });

  router.get("/candidates/swing", async (_req, res) => {
    const calendar = await buildMarketCalendar(todayTaipei());
    const report = await fetchTodayOrLatestReport("postmarket", calendar);
    res.json(buildCandidatesResponse(report.date, report.report, ["swing"]));
  });

  router.get("/tickers/:ticker/today", async (req, res) => {
    const ticker = req.params.ticker;
    const calendar = await buildMarketCalendar(todayTaipei());
    const report = await fetchTodayOrLatestReport("postmarket", calendar);
    const reportCandidate = extractTickerCandidates(report.report).find((candidate) => candidate.ticker === ticker);
    if (reportCandidate) {
      res.json(buildTickerTodayResponse(report.date, reportCandidate));
      return;
    }
    try {
      const rows = await db.query<AnyRecord>("select * from trade_candidates where report_date = $1 and ticker = $2", [report.date, ticker]);
      const row = rows.rows[0];
      res.json(row ? buildTickerTodayResponse(report.date, normalizeTradeCandidateRow(row)) : buildEmptyTickerTodayResponse(report.date, ticker));
    } catch {
      res.json({ ...buildEmptyTickerTodayResponse(report.date, ticker), data_gaps: ["db_unavailable"] });
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

  router.get("/holdings", async (_req, res) => {
    try {
      const rows = await db.query("select ticker, name, qty, avg_cost, strategy, thesis, stop_loss, take_profit from holdings where active = true order by ticker");
      res.json({ rows: rows.rows });
    } catch {
      res.json({ rows: [], data_gap: "db_unavailable" });
    }
  });

  router.get("/news/today/summary", async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit ?? 20), 1), 50);
    try {
      const [newsRows, lineRows] = await Promise.all([
        db.query(
        `select source, source_url, title, summary,
                related_tickers as tickers,
                related_sectors as topics,
                case importance when 'high' then 90 when 'medium' then 60 when 'low' then 30 else 60 end as event_importance,
                interpretation_limit as license_status,
                collected_at as published_at,
                collected_at as fetched_at
         from news_items
         where collected_at >= now() - interval '36 hours'
         order by case importance when 'high' then 1 when 'medium' then 2 when 'low' then 3 else 4 end,
                  collected_at desc
         limit $1`,
        [limit]
        ),
        db.query(
          `select 'line_manual' as source,
                  null::text as source_url,
                  coalesce(extracted_text, ai_summary, raw_text) as title,
                  coalesce(extracted_text, ai_summary, raw_text) as summary,
                  tickers,
                  topics,
                  null::numeric as event_importance,
                  'user_provided_or_forwarded' as license_status,
                  received_at as published_at,
                  received_at as fetched_at
             from line_messages
            where (received_at at time zone 'Asia/Taipei')::date = $2
              and status = 'active'
              and message_type = 'text'
              and coalesce(raw_text, extracted_text, ai_summary, '') not like '/%'
            order by received_at desc
            limit $1`,
          [limit, todayTaipei()]
        )
      ]);
      const items = [...newsRows.rows, ...lineRows.rows].slice(0, limit).map((row) => summarizeNewsRow(row as AnyRecord));
      res.json({
        status: items.length ? "ok" : "empty",
        date: todayTaipei(),
        limit,
        items,
        line_manual_news: items,
        data_available: items.length > 0,
        empty_reason: items.length ? undefined : "no_news_items_or_line_manual_news",
        data_gaps: items.length ? [] : ["news_empty"]
      });
    } catch {
      res.json({ status: "empty", date: todayTaipei(), limit, items: [], data_available: false, empty_reason: "db_unavailable", data_gaps: ["db_unavailable"] });
    }
  });

  router.get("/news/today", async (_req, res) => {
    try {
      const [newsRows, lineRows] = await Promise.all([
        db.query("select * from news_events where fetched_at::date = $1 order by fetched_at desc", [todayTaipei()]),
        db.query(
          `select 'line_manual' as source,
                  null::text as source_url,
                  coalesce(extracted_text, ai_summary, raw_text) as title,
                  coalesce(extracted_text, ai_summary, raw_text) as summary,
                  tickers,
                  topics,
                  received_at as fetched_at,
                  'user_provided_or_forwarded' as license_status
             from line_messages
            where (received_at at time zone 'Asia/Taipei')::date = $1
              and status = 'active'
              and message_type = 'text'
              and coalesce(raw_text, extracted_text, ai_summary, '') not like '/%'
            order by received_at desc`,
          [todayTaipei()]
        )
      ]);
      res.json({ date: todayTaipei(), rows: [...newsRows.rows, ...lineRows.rows], line_manual_rows: lineRows.rows.length });
    } catch {
      res.json({ date: todayTaipei(), rows: [], data_gap: "db_unavailable" });
    }
  });

  router.get("/manual-pack/:date/summary", async (req, res) => {
    const report = await fetchReport(req.params.date, "postmarket");
    const pack = await fetchManualPack(req.params.date);
    res.json(buildManualPackSummary(req.params.date, report, pack));
  });

  router.get("/manual-pack/:date", async (req, res) => {
    res.json(await fetchManualPack(req.params.date));
  });

  router.get("/sources/status", async (_req, res) => {
    const calendar = await buildMarketCalendar(todayTaipei());
    const report = await fetchTodayOrLatestReport("postmarket", calendar);
    const sourceStatus = extractSourceStatus(report.report);
    res.json({
      date: report.date,
      market_status: calendar.market_status,
      sources: Object.entries(sourceStatus).map(([name, status]) => ({
        name,
        status,
        last_updated: report.date,
        reason: status === "ok" ? undefined : status
      })),
      data_gaps: extractDataGaps(report.report)
    });
  });

  router.post("/query", async (req, res) => {
    res.json({
      answer: "Query accepted by skeleton API. Use summary endpoints for grounded market data.",
      query: req.body?.query ?? null,
      policy: {
        paid_data_api_used: false,
        exposes_line_user_id: false,
        returns_paid_fulltext: false
      },
      recommended_endpoints: [
        "/gpt/reports/today/summary",
        "/gpt/market-calendar/today",
        "/gpt/signals/today",
        "/gpt/sectors/today",
        "/gpt/candidates/today",
        "/gpt/news/today/summary"
      ]
    });
  });

  return router;
}

async function fetchReport(date: string, reportType: string): Promise<FetchedReport> {
  let dbUnavailable = false;
  try {
    const rows = await db.query<{ report_date: string; report_type: string; report_json: unknown; summary_md: string }>(
      "select report_date::text, report_type, report_json, summary_md from strategy_reports where report_date = $1 and report_type = $2 limit 1",
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

async function fetchManualPack(date: string) {
  let dbUnavailable = false;
  try {
    const rows = await db.query("select pack_date, pack_type, markdown, json_payload from manual_gpt_packs where pack_date = $1 order by pack_type", [date]);
    if (rows.rows.length) return { date, rows: rows.rows };
  } catch {
    dbUnavailable = true;
  }
  const markdown = await readTextSafe(path.resolve(process.cwd(), "outputs", "manual-packs", `${date}.md`));
  return {
    date,
    rows: markdown ? [{ pack_date: date, pack_type: "postmarket", markdown, json_payload: { source: "file_fallback" } }] : [],
    source: markdown ? "file_fallback" : "db_or_file_empty",
    data_gap: dbUnavailable ? "db_unavailable" : undefined
  };
}

async function fetchLatestReport(reportType: string): Promise<{ date: string; report: FetchedReport } | undefined> {
  try {
    const rows = await db.query<{ report_date: string; report_type: string; report_json: unknown; summary_md: string }>(
      "select report_date::text, report_type, report_json, summary_md from strategy_reports where report_type = $1 order by report_date desc limit 1",
      [reportType]
    );
    const row = rows.rows[0];
    if (row) return { date: normalizeDateOnly(row.report_date), report: row };
  } catch {
    // File fallback below.
  }
  try {
    const latest = (await readdir(path.resolve(process.cwd(), "outputs", "reports")))
      .filter((file) => /^\d{4}-\d{2}-\d{2}\.json$/.test(file))
      .map((file) => file.slice(0, 10))
      .sort()
      .at(-1);
    if (!latest) return undefined;
    return { date: latest, report: await fetchReport(latest, reportType) };
  } catch {
    return undefined;
  }
}

async function fetchTodayOrLatestReport(reportType: string, calendar: MarketCalendar): Promise<{ date: string; report: FetchedReport }> {
  const todayReport = await fetchReport(calendar.today, reportType);
  if (todayReport.report_json || todayReport.summary_md) return { date: calendar.today, report: todayReport };
  const tradingDayReport = await fetchReport(calendar.latest_trading_date, reportType);
  if (tradingDayReport.report_json || tradingDayReport.summary_md) return { date: calendar.latest_trading_date, report: tradingDayReport };
  return { date: calendar.latest_trading_date, report: tradingDayReport };
}

async function buildMarketCalendar(today: string): Promise<MarketCalendar> {
  const isTradingDay = !isWeekend(today);
  const latestTradingDate = isTradingDay ? today : previousBusinessDay(today);
  const nextTradingDate = isTradingDay ? nextBusinessDay(today) : nextBusinessDay(latestTradingDate);
  const [latestPostmarket, latestWeekly] = await Promise.all([fetchLatestReport("postmarket"), fetchLatestReport("weekly")]);
  return {
    today,
    market_status: isTradingDay ? "open" : "closed",
    is_trading_day: isTradingDay,
    latest_trading_date: latestTradingDate,
    next_trading_date: nextTradingDate,
    available_reports: {
      latest_postmarket: latestPostmarket?.date ?? null,
      latest_weekly: latestWeekly?.date ?? null
    }
  };
}

function summarizeReport(date: string, report: FetchedReport, calendar: MarketCalendar) {
  if (!reportHasData(report)) {
    return {
      status: "empty",
      date,
      market_status: calendar.market_status,
      latest_trading_date: calendar.latest_trading_date,
      data_quality_score: 0,
      data_gaps: compactStrings(["missing_market_report", report.data_gap]),
      sample_size: 0,
      backtest_available: false,
      confidence_score: 0,
      signal_engine: null,
      top_sectors: [],
      top_candidates: [],
      summary: null
    };
  }
  const signal = extractSignal(report);
  const dataQuality = extractDataQuality(report);
  return {
    status: "ok",
    date,
    market_status: calendar.market_status,
    latest_trading_date: calendar.latest_trading_date,
    ai_mode: "manual",
    data_quality_score: dataQuality.score,
    data_quality_level: dataQuality.level,
    data_gaps: extractDataGaps(report),
    sample_size: 0,
    backtest_available: false,
    confidence_score: Math.round(dataQuality.score),
    signal_engine: {
      market_bias: signal.market_bias,
      market_phase: signal.market_phase,
      big_money_strategy: signal.big_money_strategy,
      risk_flags: signal.risk_flags
    },
    top_sectors: extractSectorStrength(report).slice(0, 5).map(summarizeSector),
    top_candidates: extractTickerCandidates(report).slice(0, 8).map(sanitizeCandidate),
    summary: extractShortSummary(report),
    safety_rules: {
      backtest_required_for_performance_stats: true,
      auto_trading: false,
      paid_data_api_used: false,
      futu: "disabled"
    }
  };
}

function buildSignalResponse(date: string, report: FetchedReport) {
  if (!reportHasData(report)) {
    return {
      status: "empty",
      date,
      data_quality_score: 0,
      data_gaps: compactStrings(["missing_signal_engine", report.data_gap]),
      market_bias: "無資料",
      market_phase: "無資料",
      big_money_strategy: ["wait"],
      risk_flags: ["missing_signal_engine"],
      confidence_score: 0,
      sample_size: 0,
      backtest_available: false
    };
  }
  const signal = extractSignal(report);
  const dataQuality = extractDataQuality(report);
  return {
    status: "ok",
    date,
    data_quality_score: dataQuality.score,
    data_gaps: extractDataGaps(report),
    market_bias: signal.market_bias,
    market_phase: signal.market_phase,
    big_money_strategy: signal.big_money_strategy,
    risk_flags: signal.risk_flags,
    confidence_score: Math.round(dataQuality.score),
    sample_size: 0,
    backtest_available: false
  };
}

function buildMarketSnapshotResponse(date: string, report: FetchedReport, calendar: MarketCalendar) {
  const snapshot = extractSnapshot(report);
  return {
    date,
    today: calendar.today,
    market_status: calendar.market_status,
    latest_trading_date: calendar.latest_trading_date,
    taiex: {
      close: getNumber(snapshot, "taiex_close"),
      change_pct: getNumber(snapshot, "taiex_change_pct"),
      volume: getNumber(snapshot, "taiex_volume")
    },
    otc: {
      close: getNumber(snapshot, "otc_close"),
      change_pct: getNumber(snapshot, "otc_change_pct")
    },
    market_breadth: {
      advancers: getNumber(snapshot, "advance_count"),
      decliners: getNumber(snapshot, "decline_count")
    },
    institutional_flow: {
      foreign_investor: getNumber(snapshot, "foreign_net_buy"),
      investment_trust: getNumber(snapshot, "investment_trust_net_buy"),
      dealer: getNumber(snapshot, "dealer_net_buy")
    },
    margin_trading: {
      margin_buy_change: getNumber(snapshot, "margin_balance_change"),
      short_sell_change: getNumber(snapshot, "short_balance_change")
    },
    data_quality_score: extractDataQuality(report).score,
    data_gaps: extractDataGaps(report),
    source_status: extractSourceStatus(report)
  };
}

function buildSectionResponse(section: string, date: string, report: FetchedReport) {
  if (section === "sectors") return buildSectorsResponse(date, report);
  if (section === "candidates") return buildCandidatesResponse(date, report);
  if (section === "risk") return { date, risk_flags: extractSignal(report).risk_flags, data_gaps: extractDataGaps(report) };
  return { date, section, data_gap: "unknown_section", available_sections: ["sectors", "candidates", "risk"] };
}

function buildSectorsResponse(date: string, report: FetchedReport) {
  const sectors = extractSectorStrength(report).map(summarizeSector);
  const dataGaps = extractDataGaps(report);
  const reportAvailable = reportHasData(report);
  const dataAvailable = reportAvailable && !dataGaps.some((gap) => gap.includes("sector"));
  return {
    status: sectors.length ? "ok" : "empty",
    date,
    sector_strength: sectors,
    sectors,
    data_available: dataAvailable,
    empty_reason: sectors.length ? undefined : dataAvailable ? "no_sector_matched_filter" : "sector_strength_pipeline_not_run_or_no_data",
    data_gaps: compactStrings([
      ...dataGaps.filter((gap) => gap.includes("sector")),
      sectors.length ? undefined : "sector_strength_empty",
      reportAvailable ? undefined : report.data_gap
    ])
  };
}

function buildCandidatesResponse(date: string, report: FetchedReport, candidateTypes?: string[]) {
  const candidates = extractTickerCandidates(report)
    .filter((candidate) => !candidateTypes || candidateTypes.includes(candidate.candidate_type))
    .map(sanitizeCandidate);
  const dataGaps = extractDataGaps(report);
  const reportAvailable = reportHasData(report);
  const dataAvailable = reportAvailable && !dataGaps.some((gap) => gap.includes("ticker_market_daily_missing"));
  return {
    status: candidates.length ? "ok" : "empty",
    date,
    ticker_candidates: candidates,
    data_available: dataAvailable,
    empty_reason: candidates.length
      ? undefined
      : candidateTypes?.length
        ? "candidate_pipeline_not_run_or_no_data"
        : dataAvailable
          ? "no_candidate_matched_filter"
          : "candidate_pipeline_not_run_or_no_data",
    data_gaps: compactStrings([
      ...dataGaps.filter((gap) => gap.includes("ticker") || gap.includes("intraday")),
      candidates.length ? undefined : "ticker_candidates_empty",
      reportAvailable ? undefined : report.data_gap
    ])
  };
}

function buildTickerTodayResponse(date: string, candidate: TickerCandidate) {
  const sanitized = sanitizeCandidate(candidate);
  return {
    ticker: sanitized.ticker,
    name: sanitized.name,
    date,
    data_quality_score: candidate.confidence_score,
    data_gaps: candidate.data_gaps,
    sample_size: 0,
    backtest_available: false,
    confidence_score: candidate.confidence_score,
    technical: {
      trend: candidate.stage,
      support: null,
      resistance: null,
      volume_status: candidate.data_gaps.includes("ticker_ohlcv_missing") ? "unknown" : "available",
      volatility: "unknown"
    },
    chip: {
      foreign_investor_net_buy: null,
      investment_trust_net_buy: null,
      dealer_net_buy: null,
      broker_branch_flow: null,
      chip_concentration: null,
      margin_buy_change: null,
      short_sell_change: null
    },
    intraday_strategy: {
      direction: candidate.candidate_type === "daytrade_long" ? "long" : candidate.candidate_type === "daytrade_short" ? "short" : "observe_only",
      entry_zone: candidate.entry_zone ?? null,
      exit_zone: candidate.take_profit ?? null,
      stop_loss: candidate.stop_loss ?? null,
      position_pct: candidate.candidate_type.startsWith("daytrade") || candidate.candidate_type === "swing" ? null : 0,
      failure_scenario: candidate.risks.join("；") || "需要更多資料確認"
    },
    big_money_strategy: {
      estimated_action: "no_clear_strategy",
      signal_strength: candidate.confidence_score >= 65 ? "medium" : "weak",
      invalid_condition: candidate.data_gaps.join(", ")
    },
    risk_flags: candidate.risks,
    candidate: sanitized
  };
}

function buildEmptyTickerTodayResponse(date: string, ticker: string) {
  return {
    ticker,
    date,
    data_quality_score: 0,
    data_gaps: ["ticker_candidate_missing"],
    sample_size: 0,
    backtest_available: false,
    confidence_score: 0,
    intraday_strategy: {
      direction: "observe_only",
      entry_zone: null,
      exit_zone: null,
      stop_loss: null,
      position_pct: 0,
      failure_scenario: "缺少候選股、量價與籌碼確認"
    },
    risk_flags: ["data_insufficient"]
  };
}

function buildManualPackSummary(date: string, report: FetchedReport, pack: Awaited<ReturnType<typeof fetchManualPack>>) {
  const packPayloads = Array.isArray(pack.rows) ? pack.rows.map((row) => asRecord((row as AnyRecord).json_payload)) : [];
  const lineManualNewsEvents = packPayloads.flatMap((payload) => asArray(payload.lineManualNewsEvents).filter(isRecord)).slice(0, 20);
  const uploadedAttachmentsMetadata = packPayloads.flatMap((payload) => asArray(payload.uploadedAttachmentsMetadata).filter(isRecord)).slice(0, 20);
  const lineMessages = packPayloads.flatMap((payload) => asArray(payload.lineMessages).filter(isRecord)).slice(0, 20);
  const dataGaps = Array.from(new Set(packPayloads.flatMap((payload) => asStringArray(payload.dataGaps))));
  return {
    date,
    report_summary: summarizeReport(date, report, {
      today: date,
      market_status: isWeekend(date) ? "closed" : "open",
      is_trading_day: !isWeekend(date),
      latest_trading_date: isWeekend(date) ? previousBusinessDay(date) : date,
      next_trading_date: nextBusinessDay(date),
      available_reports: { latest_postmarket: date, latest_weekly: null }
    }),
    pack_available: Array.isArray(pack.rows) && pack.rows.length > 0,
    pack_types: Array.isArray(pack.rows) ? pack.rows.map((row) => String((row as AnyRecord).pack_type ?? "unknown")) : [],
    line_manual_news_events: lineManualNewsEvents.map(summarizeNewsRow),
    uploaded_attachments_metadata: uploadedAttachmentsMetadata.map(stripSensitiveManualPackRow),
    line_messages: lineMessages.map(stripSensitiveManualPackRow),
    data_gaps: dataGaps,
    note: "Summary endpoint intentionally omits full markdown/raw data to keep GPT Action payload small."
  };
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

function isRecord(value: unknown): value is AnyRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): AnyRecord {
  return isRecord(value) ? value : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asStringArray(value: unknown): string[] {
  return asArray(value).filter((item): item is string => typeof item === "string");
}

function compactStrings(values: Array<string | undefined | null>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function reportHasData(report: FetchedReport): boolean {
  return Boolean(report.report_json || report.summary_md);
}

function getRecord(record: AnyRecord, key: string): AnyRecord {
  return asRecord(record[key]);
}

function getNumber(record: AnyRecord, key: string): number | null {
  const value = record[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function getString(record: AnyRecord, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function normalizeDateOnly(value: string): string {
  return value.slice(0, 10);
}

function addDays(date: string, days: number): string {
  const base = new Date(`${date}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

function isWeekend(date: string): boolean {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

function previousBusinessDay(date: string): string {
  let current = addDays(date, -1);
  while (isWeekend(current)) current = addDays(current, -1);
  return current;
}

function nextBusinessDay(date: string): string {
  let current = addDays(date, 1);
  while (isWeekend(current)) current = addDays(current, 1);
  return current;
}

function extractReportJson(report: FetchedReport): AnyRecord {
  return asRecord(report.report_json);
}

function extractSignal(report: FetchedReport) {
  const reportJson = extractReportJson(report);
  const signal = getRecord(reportJson, "signalEngineResult");
  const strategyReport = getRecord(reportJson, "strategyReport");
  const market = getRecord(strategyReport, "market");
  const snapshot = extractSnapshot(report);
  const rawBigMoney = signal.big_money_strategy;
  const bigMoneyStrategy = Array.isArray(rawBigMoney)
    ? rawBigMoney.filter((item): item is string => typeof item === "string")
    : typeof rawBigMoney === "string" ? [rawBigMoney] : [];
  return {
    market_bias: getString(signal, "market_bias") ?? getString(snapshot, "market_bias") ?? normalizeMarketBias(getString(market, "bias")),
    market_phase: getString(signal, "market_phase") ?? "pullback",
    big_money_strategy: bigMoneyStrategy.length ? bigMoneyStrategy : ["wait"],
    risk_flags: asStringArray(signal.risk_flags),
    data_quality_score: getNumber(signal, "data_quality_score") ?? extractDataQuality(report).score
  };
}

function normalizeMarketBias(value?: string): "bullish" | "neutral" | "bearish" {
  if (value === "偏多" || value === "多方" || value === "bullish") return "bullish";
  if (value === "偏空" || value === "空方" || value === "bearish") return "bearish";
  return "neutral";
}

function extractSnapshot(report: FetchedReport): AnyRecord {
  const reportJson = extractReportJson(report);
  const snapshot = getRecord(reportJson, "snapshot");
  if (Object.keys(snapshot).length) return snapshot;
  return getRecord(getRecord(reportJson, "strategyReport"), "snapshot");
}

function extractDataQuality(report: FetchedReport): { score: number; level: string; reasons: string[] } {
  const reportJson = extractReportJson(report);
  const dataQuality = getRecord(reportJson, "dataQuality");
  const score = getNumber(dataQuality, "score") ?? getNumber(extractSnapshot(report), "data_quality_score") ?? 0;
  return {
    score,
    level: getString(dataQuality, "level") ?? (score >= 85 ? "high" : score >= 60 ? "medium" : score > 0 ? "low" : "insufficient"),
    reasons: asStringArray(dataQuality.reasons)
  };
}

function extractDataGaps(report: FetchedReport): string[] {
  const reportJson = extractReportJson(report);
  const gaps = [
    ...asStringArray(reportJson.dataGaps),
    ...asStringArray(getRecord(reportJson, "dataQuality").data_gaps),
    ...asStringArray(extractSnapshot(report).data_gaps),
    ...asStringArray(getRecord(reportJson, "strategyReport").data_gaps)
  ];
  if (report.data_gap) gaps.push(report.data_gap);
  return Array.from(new Set(gaps));
}

function extractSourceStatus(report: FetchedReport): Record<string, string> {
  const reportJson = extractReportJson(report);
  const sources = [
    getRecord(extractSnapshot(report), "source_status"),
    getRecord(getRecord(reportJson, "dataQuality"), "source_status"),
    getRecord(reportJson, "sourceStatus")
  ];
  const merged: Record<string, string> = {};
  for (const source of sources) {
    for (const [key, value] of Object.entries(source)) {
      if (typeof value === "string") merged[key] = value;
    }
  }
  return merged;
}

function extractSectorStrength(report: FetchedReport): AnyRecord[] {
  const reportJson = extractReportJson(report);
  const fromSignal = asArray(getRecord(reportJson, "signalEngineResult").sector_strength).filter(isRecord);
  if (fromSignal.length) return fromSignal;
  return asArray(getRecord(reportJson, "strategyReport").sectors).filter(isRecord);
}

function extractTickerCandidates(report: FetchedReport): TickerCandidate[] {
  const reportJson = extractReportJson(report);
  const fromSignal = asArray(getRecord(reportJson, "signalEngineResult").ticker_candidates).filter(isTickerCandidate);
  if (fromSignal.length) return fromSignal;
  const strategyReport = getRecord(reportJson, "strategyReport");
  return [
    ...asArray(strategyReport.holdings),
    ...asArray(strategyReport.daytrade_candidates),
    ...asArray(strategyReport.swing_candidates)
  ].filter(isTickerCandidate);
}

function isTickerCandidate(value: unknown): value is TickerCandidate {
  return isRecord(value) && typeof value.ticker === "string" && typeof value.candidate_type === "string";
}

function summarizeSector(sector: AnyRecord) {
  return {
    sector: getString(sector, "sector") ?? getString(sector, "theme") ?? "unknown",
    strength_score: getNumber(sector, "strength_score") ?? getNumber(sector, "score") ?? 0,
    rank: getNumber(sector, "rank") ?? undefined,
    phase: getString(sector, "phase") ?? "資料不足",
    leaders: asStringArray(sector.leaders).slice(0, 5).map((ticker) => ({ ticker })),
    second_line: asStringArray(sector.second_line).slice(0, 5).map((ticker) => ({ ticker })),
    evidence: asStringArray(sector.evidence).slice(0, 6),
    risk_flags: asStringArray(sector.risks).slice(0, 6),
    data_quality_score: getNumber(sector, "data_quality_score"),
    data_gaps: asStringArray(sector.data_gaps)
  };
}

function sanitizeCandidate(candidate: TickerCandidate) {
  return {
    ticker: candidate.ticker,
    name: candidate.name,
    candidate_type: candidate.candidate_type,
    side: candidate.side,
    stage: candidate.stage,
    score: candidate.score,
    confidence_score: candidate.confidence_score,
    entry_zone: candidate.entry_zone,
    stop_loss: candidate.stop_loss,
    take_profit: candidate.take_profit,
    triggers: candidate.triggers,
    risks: candidate.risks,
    rationale: candidate.rationale,
    data_gaps: candidate.data_gaps,
    sample_size: 0,
    backtest_available: false
  };
}

function normalizeTradeCandidateRow(row: AnyRecord): TickerCandidate {
  const rationale = row.rationale;
  return {
    ticker: String(row.ticker ?? ""),
    name: getString(row, "name"),
    candidate_type: normalizeCandidateType(getString(row, "candidate_type")),
    side: normalizeSide(getString(row, "side")),
    stage: "未發動",
    score: getNumber(row, "score") ?? 0,
    confidence_score: getNumber(row, "confidence_score") ?? 0,
    entry_zone: isRecord(row.entry_zone) ? row.entry_zone as TickerCandidate["entry_zone"] : undefined,
    stop_loss: { rule: "依原始計畫停損；若缺資料則僅觀察" },
    take_profit: isRecord(row.exit_plan) ? row.exit_plan as TickerCandidate["take_profit"] : undefined,
    triggers: asStringArray(row.triggers),
    risks: asStringArray(row.risks),
    rationale: typeof rationale === "string" ? [rationale] : asStringArray(rationale),
    data_gaps: []
  };
}

function normalizeCandidateType(value?: string): TickerCandidate["candidate_type"] {
  const allowed: TickerCandidate["candidate_type"][] = ["daytrade_long", "daytrade_short", "swing", "hold", "reduce", "avoid", "watch"];
  return allowed.includes(value as TickerCandidate["candidate_type"]) ? value as TickerCandidate["candidate_type"] : "watch";
}

function normalizeSide(value?: string): TickerCandidate["side"] {
  return value === "long" || value === "short" || value === "neutral" ? value : "neutral";
}

function summarizeNewsRow(row: AnyRecord) {
  return {
    title: getString(row, "title") ?? "",
    summary: getString(row, "summary") ?? "",
    source: getString(row, "source") ?? "unknown",
    source_url: getString(row, "source_url") ?? "",
    related_tickers: asStringArray(row.tickers),
    related_sectors: asStringArray(row.topics),
    importance: classifyImportance(getNumber(row, "event_importance")),
    is_mops: getString(row, "source")?.toLowerCase().includes("mops") ?? false,
    interpretation_limit: getString(row, "summary") ? "title_or_summary_only" : "title_only",
    data_quality_score: getString(row, "summary") ? 70 : 45,
    data_gaps: getString(row, "summary") ? ["article_body_omitted"] : ["summary_missing", "article_body_omitted"],
    published_at: row.published_at,
    fetched_at: row.fetched_at,
    license_status: getString(row, "license_status")
  };
}

function stripSensitiveManualPackRow(row: AnyRecord) {
  const {
    user_hash: _userHash,
    group_id: _groupId,
    room_id: _roomId,
    file_path: _filePath,
    private_path: _privatePath,
    ...safe
  } = row;
  return safe;
}

function classifyImportance(value: number | null): "high" | "medium" | "low" {
  if (value !== null && value >= 80) return "high";
  if (value !== null && value <= 40) return "low";
  return "medium";
}

function extractShortSummary(report: FetchedReport): string {
  if (report.summary_md) {
    return report.summary_md
      .split("\n")
      .filter((line) => line.trim() && !line.trim().startsWith("```"))
      .slice(0, 12)
      .join("\n")
      .slice(0, 2000);
  }
  const market = getRecord(getRecord(extractReportJson(report), "strategyReport"), "market");
  const evidence = asStringArray(market.evidence).slice(0, 4).join("；");
  return evidence || "summary_unavailable";
}
