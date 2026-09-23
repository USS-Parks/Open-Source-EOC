-- Records retention, and forwarding of the audit trail to an external sink.
--
-- A jurisdiction admin sets a retention period per data class. Nothing is
-- purged for a class until its period is set. The purge reaches only the
-- tables named for each class in retention_purge below, an explicit list;
-- none of them carries an append-only trigger. The audit trail, audit_events
-- and every table guarded by an append-only trigger, is never purged, only
-- exported. Incident records, including those of closed incidents, are not
-- purged either: records retention law varies by jurisdiction.

create table public.retention_policies (
  jurisdiction_id uuid not null references public.jurisdictions(id),
  data_class text not null check (data_class in
    ('notifications', 'deliveries', 'feed_items', 'tracking', 'staff_checkins')),
  -- Null keeps the class indefinitely.
  retention_days integer check (retention_days between 1 and 36500),
  updated_by uuid not null references public.persons(id),
  updated_at timestamptz not null default now(),
  primary key (jurisdiction_id, data_class)
);

alter table public.retention_policies enable row level security;

create policy retention_policies_read on public.retention_policies
  for select using (public.is_admin_of(jurisdiction_id));
create policy retention_policies_write on public.retention_policies
  for insert with check (public.is_admin_of(jurisdiction_id) and updated_by = public.current_person());
create policy retention_policies_update on public.retention_policies
  for update using (public.is_admin_of(jurisdiction_id))
  with check (public.is_admin_of(jurisdiction_id) and updated_by = public.current_person());

grant select, insert, update on table public.retention_policies to app_runtime;

-- Deleting a notification checks delivery_outbox for rows that reference it.
create index delivery_outbox_notification on public.delivery_outbox (notification_id);

-- One purge pass. For each jurisdiction with a retention period set, delete at
-- most `batch` expired rows per class, then append one audit event with the
-- counts per table, attributed to the admin who last set that jurisdiction's
-- policy. Returns {jurisdiction id: {table: count}} for the jurisdictions where
-- anything was deleted. The scheduler acts for no person, so this is its only
-- way to these rows.
create function public.retention_purge(batch integer)
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
        -- Settled webhook and push deliveries, and federation entries the peer
        -- has received. Pending work is kept.
        delete from public.delivery_outbox where id in (
          select t.id from public.delivery_outbox t
          where t.jurisdiction_id = j.id and t.status in ('delivered', 'dead')
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
        -- Items the source has not returned within the period.
        delete from public.feed_items where id in (
          select t.id from public.feed_items t
          join public.feeds f on f.id = t.feed_id
          where f.jurisdiction_id = j.id and t.fetched_at < p.cutoff
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

-- Audit forwarding. Each audit event records the id of the transaction that
-- wrote it. A reader walks events in (xact, seq) order, only below the oldest
-- transaction still running, so it never passes an event whose transaction
-- commits late; a high-water mark on seq alone would skip such an event for
-- good. Events written before this column existed have no xact and are not
-- forwarded.
alter table public.audit_events add column xact xid8;
alter table public.audit_events alter column xact set default pg_current_xact_id();
create index audit_events_xact on public.audit_events (xact, seq) where xact is not null;

-- The forwarding mark. Reached only through the two functions below, so it
-- has no policies and no grants.
create table public.audit_forwarding (
  sink text primary key,
  last_xact xid8 not null,
  last_seq bigint not null,
  updated_at timestamptz not null default now()
);

alter table public.audit_forwarding enable row level security;

-- The next events for the syslog sink, oldest first, from transactions that
-- have all finished. The first call sets the mark at the current horizon, so
-- forwarding starts with events written from then on.
create function public.audit_forward_batch(batch integer)
  returns table (xact xid8, seq bigint, id uuid, created_at timestamptz,
                 jurisdiction_id uuid, incident_id uuid, person_id uuid, person text,
                 position_id uuid, category text, subject_table text, subject_id uuid,
                 corrects uuid, payload jsonb)
  language plpgsql security definer
  set search_path to 'pg_catalog', 'public', 'pg_temp'
  as $$
#variable_conflict use_column
declare
  horizon xid8 := pg_snapshot_xmin(pg_current_snapshot());
  mark record;
begin
  select f.last_xact, f.last_seq into mark
  from public.audit_forwarding f where f.sink = 'syslog';
  if not found then
    insert into public.audit_forwarding (sink, last_xact, last_seq)
    values ('syslog', horizon, 0) on conflict do nothing;
    return;
  end if;
  return query
    select e.xact, e.seq, e.id, e.created_at, e.jurisdiction_id, e.incident_id,
           e.person_id, pn.display_name, e.position_id, e.category, e.subject_table,
           e.subject_id, e.corrects, e.payload
    from public.audit_events e
    join public.persons pn on pn.id = e.person_id
    where e.xact is not null
      and (e.xact, e.seq) > (mark.last_xact, mark.last_seq)
      and e.xact < horizon
    order by e.xact, e.seq
    limit batch;
end $$;

-- Move the mark past events the sink accepted. The mark never moves back.
create function public.audit_forward_advance(to_xact xid8, to_seq bigint)
  returns void
  language sql security definer
  set search_path to 'pg_catalog', 'public', 'pg_temp'
  as $$
  update public.audit_forwarding f
  set last_xact = to_xact, last_seq = to_seq, updated_at = now()
  where f.sink = 'syslog' and (f.last_xact, f.last_seq) < (to_xact, to_seq)
$$;

revoke all on function public.retention_purge(integer) from public;
revoke all on function public.audit_forward_batch(integer) from public;
revoke all on function public.audit_forward_advance(xid8, bigint) from public;
grant execute on function public.retention_purge(integer) to app_runtime;
grant execute on function public.audit_forward_batch(integer) to app_runtime;
grant execute on function public.audit_forward_advance(xid8, bigint) to app_runtime;
