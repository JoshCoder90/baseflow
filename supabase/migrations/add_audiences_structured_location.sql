-- BaseFlow: Add structured location fields to audiences
alter table audiences
  add column if not exists city text,
  add column if not exists state text,
  add column if not exists country text,
  add column if not exists latitude double precision,
  add column if not exists longitude double precision;
