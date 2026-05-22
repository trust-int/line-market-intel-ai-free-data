alter table daily_market_snapshots
  add column if not exists data_gaps text[] default '{}',
  add column if not exists source_status jsonb default '{}'::jsonb;
