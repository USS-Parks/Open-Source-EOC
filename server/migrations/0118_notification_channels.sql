-- Email and SMS notification channels.
--
-- A rule may now send email through the jurisdiction's SMTP relay and SMS
-- through its SMS provider. Each recipient is one delivery row, queued inside
-- the write transaction like a webhook, so each is retried, rate capped and
-- receipted on its own. The relay and provider settings live per
-- jurisdiction; the relay password or provider token is stored
-- envelope-encrypted by the application and never returned by a route.

create table public.notification_channels (
  jurisdiction_id uuid not null references public.jurisdictions(id),
  kind text not null check (kind in ('email', 'sms')),
  settings jsonb not null,
  secret_envelope text,
  secret_fingerprint text,
  updated_by uuid not null references public.persons(id),
  updated_at timestamptz not null default now(),
  primary key (jurisdiction_id, kind)
);

alter table public.notification_channels enable row level security;

create policy notification_channels_read on public.notification_channels
  for select using (public.is_admin_of(jurisdiction_id));
create policy notification_channels_insert on public.notification_channels
  for insert with check (public.is_admin_of(jurisdiction_id));
create policy notification_channels_update on public.notification_channels
  for update using (public.is_admin_of(jurisdiction_id));

grant select, insert, update on table public.notification_channels to app_runtime;

alter table public.delivery_outbox drop constraint delivery_outbox_kind_check;
alter table public.delivery_outbox add constraint delivery_outbox_kind_check
  check (kind in ('webhook', 'ntfy', 'email', 'sms'));

-- What the relay or provider answered on acceptance: the SMTP reply and queue
-- id, or the provider's message id. Receipts and escalation build on it.
alter table public.delivery_outbox add column receipt jsonb;

-- The worker now also receives the jurisdiction and, for email and SMS, the
-- channel settings with the still-encrypted secret, read at send time so a
-- corrected setting applies to deliveries already queued.
drop function public.claim_deliveries(integer, integer);
create function public.claim_deliveries(batch integer, lease_seconds integer)
  returns table (id uuid, kind text, target text, headers jsonb, body text, attempts integer,
                 allowlist text[], jurisdiction_id uuid, channel jsonb)
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
     where c.jurisdiction_id = d.jurisdiction_id and c.kind = d.kind)
$$;

revoke all on function public.claim_deliveries(integer, integer) from public;
grant execute on function public.claim_deliveries(integer, integer) to app_runtime;

drop function public.settle_delivery(uuid, text, text, timestamptz);
create function public.settle_delivery(
  delivery_id uuid, outcome text, error text, retry_at timestamptz,
  delivery_receipt jsonb default null)
  returns void
  language plpgsql security definer
  set search_path to 'pg_catalog', 'public', 'pg_temp'
  as $$
declare
  note uuid;
begin
  if outcome not in ('delivered', 'retry', 'dead', 'deferred') then
    raise exception 'unknown delivery outcome %', outcome;
  end if;
  update public.delivery_outbox
  set status = case outcome when 'delivered' then 'delivered'
                            when 'dead' then 'dead' else 'pending' end,
      delivered_at = case when outcome = 'delivered' then now() else null end,
      attempts = case when outcome = 'deferred' then greatest(attempts - 1, 0) else attempts end,
      next_attempt_at = coalesce(retry_at, next_attempt_at),
      lease_until = null,
      last_error = coalesce(error, last_error),
      receipt = coalesce(delivery_receipt, receipt)
  where id = delivery_id and status = 'pending'
  returning notification_id into note;
  if note is null then return; end if;
  if outcome = 'delivered' then
    update public.notifications set status = 'delivered' where id = note;
  elsif outcome = 'dead' then
    update public.notifications
    set status = 'failed', detail = detail || jsonb_build_object('error', error)
    where id = note;
  end if;
end $$;

revoke all on function public.settle_delivery(uuid, text, text, timestamptz, jsonb) from public;
grant execute on function public.settle_delivery(uuid, text, text, timestamptz, jsonb) to app_runtime;
