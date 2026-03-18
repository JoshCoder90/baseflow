-- BaseFlow: Campaign-based lead generation (replacing audience dependency)
-- Adds campaign_id to leads and target_search_query to campaigns for natural language lead search

-- Add campaign_id to leads (nullable; leads can belong to campaign OR audience during migration)
alter table leads
  add column if not exists campaign_id uuid references campaigns(id) on delete cascade,
  add column if not exists company text;

create index if not exists leads_campaign_id_idx on leads(campaign_id);

-- Partial unique index: one place per campaign (prevents duplicates within same campaign)
create unique index if not exists leads_place_campaign_unique
  on leads(place_id, campaign_id)
  where campaign_id is not null and place_id is not null;

-- Add target_search_query to campaigns for natural language lead targeting
alter table campaigns
  add column if not exists target_search_query text;

-- Make audience_id nullable on campaigns (new flow uses target_search_query + campaign_id on leads)
alter table campaigns
  alter column audience_id drop not null;
