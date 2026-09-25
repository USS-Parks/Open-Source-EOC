-- Retention and the delivery hold in an outage.
--
-- A feed that cannot be reached keeps the items of its last successful poll:
-- the feed_items purge no longer deletes an item fetched at the feed's last
-- success, however old, so the map keeps the last good picture, marked stale,
-- through an outage longer than the retention period. Items the source
-- stopped returning still go once they pass the period.
--
-- The deliveries class purges expired deliveries with delivered and dead ones.
-- A resent delivery names the delivery it resent (0143); that link now clears
-- when the earlier delivery is purged. Before, purging a dead or expired
-- delivery whose resend was newer broke the reference and stopped the whole
-- purge pass.
alter table public.delivery_outbox drop constraint delivery_outbox_resent_from_fkey;
alter table public.delivery_outbox add constraint delivery_outbox_resent_from_fkey
  foreign key (resent_from) references public.delivery_outbox (id) on delete set null;

create or replace function public.retention_purge(batch integer)
  returns jsonb
  language plpgsql security definer
  set search_path to 'pg_catalog', 'public', 'pg_temp'
  as $$
declare
  j record;
  p record;
  ids uuid[];
  n integer;
  purged jsonb;
  periods jsonb;
  result jsonb := '{}';
begin
  for j in
    select r.jurisdiction_id as id,
           (array_agg(r.updated_by order by r.updated_at desc))[1] as actor
    from public.retention_policies r
    where r.retention_days is not null
    group by r.jurisdiction_id
  loop
    purged := '{}';
    periods := '{}';
    for p in
      select r.data_class, r.retention_days,
             now() - make_interval(days => r.retention_days) as cutoff
      from public.retention_policies r
      where r.jurisdiction_id = j.id and r.retention_days is not null
    loop
      periods := periods || jsonb_build_object(p.data_class, p.retention_days);
      if p.data_class = 'notifications' then
        -- A notification still waiting on a delivery is kept. Its settled
        -- delivery rows go with it.
        select array_agg(x.id) into ids from (
          select t.id from public.notifications t
          where t.jurisdiction_id = j.id and t.created_at < p.cutoff and t.status <> 'pending'
            and not exists (select 1 from public.delivery_outbox d
                            where d.notification_id = t.id and d.status = 'pending')
          limit batch) x;
        delete from public.delivery_outbox where notification_id = any(ids);
        get diagnostics n = row_count;
        purged := purged || jsonb_build_object('delivery_outbox',
          coalesce((purged ->> 'delivery_outbox')::integer, 0) + n);
        delete from public.notifications where id = any(ids);
        get diagnostics n = row_count;
        purged := purged || jsonb_build_object('notifications', n);
      elsif p.data_class = 'deliveries' then
        -- Settled deliveries (delivered, dead or expired), and federation
        -- entries the peer has received. Pending work is kept.
        delete from public.delivery_outbox where id in (
          select t.id from public.delivery_outbox t
          where t.jurisdiction_id = j.id and t.status in ('delivered', 'dead', 'expired')
            and t.created_at < p.cutoff
          limit batch);
        get diagnostics n = row_count;
        purged := purged || jsonb_build_object('delivery_outbox',
          coalesce((purged ->> 'delivery_outbox')::integer, 0) + n);
        delete from public.federation_outbox where id in (
          select t.id from public.federation_outbox t
          join public.peers pe on pe.id = t.peer_id
          where pe.jurisdiction_id = j.id and t.delivered_at < p.cutoff
          limit batch);
        get diagnostics n = row_count;
        purged := purged || jsonb_build_object('federation_outbox', n);
      elsif p.data_class = 'feed_items' then
        -- Items the source has not returned within the period. The items of a
        -- feed's last successful poll are kept however old, so a feed that
        -- cannot be reached keeps its last good picture.
        delete from public.feed_items where id in (
          select t.id from public.feed_items t
          join public.feeds f on f.id = t.feed_id
          where f.jurisdiction_id = j.id and t.fetched_at < p.cutoff
            and (f.last_success_at is null or t.fetched_at < f.last_success_at)
          limit batch);
        get diagnostics n = row_count;
        purged := purged || jsonb_build_object('feed_items', n);
      elsif p.data_class = 'tracking' then
        -- A tracked object goes with its whole chain once its latest event
        -- has expired, so no chain is ever left partial.
        select array_agg(x.id) into ids from (
          select o.id from public.tracked_objects o
          where o.jurisdiction_id = j.id and o.created_at < p.cutoff
            and not exists (select 1 from public.tracking_events e
                            where e.object_id = o.id
                              and (e.created_at >= p.cutoff or e.occurred_at >= p.cutoff))
          limit batch) x;
        delete from public.tracking_events where object_id = any(ids);
        get diagnostics n = row_count;
        purged := purged || jsonb_build_object('tracking_events', n);
        delete from public.tracked_objects where id = any(ids);
        get diagnostics n = row_count;
        purged := purged || jsonb_build_object('tracked_objects', n);
      elsif p.data_class = 'staff_checkins' then
        -- Open check-ins are kept.
        delete from public.staff_checkins where id in (
          select t.id from public.staff_checkins t
          where t.jurisdiction_id = j.id and t.checked_out_at < p.cutoff
          limit batch);
        get diagnostics n = row_count;
        purged := purged || jsonb_build_object('staff_checkins', n);
      end if;
    end loop;
    if exists (select 1 from jsonb_each_text(purged) c where c.value::integer > 0) then
      insert into public.audit_events (jurisdiction_id, person_id, category, subject_table, payload)
      values (j.id, j.actor, 'retention.purged', 'retention_policies',
              jsonb_build_object('retentionDays', periods, 'purged', purged));
      result := result || jsonb_build_object(j.id::text, purged);
    end if;
  end loop;
  return result;
end $$;

