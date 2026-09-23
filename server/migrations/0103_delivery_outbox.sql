-- Outbound delivery queue.
--
-- Webhook and push notifications used to be sent inline, after the board write
-- committed but before the HTTP response returned, so a slow target held the
-- operator's request open. They are now written here inside the write
-- transaction and delivered by a worker with retry, backoff and a dead letter.
-- The same worker pushes the federation outbox to peers that have a link.

alter table public.notifications drop constraint notifications_status_check;
alter table public.notifications add constraint notifications_status_check
  check (status = any (array['pending'::text, 'delivered'::text, 'failed'::text]));

create table public.delivery_outbox (
  id uuid primary key default gen_random_uuid(),
  jurisdiction_id uuid not null references public.jurisdictions(id),
  notification_id uuid not null references public.notifications(id),
  kind text not null check (kind in ('webhook', 'ntfy')),
  target text not null,
  headers jsonb not null default '{}'::jsonb,
  body text not null,
  status text not null default 'pending' check (status in ('pending', 'delivered', 'dead')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  lease_until timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  delivered_at timestamptz
);

create index delivery_outbox_due on public.delivery_outbox (next_attempt_at)
  where status = 'pending';

alter table public.delivery_outbox enable row level security;

create policy delivery_outbox_write on public.delivery_outbox
  for insert with check (public.is_member_of(jurisdiction_id));

create policy delivery_outbox_read on public.delivery_outbox
  for select using (public.is_admin_of(jurisdiction_id));

grant select, insert on table public.delivery_outbox to app_runtime;

-- Peer links: where to push, and the token the remote instance issued to us.
-- The token is stored envelope-encrypted by the application.
alter table public.peers add column endpoint_url text;
alter table public.peers add column outbound_token text;

create policy peers_link on public.peers
  for update using (public.is_admin_of(jurisdiction_id));
grant update (endpoint_url, outbound_token) on table public.peers to app_runtime;

-- Which board on the remote instance receives a shared board's updates.
alter table public.sharing_agreements add column remote_board_id uuid;

alter table public.federation_outbox add column attempts integer not null default 0;
alter table public.federation_outbox add column next_attempt_at timestamptz not null default now();
alter table public.federation_outbox add column last_error text;

-- The worker acts for no person, so it reaches the queue only through these
-- functions. Each does one narrow thing; none returns tenant data beyond what
-- the delivery itself needs.

create function public.claim_deliveries(batch integer, lease_seconds integer)
  returns table (id uuid, kind text, target text, headers jsonb, body text, attempts integer)
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
  returning d.id, d.kind, d.target, d.headers, d.body, d.attempts
$$;

-- outcome: 'delivered', 'retry' (at retry_at), 'dead', or 'deferred' (at
-- retry_at without spending an attempt, used while a target's circuit is open).
create function public.settle_delivery(
  delivery_id uuid, outcome text, error text, retry_at timestamptz)
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
      last_error = coalesce(error, last_error)
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

create function public.claim_federation_batches(batch integer)
  returns table (peer_id uuid, endpoint_url text, outbound_token text,
                 remote_board_id uuid, ids uuid[], updates bytea[])
  language sql security definer
  set search_path to 'pg_catalog', 'public', 'pg_temp'
  as $$
  select p.id, p.endpoint_url, p.outbound_token, a.remote_board_id,
         array_agg(o.id order by o.created_at), array_agg(o.update_data order by o.created_at)
  from public.federation_outbox o
  join public.peers p on p.id = o.peer_id
  join public.sharing_agreements a on a.peer_id = o.peer_id and a.board_id = o.board_id
  where o.delivered_at is null and o.next_attempt_at <= now()
    and p.endpoint_url is not null and p.outbound_token is not null
    and a.remote_board_id is not null
  group by p.id, p.endpoint_url, p.outbound_token, a.remote_board_id
  limit batch
$$;

create function public.mark_federation_delivered(entry_ids uuid[])
  returns void
  language sql security definer
  set search_path to 'pg_catalog', 'public', 'pg_temp'
  as $$
  update public.federation_outbox set delivered_at = now()
  where id = any(entry_ids) and delivered_at is null
$$;

create function public.defer_federation(entry_ids uuid[], retry_at timestamptz, error text)
  returns void
  language sql security definer
  set search_path to 'pg_catalog', 'public', 'pg_temp'
  as $$
  update public.federation_outbox
  set attempts = attempts + 1, next_attempt_at = retry_at, last_error = error
  where id = any(entry_ids) and delivered_at is null
$$;

revoke all on function public.claim_deliveries(integer, integer) from public;
revoke all on function public.settle_delivery(uuid, text, text, timestamptz) from public;
revoke all on function public.claim_federation_batches(integer) from public;
revoke all on function public.mark_federation_delivered(uuid[]) from public;
revoke all on function public.defer_federation(uuid[], timestamptz, text) from public;
grant execute on function public.claim_deliveries(integer, integer) to app_runtime;
grant execute on function public.settle_delivery(uuid, text, text, timestamptz) to app_runtime;
grant execute on function public.claim_federation_batches(integer) to app_runtime;
grant execute on function public.mark_federation_delivered(uuid[]) to app_runtime;
grant execute on function public.defer_federation(uuid[], timestamptz, text) to app_runtime;
