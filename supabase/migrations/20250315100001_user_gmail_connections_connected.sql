alter table user_gmail_connections
  add column if not exists connected boolean default true;
