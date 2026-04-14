-- Denormalized last activity per thread (optional ordering + sync); messages remain source of truth.

alter table public.conversations
  add column if not exists last_message_at timestamptz;

create index if not exists conversations_user_last_message_at_idx
  on public.conversations (user_id, last_message_at desc nulls last);
