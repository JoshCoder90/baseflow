-- Required for lead inserts / enrichment: guessed_email + ensure email exists.
-- If production missed this migration, run: supabase/sql_editor_fix_leads_email_columns.sql

alter table leads add column if not exists email text;

alter table leads add column if not exists guessed_email text;

comment on column leads.guessed_email is 'Set to the guessed address when email was inferred from domain; null when scraped from the site.';
