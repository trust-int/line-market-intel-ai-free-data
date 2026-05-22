create extension if not exists pgcrypto;

create table if not exists data_sources (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  provider_type text not null,
  enabled boolean default false,
  paid boolean default false,
  requires_login boolean default false,
  requires_permission boolean default false,
  terms_checked boolean default false,
  license_status text default 'unknown',
  note text,
  created_at timestamptz default now()
);

create table if not exists line_messages (
  id uuid primary key default gen_random_uuid(),
  webhook_event_id text unique,
  source_type text,
  group_id text,
  room_id text,
  user_hash text,
  message_id text,
  message_type text not null,
  raw_text text,
  file_name text,
  mime_type text,
  file_path text,
  content_sha256 text,
  extracted_text text,
  ai_summary text,
  tickers text[] default '{}',
  topics text[] default '{}',
  event_type text,
  credibility_score numeric,
  catalyst_flags text[] default '{}',
  risk_flags text[] default '{}',
  message_time timestamptz,
  received_at timestamptz default now(),
  status text default 'active',
  error text
);

create index if not exists idx_line_messages_message_id on line_messages(message_id);
create index if not exists idx_line_messages_received_at on line_messages(received_at desc);
create index if not exists idx_line_messages_tickers on line_messages using gin(tickers);

create table if not exists news_events (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  source_url text,
  source_type text,
  title text,
  summary text,
  raw_text text,
  tickers text[] default '{}',
  topics text[] default '{}',
  macro_tags text[] default '{}',
  event_importance numeric,
  sentiment text,
  market_impact text,
  credibility_score numeric,
  license_status text default 'user_provided_or_public',
  published_at timestamptz,
  fetched_at timestamptz default now(),
  created_at timestamptz default now()
);

create index if not exists idx_news_events_fetched_at on news_events(fetched_at desc);
create index if not exists idx_news_events_tickers on news_events using gin(tickers);

create table if not exists market_daily (
  id uuid primary key default gen_random_uuid(),
  trade_date date not null,
  symbol text not null,
  symbol_type text not null,
  open numeric,
  high numeric,
  low numeric,
  close numeric,
  change_pct numeric,
  volume numeric,
  amount numeric,
  turnover numeric,
  source text,
  created_at timestamptz default now(),
  unique(trade_date, symbol, source)
);

create table if not exists market_intraday (
  id uuid primary key default gen_random_uuid(),
  trade_date date not null,
  symbol text not null,
  ts timestamptz not null,
  price numeric,
  open numeric,
  high numeric,
  low numeric,
  close numeric,
  volume numeric,
  amount numeric,
  vwap numeric,
  bid_qty numeric,
  ask_qty numeric,
  buy_volume numeric,
  sell_volume numeric,
  source text,
  created_at timestamptz default now()
);

create index if not exists idx_market_intraday_symbol_ts on market_intraday(symbol, ts desc);

create table if not exists daily_market_snapshots (
  id uuid primary key default gen_random_uuid(),
  trade_date date not null unique,
  taiex_close numeric,
  taiex_change_pct numeric,
  taiex_volume numeric,
  otc_close numeric,
  otc_change_pct numeric,
  advance_count integer,
  decline_count integer,
  foreign_net_buy numeric,
  investment_trust_net_buy numeric,
  dealer_net_buy numeric,
  margin_balance_change numeric,
  short_balance_change numeric,
  market_bias text not null default 'neutral',
  risk_level text not null default 'medium',
  data_quality_score numeric not null default 0,
  data_gaps text[] default '{}',
  source_status jsonb default '{}'::jsonb,
  snapshot_json jsonb,
  created_at timestamptz default now()
);

create index if not exists idx_daily_market_snapshots_trade_date on daily_market_snapshots(trade_date desc);

create table if not exists institutional_flows (
  id uuid primary key default gen_random_uuid(),
  trade_date date not null,
  ticker text not null,
  foreign_net numeric,
  investment_trust_net numeric,
  dealer_net numeric,
  total_net numeric,
  foreign_5d numeric,
  trust_5d numeric,
  total_10d numeric,
  source text,
  created_at timestamptz default now(),
  unique(trade_date, ticker, source)
);

