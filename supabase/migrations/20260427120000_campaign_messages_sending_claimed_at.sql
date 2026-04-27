-- Claim timestamp for stale recovery (rows stuck in status = sending after worker crash / timeout)
alter table public.campaign_messages
  add column if not exists sending_claimed_at timestamptz;

create index if not exists campaign_messages_sending_stale_idx
  on public.campaign_messages (sending_claimed_at)
  where status = 'sending' and sent_at is null;

-- Legacy stuck rows: treat claim time as deploy time so they become eligible for stale release soon
update public.campaign_messages
set sending_claimed_at = now()
where status = 'sending'
  and sent_at is null
  and sending_claimed_at is null;
