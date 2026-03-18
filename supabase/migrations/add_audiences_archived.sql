-- Add archived column to audiences table
alter table audiences
add column if not exists archived boolean default false;

-- Allow audience_id to be null on leads (needed for archiving - leads are unlinked)
alter table leads
alter column audience_id drop not null;
