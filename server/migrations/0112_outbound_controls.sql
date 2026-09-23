-- Outbound notification controls and the IPAWS two-person rule.
--
-- Webhook and push destinations must be on their jurisdiction's allowlist,
-- checked when a rule is created and again by the worker at send time. A rule
-- queues at most rate_limit_max external deliveries per window; the excess is
-- suppressed and counted on one visible notification per rule and window. A
-- transmission to IPAWS-OPEN is a request by one admin that a different admin
-- confirms.

create table public.notification_allowlists (
  jurisdiction_id uuid primary key references public.jurisdictions(id),
  entries text[] not null default '{}',
  updated_by uuid not null references public.persons(id),
  updated_at timestamptz not null default now()
);

alter table public.notification_allowlists enable row level security;

create policy notification_allowlists_read on public.notification_allowlists
  for select using (public.is_admin_of(jurisdiction_id));
create policy notification_allowlists_insert on public.notification_allowlists
  for insert with check (public.is_admin_of(jurisdiction_id));
create policy notification_allowlists_update on public.notification_allowlists
  for update using (public.is_admin_of(jurisdiction_id));

grant select, insert, update on table public.notification_allowlists to app_runtime;

alter table public.notification_rules
  add column rate_limit_max integer not null default 60
    check (rate_limit_max between 1 and 600),
  add column rate_limit_window_minutes integer not null default 10
    check (rate_limit_window_minutes between 1 and 1440);

alter table public.delivery_outbox
  add column rule_id uuid references public.notification_rules(id);
update public.delivery_outbox d set rule_id = n.rule_id
  from public.notifications n where n.id = d.notification_id;
create index delivery_outbox_rule_recent on public.delivery_outbox (rule_id, created_at)
  where rule_id is not null;

alter table public.notifications drop constraint notifications_status_check;
alter table public.notifications add constraint notifications_status_check
  check (status = any (array['pending'::text, 'delivered'::text, 'failed'::text,
                             'suppressed'::text]));

-- Whether a rule may queue one more external delivery. The acting member may
-- not read the queue or the admin-only suppression notice under row-level
-- security, so the count and the notice are kept here. Concurrent writers can
-- each see the last free slot, so the cap can be overshot by the number of
-- transactions in flight at once.
create function public.admit_rule_delivery(target_rule uuid)
  returns boolean
  language plpgsql security definer
  set search_path to 'pg_catalog', 'public', 'pg_temp'
  as $$
declare
  r public.notification_rules%rowtype;
  window_start timestamptz;
begin
  select * into r from public.notification_rules where id = target_rule;
  if not found or not public.is_member_of(r.jurisdiction_id) then
    raise exception 'notification rule not found';
  end if;
  window_start := now() - make_interval(mins => r.rate_limit_window_minutes);
  if (select count(*) from public.delivery_outbox d
      where d.rule_id = target_rule and d.created_at > window_start) < r.rate_limit_max then
    return true;
  end if;
  update public.notifications
  set detail = jsonb_set(detail, '{suppressed}',
                         to_jsonb(coalesce((detail ->> 'suppressed')::integer, 0) + 1))
  where rule_id = target_rule and status = 'suppressed' and created_at > window_start;
  if not found then
    insert into public.notifications (jurisdiction_id, rule_id, channel, title, body, status, detail)
    values (r.jurisdiction_id, target_rule, 'rate_cap', 'Notification rule rate cap reached',
            format('Deliveries beyond %s per %s minutes are suppressed',
                   r.rate_limit_max, r.rate_limit_window_minutes),
            'suppressed',
            jsonb_build_object('suppressed', 1, 'limit', r.rate_limit_max,
                               'windowMinutes', r.rate_limit_window_minutes));
  end if;
  return false;
end $$;

revoke all on function public.admit_rule_delivery(uuid) from public;
grant execute on function public.admit_rule_delivery(uuid) to app_runtime;

-- The worker now receives each delivery's jurisdiction allowlist with the
-- claim, so a destination removed after its rule was created is refused.
drop function public.claim_deliveries(integer, integer);
create function public.claim_deliveries(batch integer, lease_seconds integer)
  returns table (id uuid, kind text, target text, headers jsonb, body text, attempts integer,
                 allowlist text[])
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
              where a.jurisdiction_id = d.jurisdiction_id), '{}'::text[])
$$;

revoke all on function public.claim_deliveries(integer, integer) from public;
grant execute on function public.claim_deliveries(integer, integer) to app_runtime;

-- A pending IPAWS transmission. 'live' sends to an enabled COG; 'handshake'
-- is the test-environment dry run. Expiry is read from expires_at.
create table public.ipaws_send_requests (
  id uuid primary key default gen_random_uuid(),
  jurisdiction_id uuid not null references public.jurisdictions(id),
  cap_alert_id uuid not null references public.cap_alerts(id),
  kind text not null check (kind in ('live', 'handshake')),
  requested_by uuid not null references public.persons(id),
  requested_at timestamptz not null default now(),
  expires_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'cancelled')),
  decided_by uuid references public.persons(id),
  decided_at timestamptz,
  submission_id uuid references public.ipaws_submissions(id),
  -- The two-person rule, held by the database as well as the service.
  constraint ipaws_send_requests_second_person
    check (status <> 'confirmed' or (decided_by is not null and decided_by <> requested_by))
);

create index ipaws_send_requests_jurisdiction
  on public.ipaws_send_requests (jurisdiction_id, requested_at desc);

alter table public.ipaws_send_requests enable row level security;

create policy ipaws_send_requests_read on public.ipaws_send_requests
  for select using (public.is_admin_of(jurisdiction_id));
create policy ipaws_send_requests_insert on public.ipaws_send_requests
  for insert with check (public.is_admin_of(jurisdiction_id)
                         and requested_by = public.current_person());
create policy ipaws_send_requests_update on public.ipaws_send_requests
  for update using (public.is_admin_of(jurisdiction_id));

grant select, insert, update on table public.ipaws_send_requests to app_runtime;
