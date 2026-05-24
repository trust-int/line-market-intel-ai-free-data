alter table if exists news_items add column if not exists metadata jsonb default '{}'::jsonb;
