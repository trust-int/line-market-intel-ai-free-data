import express from "express";
import { z } from "zod";
import type { Queryable } from "../db/client.js";
import { db } from "../db/client.js";
import { runOcrDiagnostics } from "../line/ocr-diagnostics.js";
import { upsertDataSourceStatus } from "../repositories/data-source-status.repo.js";
import { getTaipeiDateString } from "../utils/date.js";

export const DEFAULT_ALLOWED_NEWS_INGEST_SOURCES = [
  "manual_test",
  "manual_admin",
  "line_manual",
  "line_manual_pack",
  "line_image_manual",
  "line_image_ocr",
  "line_file_text",
  "line_file_manual",
  "jin10",
  "wallstreetcn",
  "futu-news",
  "twse_public",
  "tpex_public",
  "mops_public",
  "rss_public"
];

const newsItemSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().nullable().optional(),
  full_text: z.string().nullable().optional(),
  source_url: z.string().nullable().optional(),
  related_tickers: z.array(z.string()).default([]),
  related_sectors: z.array(z.string()).default([]),
  event_type: z.string().default("other"),
  importance: z.enum(["high", "medium", "low"]).default("medium"),
  is_mops: z.boolean().default(false),
  data_quality_score: z.number().min(0).max(100).default(45),
  data_gaps: z.array(z.string()).default([]),
  interpretation_limit: z.string().nullable().optional(),
  collected_at: z.string().datetime().optional(),
  raw_payload: z.record(z.unknown()).default({}),
  market_date: z.string().date().optional(),
  parser_version: z.string().nullable().optional()
});

const ingestNewsSchema = z.object({
  items: z.array(newsItemSchema).max(100)
});

export const INTERNAL_DIAGNOSTICS_ROUTES = [
  "GET /internal/diagnostics/ping",
  "GET /internal/diagnostics/ocr"
];

export function createInternalIngestRouter(database: Queryable = db) {
  const router = express.Router();

  router.get("/diagnostics/ping", (req, res) => {
    if (!isAdminAuthorized(req.header("authorization") ?? "")) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }

    res.json({
      status: "ok",
      service: "line-market-intel-ai-free-data",
      internal_routes_enabled: true,
      timestamp: new Date().toISOString()
    });
  });

  router.get("/diagnostics/ocr", async (req, res) => {
    if (!isAdminAuthorized(req.header("authorization") ?? "")) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }

    res.json(await runOcrDiagnostics());
  });

  router.post("/ingest/news", async (req, res) => {
    if (!isAdminAuthorized(req.header("authorization") ?? "")) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }

    const parsed = ingestNewsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ status: "error", error: "invalid_request", details: parsed.error.flatten() });
      return;
    }

    const allowedSources = getAllowedNewsIngestSources();
    const rejectedSources = unique(parsed.data.items.map((item) => item.source).filter((source) => !allowedSources.has(source)));
    if (rejectedSources.length) {
      await upsertDataSourceStatus({
        sourceName: "news_items",
        status: "error",
        reason: `source_not_allowed:${rejectedSources.join(",")}`,
        lastUpdated: new Date(),
        payloadSizeBytes: JSON.stringify(parsed.data).length
      }, database).catch(() => undefined);

      res.status(403).json({
        status: "error",
        error: "source_not_allowed",
        rejected_sources: rejectedSources,
        allowed_sources: [...allowedSources].sort()
      });
      return;
    }

    try {
      let insertedOrUpdated = 0;
      for (const item of parsed.data.items) {
        const result = await database.query(
          `insert into news_items (
             id, source, title, summary, full_text, source_url,
             related_tickers, related_sectors, event_type, importance,
             is_mops, data_quality_score, data_gaps,
             interpretation_limit, collected_at, archived, archived_at, archived_reason,
             raw_payload, market_date, parser_version, status
           ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,coalesce($15::timestamptz, now()),false,null,null,coalesce($16::jsonb, '{}'::jsonb),$17::date,$18,'active')
           on conflict (id) do update set
             source = excluded.source,
             title = excluded.title,
             summary = excluded.summary,
             full_text = excluded.full_text,
             source_url = excluded.source_url,
             related_tickers = excluded.related_tickers,
             related_sectors = excluded.related_sectors,
             event_type = excluded.event_type,
             importance = excluded.importance,
             is_mops = excluded.is_mops,
             data_quality_score = excluded.data_quality_score,
             data_gaps = excluded.data_gaps,
             interpretation_limit = excluded.interpretation_limit,
             collected_at = excluded.collected_at,
             archived = false,
             status = 'active',
             archived_at = null,
             archived_reason = null,
             raw_payload = excluded.raw_payload,
             market_date = excluded.market_date,
             parser_version = excluded.parser_version`,
          [
            item.id,
            item.source,
            item.title,
            item.summary ?? null,
            item.full_text ?? null,
            item.source_url ?? null,
            JSON.stringify(item.related_tickers),
            JSON.stringify(item.related_sectors),
            item.event_type,
            item.importance,
            item.is_mops,
            item.data_quality_score,
            JSON.stringify(item.data_gaps),
            item.interpretation_limit ?? null,
            item.collected_at ?? null,
            JSON.stringify(item.raw_payload ?? {}),
            item.market_date ?? getTaipeiDateString(item.collected_at ? new Date(item.collected_at) : new Date()),
            item.parser_version ?? "internal_ingest_v1"
          ]
        );
        insertedOrUpdated += result.rowCount ?? 0;
      }

      await upsertDataSourceStatus({
        sourceName: "news_items",
        status: insertedOrUpdated > 0 ? "ok" : "empty",
        reason: insertedOrUpdated > 0 ? null : "news_ingest_empty",
        lastUpdated: new Date(),
        payloadSizeBytes: JSON.stringify(parsed.data).length
      }, database).catch(() => undefined);

      res.json({ status: "ok", inserted_or_updated: insertedOrUpdated });
    } catch (error) {
      res.status(500).json({ status: "error", error: "news_ingest_failed" });
    }
  });

  return router;
}

function isAdminAuthorized(header: string): boolean {
  const expected = process.env.ADMIN_TOKEN;
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  return Boolean(expected && token && token === expected);
}

function getAllowedNewsIngestSources(): Set<string> {
  const configured = parseCsv(process.env.NEWS_INGEST_ALLOWED_SOURCES);
  return new Set(configured.length ? configured : DEFAULT_ALLOWED_NEWS_INGEST_SOURCES);
}

function parseCsv(value?: string): string[] {
  return (value ?? "").split(/[,\s]+/).map((item) => item.trim()).filter(Boolean);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
