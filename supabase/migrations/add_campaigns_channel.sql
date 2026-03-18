-- BaseFlow: Add channel to campaigns (sms, email, auto)
alter table campaigns
  add column if not exists channel text default 'sms';
