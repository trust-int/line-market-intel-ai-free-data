import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/index.js";
import { db } from "../src/db/client.js";

const originalEnv = { ...process.env };
const authHeaders = { Authorization: "Bearer change-me-too" };

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  process.env = { ...originalEnv };
});

describe("GPT MVP endpoints", () => {
  it("/gpt/reports/today/summary returns empty when no report exists", async () => {
    mockEmptyDb();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2099-01-05T04:00:00Z"));
    const { base, close } = await startApp();
    try {
      const response = await fetch(`${base}/gpt/reports/today/summary`, { headers: authHeaders });
      const body = await response.json() as { status: string; data_gaps: string[]; summary: string | null };
      expect(response.status).toBe(200);
      expect(body.status).toBe("empty");
      expect(body.data_gaps).toContain("missing_market_report");
      expect(body.summary).toBeNull();
    } finally {
      close();
    }
  });

  it("/gpt/signals/today returns missing_signal_engine when no signal exists", async () => {
    mockEmptyDb();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2099-01-05T04:00:00Z"));
    const { base, close } = await startApp();
    try {
      const response = await fetch(`${base}/gpt/signals/today`, { headers: authHeaders });
      const body = await response.json() as { status: string; data_gaps: string[] };
      expect(body.status).toBe("empty");
      expect(body.data_gaps).toContain("missing_signal_engine");
    } finally {
      close();
    }
  });

  it("/gpt/sectors/today returns explicit empty reason when no sector data exists", async () => {
    mockEmptyDb();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2099-01-05T04:00:00Z"));
    const { base, close } = await startApp();
    try {
      const response = await fetch(`${base}/gpt/sectors/today`, { headers: authHeaders });
      const body = await response.json() as { status: string; empty_reason: string; data_gaps: string[]; sector_strength: unknown[] };
      expect(body.status).toBe("empty");
      expect(body.empty_reason).toBe("sector_strength_pipeline_not_run_or_no_data");
      expect(body.data_gaps).toContain("sector_strength_empty");
      expect(body.sector_strength).toEqual([]);
    } finally {
      close();
    }
  });

  it("/gpt/candidates/today returns explicit empty reason when no candidate data exists", async () => {
    mockEmptyDb();
    const { base, close } = await startApp();
    try {
      const response = await fetch(`${base}/gpt/candidates/today?type=momentum`, { headers: authHeaders });
      const body = await response.json() as { status: string; empty_reason: string; ticker_candidates: unknown[] };
      expect(body.status).toBe("empty");
      expect(body.empty_reason).toBe("candidate_pipeline_not_run_or_no_data");
      expect(body.ticker_candidates).toEqual([]);
    } finally {
      close();
    }
  });

  it("/internal/ingest/news rejects requests without ADMIN_TOKEN", async () => {
    mockEmptyDb();
    delete process.env.ADMIN_TOKEN;
    const { base, close } = await startApp();
    try {
      const response = await fetch(`${base}/internal/ingest/news`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: [] })
      });
      expect(response.status).toBe(401);
    } finally {
      close();
    }
  });

  it("/internal/ingest/news upserts news_items with ADMIN_TOKEN", async () => {
    process.env.ADMIN_TOKEN = "admin-test-token";
    const queries: Array<{ sql: string; params?: unknown[] }> = [];
    vi.spyOn(db, "query").mockImplementation(async <T = unknown>(sql: string, params?: unknown[]) => {
      queries.push({ sql, params });
      return { rows: [] as T[], rowCount: 1 };
    });
    const { base, close } = await startApp();
    try {
      const response = await fetch(`${base}/internal/ingest/news`, {
        method: "POST",
        headers: {
          Authorization: "Bearer admin-test-token",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          items: [{
            id: "test-news-001",
            source: "manual_test",
            title: "test title",
            summary: null,
            full_text: null,
            source_url: "https://example.com/test",
            related_tickers: [],
            related_sectors: [],
            event_type: "other",
            importance: "medium",
            is_mops: false,
            data_quality_score: 45,
            data_gaps: ["summary_missing"],
            interpretation_limit: "title_only"
          }]
        })
      });
      const body = await response.json() as { status: string; inserted_or_updated: number };
      expect(response.status).toBe(200);
      expect(body.status).toBe("ok");
      expect(body.inserted_or_updated).toBe(1);
      expect(queries.some((query) => query.sql.includes("insert into news_items"))).toBe(true);
    } finally {
      close();
    }
  });

  it("/gpt/news/today/summary clamps limit to 50", async () => {
    const queries: Array<{ sql: string; params?: unknown[] }> = [];
    vi.spyOn(db, "query").mockImplementation(async <T = unknown>(sql: string, params?: unknown[]) => {
      queries.push({ sql, params });
      return { rows: [] as T[], rowCount: 0 };
    });
    const { base, close } = await startApp();
    try {
      const response = await fetch(`${base}/gpt/news/today/summary?limit=999`, { headers: authHeaders });
      const body = await response.json() as { status: string };
      const newsQuery = queries.find((query) => query.sql.includes("from news_items"));
      expect(response.status).toBe(200);
      expect(body.status).toBe("empty");
      expect(newsQuery?.params?.[0]).toBe(50);
    } finally {
      close();
    }
  });

  it("/gpt/market-calendar/today marks weekends as closed", async () => {
    mockEmptyDb();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-22T16:30:00Z"));
    const { base, close } = await startApp();
    try {
      const response = await fetch(`${base}/gpt/market-calendar/today`, { headers: authHeaders });
      const body = await response.json() as { today: string; is_trading_day: boolean; market_status: string; latest_trading_date: string };
      expect(body.today).toBe("2026-05-23");
      expect(body.is_trading_day).toBe(false);
      expect(body.market_status).toBe("closed");
      expect(body.latest_trading_date).toBe("2026-05-22");
    } finally {
      close();
    }
  });
});

function mockEmptyDb() {
  vi.spyOn(db, "query").mockImplementation(async <T = unknown>() => ({ rows: [] as T[], rowCount: 0 }));
}

async function startApp(): Promise<{ base: string; close: () => void }> {
  const app = createApp();
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => server.close()
  };
}
