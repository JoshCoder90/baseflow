-- Gmail thread id for correlating inbound replies with outbound sends
alter table public.messages
  add column if not exists thread_id text;

update public.messages
set thread_id = coalesce(thread_id, gmail_thread_id)
where gmail_thread_id is not null and (thread_id is null or thread_id = '');

create index if not exists messages_thread_id_idx
  on public.messages (thread_id)
  where thread_id is not null;
