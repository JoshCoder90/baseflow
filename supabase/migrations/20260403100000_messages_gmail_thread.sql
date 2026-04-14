-- Gmail thread id for grouping / future threading UI
alter table public.messages
  add column if not exists gmail_thread_id text;

create index if not exists messages_gmail_thread_id_idx
  on public.messages (gmail_thread_id)
  where gmail_thread_id is not null;