create table if not exists margin_short (
  id uuid primary key default gen_random_uuid(),
  trade_date date not null,
  ticker text not null,
  margin_balance numeric,
  margin_change numeric,
  short_balance numeric,
  short_change numeric,
  borrow_sell_balance numeric,
  daytrade_ratio numeric,
  source text,
  created_at timestamptz default now(),
  unique(trade_date, ticker, source)
);

create table if not exists broker_branch_flows (
  id uuid primary key default gen_random_uuid(),
  trade_date date not null,
  ticker text not null,
  branch_name text not null,
  buy_qty numeric,
  sell_qty numeric,
  net_qty numeric,
  rank_side text,
  source text,
  created_at timestamptz default now()
);

create table if not exists watchlist (
  id uuid primary key default gen_random_uuid(),
  ticker text not null unique,
  name text,
  themes text[] default '{}',
  source text,
  note text,
  scope_type text,
  scope_id text,
  user_hash text,
  active boolean default true,
  created_at timestamptz default now()
);

create table if not exists holdings (
  id uuid primary key default gen_random_uuid(),
  ticker text not null,
  name text,
  qty numeric,
  avg_cost numeric,
  strategy text,
  thesis text,
  stop_loss numeric,
  take_profit numeric,
  scope_type text,
  scope_id text,
  user_hash text,
  active boolean default true,
  created_at timestamptz default now()
);

create unique index if not exists idx_holdings_scope_ticker on holdings(ticker, coalesce(scope_type, 'global'), coalesce(scope_id, 'global'));
create unique index if not exists idx_holdings_scope_ticker_exact on holdings(ticker, scope_type, scope_id);

create table if not exists strategy_reports (
  id uuid primary key default gen_random_uuid(),
  report_date date not null,
  report_type text not null,
  market_bias text,
  market_bias_score numeric,
  smart_money_phase text,
  summary_md text not null,
  report_json jsonb not null,
  created_at timestamptz default now(),
  unique(report_date, report_type)
);

create table if not exists trade_candidates (
  id uuid primary key default gen_random_uuid(),
  report_date date not null,
  ticker text not null,
  name text,
  candidate_type text,
  side text,
  score numeric,
  confidence_score numeric,
  historical_hit_rate numeric,
  entry_zone jsonb,
  exit_plan jsonb,
  triggers jsonb,
  risks text[],
  rationale text,
  created_at timestamptz default now()
);

create index if not exists idx_trade_candidates_date on trade_candidates(report_date desc);
create index if not exists idx_trade_candidates_ticker on trade_candidates(ticker, report_date desc);

create table if not exists manual_gpt_packs (
  id uuid primary key default gen_random_uuid(),
  pack_date date not null,
  pack_type text not null,
  markdown text not null,
  json_payload jsonb,
  created_at timestamptz default now(),
  unique(pack_date, pack_type)
);

create table if not exists backtest_results (
  id uuid primary key default gen_random_uuid(),
  setup_name text not null,
  lookback_days integer not null,
  sample_size integer not null,
  win_rate numeric,
  avg_return numeric,
  max_drawdown numeric,
  notes text not null,
  created_at timestamptz default now(),
  constraint backtest_win_rate_sample_check check (win_rate is null or sample_size >= 30)
);

insert into data_sources (name, provider_type, enabled, paid, requires_login, requires_permission, terms_checked, license_status, note)
values
  ('jin10-manual', 'news', true, false, false, false, true, 'user_provided', 'Manual/LINE ingestion only; no paid API.'),
  ('wallstreetcn-manual', 'news', true, false, false, false, true, 'user_provided', 'Manual/LINE ingestion only; no VIP/member crawling.'),
  ('futu-news-manual', 'news', true, false, false, false, true, 'user_provided', 'User-forwarded content only unless free permission is confirmed.'),
  ('twse-public', 'market', true, false, false, false, true, 'official_public', 'TWSE official public data.'),
  ('tpex-public', 'market', true, false, false, false, true, 'official_public', 'TPEx official public data.'),
  ('mops-public', 'market', true, false, false, false, true, 'official_public', 'MOPS official public data.'),
  ('futu-market', 'market', false, false, true, true, true, 'licensed', 'Disabled by default; quote-only if user already has free permission.')
on conflict (name) do update set
  enabled = excluded.enabled,
  paid = excluded.paid,
  requires_login = excluded.requires_login,
  requires_permission = excluded.requires_permission,
  terms_checked = excluded.terms_checked,
  license_status = excluded.license_status,
  note = excluded.note;
