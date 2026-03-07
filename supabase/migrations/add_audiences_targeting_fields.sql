-- BaseFlow: Add targeting fields to audiences
alter table audiences
  add column if not exists location text,
  add column if not exists business_size text,
  add column if not exists lead_source text,
  add column if not exists notes text;
