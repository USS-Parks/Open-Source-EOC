-- Queue depths for the metrics endpoint.
--
-- The runtime role reads delivery_outbox only as a jurisdiction admin under
-- row-level security, and a metrics scrape acts for no person, so it gets
-- three counts through this function and no row data.

create function public.outbox_counts()
  returns table (delivery_pending integer, delivery_dead integer, federation_pending integer)
  language sql stable security definer
  set search_path to 'pg_catalog', 'public', 'pg_temp'
  as $$
  select (select count(*)::integer from public.delivery_outbox where status = 'pending'),
         (select count(*)::integer from public.delivery_outbox where status = 'dead'),
         (select count(*)::integer from public.federation_outbox where delivered_at is null)
$$;

revoke all on function public.outbox_counts() from public;
grant execute on function public.outbox_counts() to app_runtime;
