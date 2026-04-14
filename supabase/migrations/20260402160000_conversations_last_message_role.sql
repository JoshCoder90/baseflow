-- Role of the latest activity (mirrors messages.role: inbound | outbound).

alter table public.conversations
  add column if not exists last_message_role text;
