import type { Queryable } from "../db/client.js";
import { db } from "../db/client.js";
import type { InstitutionalFlow, MarginShort, StockDaily } from "../providers/market/provider.js";
import { clamp } from "../utils/math.js";

export type SectorStrength = {
  theme: string;
  score: number;
  phase: "未發動" | "剛發動" | "主升段" | "換手" | "過熱" | "轉弱";
  leaders: string[];
  second_line: string[];
  evidence: string[];
  risks: string[];
  data_quality_score: number;
  data_gaps: string[];
};

export type SectorStrengthInput = {
  marketDaily?: StockDaily[];
  watchlistThemes?: Array<{ ticker: string; name?: string; themes: string[] }>;
  topicEvents?: Array<{ ticker?: string; tickers?: string[]; topics?: string[]; source?: string; official?: boolean }>;
  institutionalFlows?: InstitutionalFlow[];
  marginShort?: MarginShort[];
};

export async function calculateSectorStrength(
  date: string,
  input?: SectorStrengthInput,
  database: Queryable = db
): Promise<{ sectors: SectorStrength[]; data_gaps: string[] }> {
  const data = input ?? await loadSectorStrengthInput(date, database);
  return calculateSectorStrengthFromInput(data);
}

export async function rankSectors(
  date: string,
  input?: SectorStrengthInput,
  database: Queryable = db
): Promise<SectorStrength[]> {
  const result = await calculateSectorStrength(date, input, database);
  return result.sectors;
}

export function calculateSectorStrengthFromInput(input: SectorStrengthInput): { sectors: SectorStrength[]; data_gaps: string[] } {
  const dataGaps = [
    !(input.marketDaily?.length) && "sector_market_daily_missing",
    !(input.watchlistThemes?.length) && "sector_theme_mapping_missing",
    !(input.institutionalFlows?.length) && "sector_institutional_flows_missing"
  ].filter((gap): gap is string => Boolean(gap));

  if (!input.watchlistThemes?.length || !input.marketDaily?.length) {
    return { sectors: [], data_gaps: dataGaps };
  }

  const byTicker = new Map(input.marketDaily.map((row) => [row.symbol, row]));
  const institutionalByTicker = new Map((input.institutionalFlows ?? []).map((row) => [row.ticker, row]));
  const marginByTicker = new Map((input.marginShort ?? []).map((row) => [row.ticker, row]));
  const eventsByTheme = buildEventHeat(input.topicEvents ?? []);
  const themeMap = new Map<string, Array<{ ticker: string; name?: string }>>();
  for (const item of input.watchlistThemes) {
    for (const theme of item.themes) {
      const list = themeMap.get(theme) ?? [];
      list.push({ ticker: item.ticker, name: item.name });
      themeMap.set(theme, list);
    }
  }

  const sectors = [...themeMap.entries()].map(([theme, members]) => {
    const rows = members.map((member) => ({ ...member, market: byTicker.get(member.ticker) })).filter((row) => row.market);
    const positiveRows = rows.filter((row) => (row.market?.changePct ?? 0) > 0);
    const sortedByChange = [...rows].sort((a, b) => (b.market?.changePct ?? 0) - (a.market?.changePct ?? 0));
    const leaders = sortedByChange.slice(0, 2).map((row) => row.ticker);
    const secondLine = sortedByChange.slice(2).filter((row) => (row.market?.changePct ?? 0) > 0).map((row) => row.ticker);
    const syncScore = rows.length ? (positiveRows.length / rows.length) * 100 : 0;
    const amountValues = rows.map((row) => row.market?.amount ?? row.market?.volume ?? 0);
    const avgAmount = amountValues.reduce((sum, value) => sum + value, 0) / Math.max(1, amountValues.length);
    const volumeScore = avgAmount > 0 ? clamp(Math.log10(avgAmount) * 12, 0, 100) : 0;
    const leaderScore = clamp((sortedByChange[0]?.market?.changePct ?? 0) * 20, 0, 100);
    const secondLineScore = rows.length > 2 ? (secondLine.length / Math.max(1, rows.length - 2)) * 100 : 0;
    const institutionScore = clamp(
      rows.reduce((sum, row) => {
        const flow = institutionalByTicker.get(row.ticker);
        return sum + (flow?.foreignNet ?? 0) + (flow?.investmentTrustNet ?? 0) * 1.5 + (flow?.dealerNet ?? 0);
      }, 0) / 100_000,
      0,
      100
    );
    const newsHeatScore = clamp((eventsByTheme.manual.get(theme) ?? 0) * 25, 0, 100);
    const catalystScore = clamp((eventsByTheme.official.get(theme) ?? 0) * 30, 0, 100);
    const marginRisk = clamp(
      rows.reduce((sum, row) => sum + Math.max(0, marginByTicker.get(row.ticker)?.marginChange ?? 0), 0) / 1000,
      0,
      100
    );
    const score = clamp(
      syncScore * 0.2 +
        volumeScore * 0.15 +
        leaderScore * 0.15 +
        secondLineScore * 0.1 +
        institutionScore * 0.15 +
        newsHeatScore * 0.1 +
        catalystScore * 0.1 -
        marginRisk * 0.05,
      0,
      100
    );
    const localGaps = [
      !rows.length && "sector_member_market_data_missing",
      !input.institutionalFlows?.length && "sector_institutional_flows_missing",
      !input.topicEvents?.length && "sector_topic_events_missing"
    ].filter((gap): gap is string => Boolean(gap));
    const sector: SectorStrength = {
      theme,
      score: Math.round(score),
      phase: "未發動",
      leaders,
      second_line: secondLine,
      evidence: [
        `同步上漲 ${positiveRows.length}/${rows.length}`,
        `量能分數 ${Math.round(volumeScore)}`,
        `法人分數 ${Math.round(institutionScore)}`
      ],
      risks: [
        ...(marginRisk > 70 ? ["融資增幅偏高"] : []),
        ...(localGaps.length ? ["資料不足，避免硬判斷強勢族群"] : [])
      ],
      data_quality_score: clamp(100 - localGaps.length * 20, 0, 100),
      data_gaps: localGaps
    };
    return { ...sector, phase: detectSectorPhase(sector) };
  });

  return {
    sectors: sectors.filter((sector) => sector.score >= 35).sort((a, b) => b.score - a.score),
    data_gaps: dataGaps
  };
}

