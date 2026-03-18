-- BaseFlow: Add channel to messages (sms, email) for inbox display
alter table messages
  add column if not exists channel text;
