export const REQUIRED_TABLES = [
  "data_sources",
  "line_messages",
  "news_events",
  "market_daily",
  "market_intraday",
  "daily_market_snapshots",
  "institutional_flows",
  "margin_short",
  "broker_branch_flows",
  "watchlist",
  "holdings",
  "strategy_reports",
  "trade_candidates",
  "manual_gpt_packs",
  "backtest_results"
] as const;

export type RequiredTable = typeof REQUIRED_TABLES[number];
