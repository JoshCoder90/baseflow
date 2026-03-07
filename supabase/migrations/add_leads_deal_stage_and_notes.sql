-- Run this in Supabase SQL Editor. BaseFlow: Deal Progress + Internal Notes.
-- Adds deal_stage for pipeline tracking and internal_notes for persistent notes.

alter table leads
add column if not exists deal_stage text default 'Lead';

alter table leads
add column if not exists internal_notes text;
