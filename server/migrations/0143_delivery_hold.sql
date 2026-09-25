-- Hold outbound messages through an outage instead of dropping them.
--
-- A delivery that cannot reach its relay, provider or target used to be
-- dead-lettered at its eighth attempt, a few minutes into an outage. Each
-- delivery now carries the time it is held until: its jurisdiction's window
-- for its kind (72 hours unless an administrator sets another, 1 to 720),
-- stamped when it is queued. The worker retries until then and marks it
-- expired, never discarding it on an attempt count; a refusal (a destination
-- off the allowlist, an unconfigured channel, a relay rejecting the message)
-- is still dead at once. While a delivery waits, its notification says so.
-- An administrator may resend a dead or expired delivery. Deliveries may
-- carry stored attachments, so scheduled report email goes through the queue.

create table public.delivery_hold_windows (
  jurisdiction_id uuid not null references public.jurisdictions(id),
  kind text not null check (kind in ('webhook', 'ntfy', 'email', 'sms')),
  hold_hours integer not null check (hold_hours between 1 and 720),
  updated_by uuid references public.persons(id),
  updated_at timestamptz not null default now(),
  primary key (jurisdiction_id, kind)
);

alter table public.delivery_hold_windows enable row level security;

create policy delivery_hold_windows_read on public.delivery_hold_windows
  for select using (public.is_member_of(jurisdiction_id));
create policy delivery_hold_windows_insert on public.delivery_hold_windows
  for insert with check (public.is_admin_of(jurisdiction_id));
create policy delivery_hold_windows_update on public.delivery_hold_windows
  for update using (public.is_admin_of(jurisdiction_id));

grant select, insert, update on table public.delivery_hold_windows to app_runtime;

alter table public.delivery_outbox add column hold_until timestamptz;
alter table public.delivery_outbox add column attachments jsonb not null default '[]'::jsonb;
alter table public.delivery_outbox add column resent_from uuid references public.delivery_outbox(id);

update public.delivery_outbox set hold_until = created_at + interval '72 hours';
alter table public.delivery_outbox alter column hold_until set not null;

alter table public.delivery_outbox drop constraint delivery_outbox_status_check;
alter table public.delivery_outbox add constraint delivery_outbox_status_check
  check (status in ('pending', 'delivered', 'dead', 'expired'));

create index delivery_outbox_resent_from on public.delivery_outbox (resent_from)
  where resent_from is not null;

-- The hold is stamped by the database, so every path that queues a delivery
-- (rules, mass notification, reports, resend) gets the same window.
create function public.stamp_delivery_hold()
  returns trigger
  language plpgsql security definer
  set search_path to 'pg_catalog', 'public', 'pg_temp'
  as $$
begin
  if new.hold_until is null then
    new.hold_until := coalesce(new.created_at, now()) + make_interval(hours => coalesce(
      (select w.hold_hours from public.delivery_hold_windows w
       where w.jurisdiction_id = new.jurisdiction_id and w.kind = new.kind), 72));
  end if;
  return new;
end $$;

create trigger delivery_outbox_hold before insert on public.delivery_outbox
  for each row execute function public.stamp_delivery_hold();

drop function public.claim_deliveries(integer, integer);
create function public.claim_deliveries(batch integer, lease_seconds integer)
  returns table (id uuid, kind text, target text, headers jsonb, body text, attempts integer,
                 allowlist text[], jurisdiction_id uuid, channel jsonb,
                 hold_until timestamptz, attachments jsonb)
  language sql security definer
  set search_path to 'pg_catalog', 'public', 'pg_temp'
  as $$
  update public.delivery_outbox d
  set attempts = d.attempts + 1,
      lease_until = now() + make_interval(secs => lease_seconds)
  where d.id in (
    select q.id from public.delivery_outbox q
    where q.status = 'pending' and q.next_attempt_at <= now()
      and (q.lease_until is null or q.lease_until < now())
    order by q.next_attempt_at
    limit batch
    for update skip locked)
  returning d.id, d.kind, d.target, d.headers, d.body, d.attempts,
    coalesce((select a.entries from public.notification_allowlists a
              where a.jurisdiction_id = d.jurisdiction_id), '{}'::text[]),
    d.jurisdiction_id,
    (select jsonb_build_object('settings', c.settings, 'secret', c.secret_envelope)
     from public.notification_channels c
     where c.jurisdiction_id = d.jurisdiction_id and c.kind = d.kind),
    d.hold_until, d.attachments
$$;

revoke all on function public.claim_deliveries(integer, integer) from public;
grant execute on function public.claim_deliveries(integer, integer) to app_runtime;

