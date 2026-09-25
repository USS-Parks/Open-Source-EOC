-- Reach people by group, position and shift, and fall back to the next device.
--
-- A mass notification may now go to several contact groups, to whoever holds
-- a position, and to whoever is on shift in a position now, beside the chosen
-- contacts it already took. The send keeps what it was addressed to and how
-- many people each part reached, so its receipts can say that a position
-- reached no one, and each recipient keeps how it was reached. An incident's
-- activation may send its notice this way; that send names its incident.
--
-- A broadcast may fall back from one device to the next: its SMS and email go
-- one at a time in the order chosen, each later one queued to go once the
-- fallback minutes have passed on the one before. In-app notices go at once.
-- When the recipient acknowledges, by the link or in the app, the fallbacks
-- not yet sent are withdrawn: their queued deliveries and their notifications
-- are removed, since nothing was sent. A fallback already in flight goes.

alter table public.mass_notifications
  add column incident_id uuid references public.incidents(id),
  add column audience jsonb not null default '{}'::jsonb,
  add column fallback_minutes integer check (fallback_minutes between 1 and 1440),
  add constraint mass_notifications_fallback_broadcast
    check (fallback_minutes is null or mode = 'broadcast');

create index mass_notifications_incident on public.mass_notifications (incident_id)
  where incident_id is not null;

alter table public.mass_notification_recipients
  add column reached_through text check (length(reached_through) <= 300);

-- A delivery queued to go later is held for its window from when it falls
-- due, not from when it was queued, so a fallback cannot expire before it goes.
create or replace function public.stamp_delivery_hold()
  returns trigger
  language plpgsql security definer
  set search_path to 'pg_catalog', 'public', 'pg_temp'
  as $$
begin
  if new.hold_until is null then
    new.hold_until := greatest(coalesce(new.created_at, now()), coalesce(new.next_attempt_at, now()))
      + make_interval(hours => coalesce(
        (select w.hold_hours from public.delivery_hold_windows w
         where w.jurisdiction_id = new.jurisdiction_id and w.kind = new.kind), 72));
  end if;
  return new;
end $$;

create function public.withdraw_mass_fallbacks() returns trigger
  language plpgsql security definer
  set search_path to 'pg_catalog', 'public', 'pg_temp'
  as $$
declare
  withdrawn uuid[];
begin
  with gone as (
    delete from public.delivery_outbox d
    using public.notifications n
    where n.mass_recipient_id = new.id and d.notification_id = n.id
      and n.detail ? 'fallbackAt' and d.status = 'pending' and d.attempts = 0
    returning d.notification_id)
  select array_agg(gone.notification_id) into withdrawn from gone;
  if withdrawn is not null then
    delete from public.notifications n
    where n.id = any(withdrawn)
      and not exists (select 1 from public.delivery_outbox d where d.notification_id = n.id);
  end if;
  return null;
end $$;

create trigger mass_recipients_withdraw_fallbacks
  after update of acknowledged_at on public.mass_notification_recipients
  for each row when (old.acknowledged_at is null and new.acknowledged_at is not null)
  execute function public.withdraw_mass_fallbacks();

-- A send's receipts gain when a queued delivery falls due, so a fallback
-- waiting its turn reads as such rather than as queued.
drop function public.mass_notification_deliveries(uuid);
create function public.mass_notification_deliveries(mass_id uuid)
  returns table (recipient_id uuid, channel text, address text, status text,
                 attempts integer, error text, receipt jsonb, updated_at timestamptz,
                 due_at timestamptz)
  language sql stable security definer
  set search_path to 'pg_catalog', 'public', 'pg_temp'
  as $$
  select n.mass_recipient_id, n.channel, d.target,
         coalesce(d.status, n.status), coalesce(d.attempts, 0), d.last_error, d.receipt,
         coalesce(d.delivered_at, n.created_at), d.next_attempt_at
  from public.mass_notifications m
  join public.mass_notification_recipients r on r.mass_notification_id = m.id
  join public.notifications n on n.mass_recipient_id = r.id
  left join lateral (
    select q.* from public.delivery_outbox q
    where q.notification_id = n.id
    order by q.created_at desc, q.id desc
    limit 1) d on true
  where m.id = mass_notification_deliveries.mass_id and public.is_member_of(m.jurisdiction_id)
  order by r.priority, n.channel
$$;

revoke all on function public.mass_notification_deliveries(uuid) from public;
grant execute on function public.mass_notification_deliveries(uuid) to app_runtime;