export function detectSectorPhase(sector: Pick<SectorStrength, "score" | "risks" | "leaders" | "second_line" | "data_gaps">): SectorStrength["phase"] {
  if (sector.data_gaps.length > 1 || sector.score < 35) return "未發動";
  if (sector.risks.some((risk) => risk.includes("融資"))) return "過熱";
  if (sector.score >= 75 && sector.second_line.length > 0) return "主升段";
  if (sector.score >= 60) return "剛發動";
  if (sector.score >= 45 && sector.leaders.length > 0) return "換手";
  return "轉弱";
}

async function loadSectorStrengthInput(date: string, database: Queryable): Promise<SectorStrengthInput> {
  const [marketDaily, watchlist, institutional, margin, news] = await Promise.all([
    database.query<StockDaily & { change_pct?: number; trade_date?: string; ticker?: string; source?: string }>(
      "select trade_date as \"tradeDate\", symbol, symbol as ticker, close, change_pct as \"changePct\", volume, amount, source from market_daily where trade_date = $1 and symbol_type in ('stock','listed_stock','otc_stock')",
      [date]
    ),
    database.query<{ ticker: string; name?: string; themes: string[] }>(
      "select ticker, name, themes from watchlist where active = true",
      []
    ),
    database.query<InstitutionalFlow>(
      "select trade_date as \"tradeDate\", ticker, foreign_net as \"foreignNet\", investment_trust_net as \"investmentTrustNet\", dealer_net as \"dealerNet\", total_net as \"totalNet\", source from institutional_flows where trade_date = $1",
      [date]
    ),
    database.query<MarginShort>(
      "select trade_date as \"tradeDate\", ticker, margin_change as \"marginChange\", short_change as \"shortChange\", margin_balance as \"marginBalance\", short_balance as \"shortBalance\", source from margin_short where trade_date = $1",
      [date]
    ),
    database.query<{ tickers?: string[]; topics?: string[]; source?: string; license_status?: string }>(
      "select tickers, topics, source, license_status from news_events where fetched_at::date = $1",
      [date]
    )
  ]);
  return {
    marketDaily: marketDaily.rows.map((row) => ({ ...row, symbol: row.symbol ?? row.ticker ?? "" })),
    watchlistThemes: watchlist.rows,
    institutionalFlows: institutional.rows,
    marginShort: margin.rows,
    topicEvents: news.rows.map((row) => ({
      tickers: row.tickers ?? [],
      topics: row.topics ?? [],
      source: row.source,
      official: row.license_status === "official_public" || row.source === "mops"
    }))
  };
}

function buildEventHeat(events: NonNullable<SectorStrengthInput["topicEvents"]>) {
  const manual = new Map<string, number>();
  const official = new Map<string, number>();
  for (const event of events) {
    for (const topic of event.topics ?? []) {
      const map = event.official ? official : manual;
      map.set(topic, (map.get(topic) ?? 0) + 1);
    }
  }
  return { manual, official };
}
