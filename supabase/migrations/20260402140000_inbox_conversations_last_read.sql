-- Per-user read state for Gmail/thread inbox (dashboard). thread_id matches public.messages.thread_id.

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  thread_id text not null,
  last_read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint conversations_user_thread_unique unique (user_id, thread_id)
);

create index if not exists conversations_user_id_idx on public.conversations (user_id);
create index if not exists conversations_thread_id_idx on public.conversations (thread_id);

alter table public.conversations enable row level security;

create policy "conversations_select_own"
  on public.conversations for select
  using (auth.uid() = user_id);

create policy "conversations_insert_own"
  on public.conversations for insert
  with check (auth.uid() = user_id);

create policy "conversations_update_own"
  on public.conversations for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "conversations_delete_own"
  on public.conversations for delete
  using (auth.uid() = user_id);
