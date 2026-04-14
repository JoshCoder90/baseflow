-- Add sent_count to campaigns for tracking emails sent
alter table campaigns add column if not exists sent_count integer not null default 0;
