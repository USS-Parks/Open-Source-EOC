-- A shared board's deletes travel to its peers beside its updates. An outbox
-- entry carries either an update or the id of a deleted record.
alter table public.federation_outbox alter column update_data drop not null;
alter table public.federation_outbox add column deleted_record uuid;
alter table public.federation_outbox add constraint federation_outbox_payload
  check ((update_data is null) <> (deleted_record is null));

-- Queue a record's deletion for every peer that may read its board, never
-- back to the peer the deletion came from.
create function public.queue_federation_delete(board uuid, record uuid, exclude_peer uuid)
  returns integer
  language sql security definer
  set search_path to 'pg_catalog', 'public', 'pg_temp'
  as $$
  with queued as (
    insert into public.federation_outbox (peer_id, board_id, deleted_record)
    select a.peer_id, a.board_id, record
    from public.sharing_agreements a
    where a.board_id = board and a.can_read and a.peer_id is distinct from exclude_peer
    returning 1)
  select count(*)::integer from queued
$$;
revoke all on function public.queue_federation_delete(uuid, uuid, uuid) from public;
grant execute on function public.queue_federation_delete(uuid, uuid, uuid) to app_runtime;

-- Queue an update for one peer: a new agreement's copy of the board's
-- records as they stand, which earlier updates never reached.
create function public.queue_federation_to(peer uuid, board uuid, payload bytea)
  returns integer
  language sql security definer
  set search_path to 'pg_catalog', 'public', 'pg_temp'
  as $$
  with queued as (
    insert into public.federation_outbox (peer_id, board_id, update_data)
    select a.peer_id, a.board_id, payload
    from public.sharing_agreements a
    where a.peer_id = peer and a.board_id = board and a.can_read
    returning 1)
  select count(*)::integer from queued
$$;
revoke all on function public.queue_federation_to(uuid, uuid, bytea) from public;
grant execute on function public.queue_federation_to(uuid, uuid, bytea) to app_runtime;

-- A batch carries its updates and its deletions, each in queue order.
drop function public.claim_federation_batches(integer);
create function public.claim_federation_batches(batch integer)
  returns table (peer_id uuid, endpoint_url text, outbound_token text,
                 remote_board_id uuid, ids uuid[], updates bytea[], deletes uuid[])
  language sql security definer
  set search_path to 'pg_catalog', 'public', 'pg_temp'
  as $$
  select p.id, p.endpoint_url, p.outbound_token, a.remote_board_id,
         array_agg(o.id order by o.created_at),
         coalesce(array_agg(o.update_data order by o.created_at) filter (where o.update_data is not null), '{}'),
         coalesce(array_agg(o.deleted_record order by o.created_at) filter (where o.deleted_record is not null), '{}')
  from public.federation_outbox o
  join public.peers p on p.id = o.peer_id
  join public.sharing_agreements a on a.peer_id = o.peer_id and a.board_id = o.board_id
  where o.delivered_at is null and o.next_attempt_at <= now()
    and p.endpoint_url is not null and p.outbound_token is not null
    and a.remote_board_id is not null
  group by p.id, p.endpoint_url, p.outbound_token, a.remote_board_id
  limit batch
$$;
revoke all on function public.claim_federation_batches(integer) from public;
grant execute on function public.claim_federation_batches(integer) to app_runtime;
