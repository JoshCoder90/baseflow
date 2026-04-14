-- Staggered send times when a campaign starts (status queued + next_send_at)
alter table campaign_messages
  add column if not exists next_send_at timestamptz;
