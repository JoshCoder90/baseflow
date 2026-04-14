-- Per-message read flag; inbox marks all rows in a thread read when opened.
alter table public.messages
  add column if not exists read boolean not null default false;
