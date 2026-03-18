-- BaseFlow: Campaign messages table for scheduled outreach
create table if not exists campaign_messages (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  lead_id uuid not null references leads(id) on delete cascade,
  step_number integer not null,
  channel text not null default 'sms',
  message_body text,
  send_at timestamptz not null,
  status text not null default 'pending',
  created_at timestamptz default now(),
  sent_at timestamptz
);

create index if not exists campaign_messages_campaign_id_idx on campaign_messages(campaign_id);
create index if not exists campaign_messages_lead_id_idx on campaign_messages(lead_id);
create index if not exists campaign_messages_send_at_status_idx on campaign_messages(send_at) where status = 'pending';
