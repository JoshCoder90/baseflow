drop policy if exists allow_all_insert on public.campaign_messages;
create policy allow_all_insert
  on public.campaign_messages
  for insert
  with check (true);

drop policy if exists allow_all_select on public.campaign_messages;
create policy allow_all_select
  on public.campaign_messages
  for select
  using (true);
