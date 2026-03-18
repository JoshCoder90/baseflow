-- BaseFlow: Lead generation status and realtime for live lead updates
-- Adds lead_generation_status to campaigns for tracking generation state
-- Enables realtime on leads table so UI can show leads appearing live

alter table campaigns
  add column if not exists lead_generation_status text default 'idle';

-- Enable realtime for leads so the campaign page can show leads appearing live
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'leads'
  ) then
    alter publication supabase_realtime add table leads;
  end if;
end $$;

-- Enable realtime for campaigns so we can detect when lead generation completes
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'campaigns'
  ) then
    alter publication supabase_realtime add table campaigns;
  end if;
end $$;
