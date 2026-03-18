-- Add archived column to leads for hiding from replies list
alter table leads
  add column if not exists archived boolean default false;
