-- Live scrape progress surfaced on campaigns for polling UI
alter table public.campaigns
  add column if not exists leads_found integer not null default 0;
