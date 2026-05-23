create table if not exists market_reports (
  id bigserial primary key,
  report_date date not null,
  report_type text not null default 'summary',
  ai_mode text default 'manual',
  data_quality_score numeric default 0,
  data_gaps jsonb default '[]'::jsonb,
  sample_size integer default 0,
  backtest_available boolean default false,
  confidence_score numeric default 0,
  market_bias text,
  market_phase text,
  big_money_strategy text,
  risk_flags jsonb default '[]'::jsonb,
  summary text,
  raw_payload jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(report_date, report_type)
);

create index if not exists idx_market_reports_date_type on market_reports(report_date desc, report_type);

create table if not exists sector_strength (
  id bigserial primary key,
  report_date date not null,
  sector text not null,
  strength_score numeric default 0,
  rank integer,
  reason jsonb default '{}'::jsonb,
  leaders jsonb default '[]'::jsonb,
  risk_flags jsonb default '[]'::jsonb,
  created_at timestamptz default now(),
  unique(report_date, sector)
);

create index if not exists idx_sector_strength_date on sector_strength(report_date desc, rank);

create table if not exists ticker_candidates (
  id bigserial primary key,
  report_date date not null,
  ticker text not null,
  name text,
  sector text,
  candidate_type text default 'momentum',
  total_score numeric default 0,
  liquidity_score numeric default 0,
  volatility_score numeric default 0,
  chip_score numeric default 0,
  technical_score numeric default 0,
  sector_score numeric default 0,
  risk_score numeric default 0,
  entry_zone text,
  exit_zone text,
  stop_loss text,
  position_pct numeric default 0,
  confidence_score numeric default 0,
  sample_size integer default 0,
  risk_flags jsonb default '[]'::jsonb,
  created_at timestamptz default now(),
  unique(report_date, ticker, candidate_type)
);

create index if not exists idx_ticker_candidates_date_type on ticker_candidates(report_date desc, candidate_type, total_score desc);
create index if not exists idx_ticker_candidates_ticker on ticker_candidates(ticker, report_date desc);

create table if not exists news_items (
  id text primary key,
  source text not null,
  title text not null,
  summary text,
  full_text text,
  source_url text,
  related_tickers jsonb default '[]'::jsonb,
  related_sectors jsonb default '[]'::jsonb,
  event_type text default 'other',
  importance text default 'medium',
  is_mops boolean default false,
  data_quality_score numeric default 50,
  data_gaps jsonb default '[]'::jsonb,
  interpretation_limit text,
  collected_at timestamptz default now(),
  created_at timestamptz default now()
);

create index if not exists idx_news_items_collected_at on news_items(collected_at desc);
create index if not exists idx_news_items_related_tickers on news_items using gin(related_tickers);

create table if not exists data_source_status (
  id bigserial primary key,
  source_name text not null,
  status text not null,
  reason text,
  last_updated timestamptz,
  payload_size_bytes integer,
  created_at timestamptz default now(),
  unique(source_name)
);
