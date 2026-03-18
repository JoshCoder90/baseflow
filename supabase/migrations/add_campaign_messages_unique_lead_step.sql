-- Prevent duplicate messages: one message per (campaign, lead, step)
-- First remove duplicates, keeping the earliest per (campaign_id, lead_id, step_number)
delete from campaign_messages a
using campaign_messages b
where a.campaign_id = b.campaign_id
  and a.lead_id = b.lead_id
  and a.step_number = b.step_number
  and a.id <> b.id
  and a.created_at > b.created_at;

create unique index if not exists campaign_messages_campaign_lead_step_unique
  on campaign_messages(campaign_id, lead_id, step_number);
