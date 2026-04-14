-- Outbound mailbox identity for per-mailbox daily send caps (see lib/mailbox-daily-send-cap.ts)
alter table public.campaign_messages add column if not exists sender_email text;

create index if not exists campaign_messages_sender_sent_at_idx
  on public.campaign_messages (sender_email, sent_at)
  where status = 'sent';
