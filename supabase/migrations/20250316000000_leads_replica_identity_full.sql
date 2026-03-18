-- BaseFlow: REPLICA IDENTITY FULL on leads so Realtime filtered subscriptions work
-- Filtered postgres_changes (e.g. campaign_id=eq.xxx) require the filter column in the replica identity
alter table leads replica identity full;
