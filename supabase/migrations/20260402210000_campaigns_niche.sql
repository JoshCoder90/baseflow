-- Optional explicit niche label for inbox / UI (can mirror target search)
alter table public.campaigns
  add column if not exists niche text;
