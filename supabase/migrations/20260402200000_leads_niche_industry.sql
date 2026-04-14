-- Optional per-lead niche / industry (campaign/audience used as fallback in UI when null)
alter table public.leads
  add column if not exists niche text,
  add column if not exists industry text;
