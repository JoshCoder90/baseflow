-- Store Gmail OAuth tokens per user for sending via Gmail API
create table if not exists user_gmail_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  gmail_email text not null,
  access_token text not null,
  refresh_token text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id)
);

create index if not exists user_gmail_connections_user_id_idx on user_gmail_connections(user_id);
