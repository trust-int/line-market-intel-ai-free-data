alter table if exists news_items add column if not exists status text default 'active';
alter table if exists news_items add column if not exists archived_at timestamptz;
alter table if exists news_items add column if not exists archived_reason text;

update news_items set status = 'active' where status is null;

create index if not exists idx_news_items_status_collected_at on news_items(status, collected_at desc);
