alter table public.campaign_messages enable row level security;

drop policy if exists "Allow insert for authenticated users" on public.campaign_messages;
create policy "Allow insert for authenticated users"
  on public.campaign_messages for insert
  with check (auth.uid() is not null);

drop policy if exists "Allow select own messages" on public.campaign_messages;
create policy "Allow select own messages"
  on public.campaign_messages for select
  using (auth.uid() is not null);
