-- Message queue deduplication: ensure same lead cannot get same step twice
-- Schema: lead_id, campaign_id, step_number (step), send_at (scheduled_at), status
-- Unique constraint: (lead_id, campaign_id, step_number)

-- 1. Remove duplicates, keeping the earliest per (lead_id, campaign_id, step_number)
delete from campaign_messages a
using campaign_messages b
where a.campaign_id = b.campaign_id
  and a.lead_id = b.lead_id
  and a.step_number = b.step_number
  and a.id <> b.id
  and a.created_at > b.created_at;

-- 2. Unique constraint: no duplicate (lead, campaign, step)
create unique index if not exists campaign_messages_campaign_lead_step_unique
  on campaign_messages(lead_id, campaign_id, step_number);
