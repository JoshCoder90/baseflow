-- BaseFlow: Add email to leads table
alter table leads
  add column if not exists email text;
