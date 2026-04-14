-- Latest inbound (lead) message time for unread; outbound bumps must not advance this.
alter table public.conversations
  add column if not exists last_inbound_at timestamptz;

update public.conversations
set last_inbound_at = last_message_at
where last_message_role = 'inbound'
  and last_inbound_at is null
  and last_message_at is not null;

create index if not exists conversations_user_last_inbound_at_idx
  on public.conversations (user_id, last_inbound_at desc nulls last);
