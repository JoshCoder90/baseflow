-- At most one in-flight "sending" row per campaign (prevents parallel claims racing).
WITH keeper AS (
  SELECT DISTINCT ON (campaign_id) id
  FROM public.campaign_messages
  WHERE status = 'sending'
  ORDER BY campaign_id, coalesce(sending_claimed_at, created_at), id
)
UPDATE public.campaign_messages m
SET status = 'queued',
    sending_claimed_at = NULL
WHERE m.status = 'sending'
  AND m.id NOT IN (SELECT id FROM keeper);

CREATE UNIQUE INDEX IF NOT EXISTS campaign_messages_one_sending_per_campaign_idx
  ON public.campaign_messages (campaign_id)
  WHERE status = 'sending';
