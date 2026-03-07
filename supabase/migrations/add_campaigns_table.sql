-- BaseFlow: Campaigns table
create table if not exists campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  target_audience text,
  message_template text,
  follow_up_schedule text,
  status text default 'draft',
  created_at timestamptz default now()
);
