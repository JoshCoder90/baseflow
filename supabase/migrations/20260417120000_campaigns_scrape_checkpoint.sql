-- Persistent state for serverless batched campaign scraping (Google Places pagination, etc.)
alter table public.campaigns
  add column if not exists scrape_checkpoint jsonb;
