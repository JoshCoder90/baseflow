-- Live email count for scrape UI (paired with leads_found)
alter table public.campaigns
  add column if not exists emails_found integer not null default 0;
