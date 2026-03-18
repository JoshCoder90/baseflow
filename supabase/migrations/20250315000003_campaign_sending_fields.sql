-- Add fields for campaign sending worker (lead-based phase tracking)
alter table leads
  add column if not exists phase text,
  add column if not exists last_message_sent_at timestamptz,
  add column if not exists messages_sent integer default 0;

-- Add subject, started_at, and daily send tracking to campaigns
alter table campaigns
  add column if not exists subject text default 'Quick question',
  add column if not exists started_at timestamptz,
  add column if not exists daily_sends_count integer default 0,
  add column if not exists daily_sends_date date;
