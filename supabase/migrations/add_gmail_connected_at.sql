-- Store when Gmail was first connected for account health / warm-up logic
alter table gmail_connections
  add column if not exists gmail_connected_at timestamptz default now();

-- Backfill existing rows from created_at (preserves first-connection date on reconnect)
update gmail_connections
  set gmail_connected_at = created_at
  where gmail_connected_at is null;
