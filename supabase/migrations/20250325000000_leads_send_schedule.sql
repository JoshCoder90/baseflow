-- Scheduled send time on leads (UI countdown + workers); safe if already present
alter table leads
  add column if not exists send_at timestamptz;

alter table leads
  add column if not exists next_send_at timestamptz;
