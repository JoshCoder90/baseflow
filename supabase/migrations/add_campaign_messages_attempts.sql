-- Add attempts column for retry tracking
alter table campaign_messages add column if not exists attempts integer not null default 0;
