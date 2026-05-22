alter table if exists watchlist add column if not exists scope_type text;
alter table if exists watchlist add column if not exists scope_id text;
alter table if exists watchlist add column if not exists user_hash text;

alter table if exists holdings add column if not exists scope_type text;
alter table if exists holdings add column if not exists scope_id text;
alter table if exists holdings add column if not exists user_hash text;

create unique index if not exists idx_holdings_scope_ticker on holdings(ticker, coalesce(scope_type, 'global'), coalesce(scope_id, 'global'));
create unique index if not exists idx_holdings_scope_ticker_exact on holdings(ticker, scope_type, scope_id);
