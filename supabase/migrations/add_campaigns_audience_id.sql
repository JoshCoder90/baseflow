-- Add audience_id and user_id to campaigns for audience-based targeting
alter table campaigns
  add column if not exists audience_id uuid references audiences(id) on delete set null,
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

create index if not exists campaigns_audience_id_idx on campaigns(audience_id);
create index if not exists campaigns_user_id_idx on campaigns(user_id);
