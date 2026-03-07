-- BaseFlow: Add target_leads to audiences
alter table audiences
  add column if not exists target_leads integer default 100;
