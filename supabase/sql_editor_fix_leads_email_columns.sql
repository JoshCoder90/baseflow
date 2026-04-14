-- Run in Supabase → SQL Editor if you see:
--   "Could not find the 'guessed_email' column of 'leads'"
-- Safe to run more than once (uses IF NOT EXISTS).

ALTER TABLE leads ADD COLUMN IF NOT EXISTS email TEXT;

ALTER TABLE leads ADD COLUMN IF NOT EXISTS guessed_email TEXT;
