-- Atomically claim at most one queued lead per campaign as "sending" (never multiple "sending").
create or replace function public.claim_next_campaign_lead(p_campaign_id uuid, p_now timestamptz)
returns setof leads
language sql
as $$
  with picked as (
    select id
    from public.leads
    where campaign_id = p_campaign_id
      and status = 'queued'
      and next_send_at is not null
      and next_send_at <= p_now
      and not exists (
        select 1
        from public.leads l2
        where l2.campaign_id = p_campaign_id
          and l2.status = 'sending'
      )
    order by next_send_at asc
    limit 1
    for update skip locked
  )
  update public.leads l
  set status = 'sending'
  from picked
  where l.id = picked.id
  returning l.*;
$$;

grant execute on function public.claim_next_campaign_lead(uuid, timestamptz) to service_role;
