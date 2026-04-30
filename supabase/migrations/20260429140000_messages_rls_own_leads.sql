-- Scope public.messages to leads owned by the authenticated user (matches inbox / CRM).
-- Service role bypasses RLS for workers and Gmail sync.

alter table public.messages enable row level security;

drop policy if exists "messages_select_own_leads" on public.messages;
create policy "messages_select_own_leads"
  on public.messages for select
  using (
    exists (
      select 1
      from public.leads l
      where l.id = messages.lead_id
        and l.user_id = auth.uid()
    )
  );

drop policy if exists "messages_insert_own_leads" on public.messages;
create policy "messages_insert_own_leads"
  on public.messages for insert
  with check (
    exists (
      select 1
      from public.leads l
      where l.id = messages.lead_id
        and l.user_id = auth.uid()
    )
  );

drop policy if exists "messages_update_own_leads" on public.messages;
create policy "messages_update_own_leads"
  on public.messages for update
  using (
    exists (
      select 1
      from public.leads l
      where l.id = messages.lead_id
        and l.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.leads l
      where l.id = messages.lead_id
        and l.user_id = auth.uid()
    )
  );