-- outcome: 'delivered'; 'retry' at retry_at; 'deferred' at retry_at without
-- spending an attempt (a target's circuit is open); 'dead', a refusal that no
-- wait will change; 'expire', the hold ran out with no route.
drop function public.settle_delivery(uuid, text, text, timestamptz, jsonb);
create function public.settle_delivery(
  delivery_id uuid, outcome text, error text, retry_at timestamptz,
  delivery_receipt jsonb default null)
  returns void
  language plpgsql security definer
  set search_path to 'pg_catalog', 'public', 'pg_temp'
  as $$
declare
  note uuid;
  held timestamptz;
  tries integer;
begin
  if outcome not in ('delivered', 'retry', 'dead', 'deferred', 'expire') then
    raise exception 'unknown delivery outcome %', outcome;
  end if;
  update public.delivery_outbox
  set status = case outcome when 'delivered' then 'delivered'
                            when 'dead' then 'dead'
                            when 'expire' then 'expired' else 'pending' end,
      delivered_at = case when outcome = 'delivered' then now() else null end,
      attempts = case when outcome = 'deferred' then greatest(attempts - 1, 0) else attempts end,
      next_attempt_at = coalesce(retry_at, next_attempt_at),
      lease_until = null,
      last_error = coalesce(error, last_error),
      receipt = coalesce(delivery_receipt, receipt)
  where id = delivery_id and status = 'pending'
  returning notification_id, hold_until, attempts into note, held, tries;
  if note is null then return; end if;
  if outcome = 'delivered' then
    update public.notifications
    set status = 'delivered', detail = detail - 'waiting'
    where id = note;
  elsif outcome = 'dead' then
    update public.notifications
    set status = 'failed', detail = (detail - 'waiting') || jsonb_build_object('error', error)
    where id = note;
  elsif outcome = 'expire' then
    update public.notifications
    set status = 'failed',
        detail = (detail - 'waiting') || jsonb_build_object(
          'error', error, 'expired', true, 'heldUntil', held)
    where id = note;
  else
    update public.notifications
    set detail = detail || jsonb_build_object('waiting', jsonb_build_object(
          'since', coalesce(detail #> '{waiting,since}', to_jsonb(now())),
          'lastError', error, 'attempts', tries, 'holdUntil', held, 'nextAttemptAt', retry_at))
    where id = note;
  end if;
end $$;

revoke all on function public.settle_delivery(uuid, text, text, timestamptz, jsonb) from public;
grant execute on function public.settle_delivery(uuid, text, text, timestamptz, jsonb) to app_runtime;

-- Queue a dead or expired delivery again with a fresh hold, for an
-- administrator of its jurisdiction. Returns the new delivery's id, or null
-- when the notification has no delivery that may be resent.
create function public.resend_delivery(target_notification uuid)
  returns uuid
  language plpgsql security definer
  set search_path to 'pg_catalog', 'public', 'pg_temp'
  as $$
declare
  last public.delivery_outbox%rowtype;
  fresh uuid := gen_random_uuid();
begin
  select d.* into last from public.delivery_outbox d
  where d.notification_id = target_notification
  order by d.created_at desc, d.id desc
  limit 1;
  if not found then return null; end if;
  if not public.is_admin_of(last.jurisdiction_id) then
    raise exception 'resend requires an administrator of the jurisdiction'
      using errcode = '42501';
  end if;
  if last.status not in ('dead', 'expired') then return null; end if;
  insert into public.delivery_outbox
    (id, jurisdiction_id, rule_id, notification_id, kind, target, headers, body, attachments, resent_from)
  values
    (fresh, last.jurisdiction_id, last.rule_id, last.notification_id, last.kind, last.target,
     last.headers, last.body, last.attachments, last.id);
  update public.notifications
  set status = 'pending',
      detail = (detail - 'waiting' - 'expired' - 'heldUntil' - 'error')
        || jsonb_build_object('resentAt', now(), 'resentFrom', last.id)
  where id = target_notification;
  return fresh;
end $$;

revoke all on function public.resend_delivery(uuid) from public;
grant execute on function public.resend_delivery(uuid) to app_runtime;

-- A send's receipts read each notification's latest delivery, so a resent
-- message shows once, as it now stands.
create or replace function public.mass_notification_deliveries(mass_id uuid)
  returns table (recipient_id uuid, channel text, address text, status text,
                 attempts integer, error text, receipt jsonb, updated_at timestamptz)
  language sql stable security definer
  set search_path to 'pg_catalog', 'public', 'pg_temp'
  as $$
  select n.mass_recipient_id, n.channel, d.target,
         coalesce(d.status, n.status), coalesce(d.attempts, 0), d.last_error, d.receipt,
         coalesce(d.delivered_at, n.created_at)
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

-- A scheduled report's emails now wait in the delivery queue, so a run can end
-- with its emails queued rather than already delivered.
alter table public.report_runs drop constraint report_runs_outcome_check;
alter table public.report_runs add constraint report_runs_outcome_check
  check (outcome in ('delivered', 'queued', 'partial', 'failed'));

-- Queue depths for the metrics endpoint gain expired deliveries; a dead or
-- expired delivery that was resent is counted once, as its resend.
drop function public.outbox_counts();
create function public.outbox_counts()
  returns table (delivery_pending integer, delivery_dead integer, delivery_expired integer,
                 federation_pending integer)
  language sql stable security definer
  set search_path to 'pg_catalog', 'public', 'pg_temp'
  as $$
  select (select count(*)::integer from public.delivery_outbox where status = 'pending'),
         (select count(*)::integer from public.delivery_outbox d where d.status = 'dead'
            and not exists (select 1 from public.delivery_outbox r where r.resent_from = d.id)),
         (select count(*)::integer from public.delivery_outbox d where d.status = 'expired'
            and not exists (select 1 from public.delivery_outbox r where r.resent_from = d.id)),
         (select count(*)::integer from public.federation_outbox where delivered_at is null)
$$;

revoke all on function public.outbox_counts() from public;
grant execute on function public.outbox_counts() to app_runtime;
