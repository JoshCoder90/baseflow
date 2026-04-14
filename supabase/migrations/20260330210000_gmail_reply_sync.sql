-- Gmail reply sync: dedupe + optional campaign link + incremental sync cursor

alter table public.messages
  add column if not exists gmail_message_id text,
  add column if not exists campaign_id uuid references public.campaigns(id) on delete set null;

create unique index if not exists messages_gmail_message_id_unique
  on public.messages (gmail_message_id)
  where gmail_message_id is not null;

create index if not exists messages_campaign_id_idx
  on public.messages (campaign_id)
  where campaign_id is not null;

alter table public.gmail_connections
  add column if not exists gmail_replies_synced_at timestamptz;

-- Realtime for inbox / lead conversation (idempotent)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table messages;
  end if;
end $$;
