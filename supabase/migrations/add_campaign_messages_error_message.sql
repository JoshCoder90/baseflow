-- Add error_message column to store failure details when send fails
alter table campaign_messages add column if not exists error_message text;
