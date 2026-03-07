-- BaseFlow: Unread indicator for Inbox
-- Adds unread boolean and trigger to set unread=true when lead sends a message

alter table leads
add column if not exists unread boolean default false;

-- Trigger: when an inbound message is inserted, mark the lead as unread
create or replace function set_lead_unread_on_inbound_message()
returns trigger
language plpgsql
security definer
as $$
begin
  if new.role = 'lead' or new.role = 'inbound' then
    update leads set unread = true where id = new.lead_id;
  end if;
  return new;
end;
$$;

drop trigger if exists on_inbound_message_set_lead_unread on messages;
create trigger on_inbound_message_set_lead_unread
  after insert on messages
  for each row
  execute function set_lead_unread_on_inbound_message();
