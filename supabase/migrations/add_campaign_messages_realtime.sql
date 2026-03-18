-- Enable realtime for campaign_messages so the Sending Stats dashboard
-- refreshes when the send worker updates message status.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'campaign_messages'
  ) then
    alter publication supabase_realtime add table campaign_messages;
  end if;
end $$;
