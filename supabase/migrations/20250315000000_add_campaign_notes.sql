-- Add notes to campaigns for campaign-level notes (matches audience notes pattern)
alter table campaigns
  add column if not exists notes text;
