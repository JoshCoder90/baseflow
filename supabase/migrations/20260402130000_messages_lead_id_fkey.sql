-- PostgREST embed: messages.select('*, lead:leads(...)') requires a FK from messages.lead_id -> leads.id

do $$
begin
  if exists (
    select 1
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu
      on tc.constraint_name = kcu.constraint_name
      and tc.table_schema = kcu.table_schema
    join information_schema.constraint_column_usage ccu
      on ccu.constraint_name = tc.constraint_name
      and ccu.table_schema = tc.table_schema
    where tc.table_schema = 'public'
      and tc.table_name = 'messages'
      and tc.constraint_type = 'FOREIGN KEY'
      and kcu.column_name = 'lead_id'
      and ccu.table_name = 'leads'
  ) then
    return;
  end if;

  alter table public.messages
    add constraint messages_lead_id_fkey
    foreign key (lead_id) references public.leads (id) on delete set null;
end $$;
