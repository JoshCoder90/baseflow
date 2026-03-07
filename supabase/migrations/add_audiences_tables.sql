-- BaseFlow: Audiences and audience_leads tables
create table if not exists audiences (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  niche text,
  created_at timestamptz default now()
);

create table if not exists audience_leads (
  id uuid primary key default gen_random_uuid(),
  audience_id uuid not null references audiences(id) on delete cascade,
  name text,
  company text,
  email text,
  phone text,
  status text default 'New',
  created_at timestamptz default now()
);

create index if not exists audience_leads_audience_id_idx on audience_leads(audience_id);
