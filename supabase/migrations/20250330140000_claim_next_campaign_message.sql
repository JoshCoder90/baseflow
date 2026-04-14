-- Claim at most one queued campaign_message per campaign as "sending" (single-flight sends).
create or replace function public.claim_next_campaign_message(p_campaign_id uuid, p_now timestamptz)
returns setof campaign_messages
language sql
as $$
  with picked as (
    select id
    from public.campaign_messages
    where campaign_id = p_campaign_id
      and status = 'queued'
      and next_send_at is not null
      and next_send_at <= p_now
      and sent_at is null
      and not exists (
        select 1
        from public.campaign_messages m2
        where m2.campaign_id = p_campaign_id
          and m2.status = 'sending'
      )
    order by next_send_at asc, id asc
    limit 1
    for update skip locked
  )
  update public.campaign_messages m
  set status = 'sending'
  from picked
  where m.id = picked.id
  returning m.*;
$$;

grant execute on function public.claim_next_campaign_message(uuid, timestamptz) to service_role;
