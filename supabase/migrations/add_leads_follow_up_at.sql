-- Run this in Supabase SQL Editor to add the follow-up reminder column to leads.
-- BaseFlow: Follow-Up Reminder feature

alter table leads
add column if not exists follow_up_at timestamptz;
