-- BaseFlow: Add user_id to audiences for RLS
alter table audiences
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

create index if not exists audiences_user_id_idx on audiences(user_id);
