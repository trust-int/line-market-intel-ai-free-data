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
