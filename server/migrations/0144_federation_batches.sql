-- Federation batches sized to what a receiver accepts. A peer and remote
-- board's batch was every undelivered entry in one POST, so a backlog after a
-- long partition, or a large board's first copy, grew past the receiver's
-- request limit and was refused on every attempt. A batch now stops at a byte
-- budget, counted as the JSON the push sends (each update base64-encoded, each
-- deletion a quoted id), and at 5,000 entries; its first entry always goes,
-- however large. What is left goes in the next batch.
--
-- Entries go strictly in queue order per peer and remote board: a batch is
-- claimed only when the oldest undelivered entry is due, so an entry queued
-- after a failed push waits behind the entries that failed instead of
-- overtaking them. Entries queued in one transaction keep the order they were
-- queued in.
alter table public.federation_outbox alter column created_at set default clock_timestamp();

drop function public.claim_federation_batches(integer);
create function public.claim_federation_batches(batch integer, max_bytes integer)
  returns table (peer_id uuid, endpoint_url text, outbound_token text,
                 remote_board_id uuid, ids uuid[], updates bytea[], deletes uuid[])
  language sql security definer
  set search_path to 'pg_catalog', 'public', 'pg_temp'
  as $$
  -- ponytail: sorts every undelivered entry of every linked peer on each
  -- claim; a backlog in the hundreds of thousands wants a queue position
  -- column and a keyset read instead.
  with queued as (
    select o.id, o.created_at, o.update_data, o.deleted_record,
           p.id as peer, p.endpoint_url, p.outbound_token, a.remote_board_id,
           row_number() over queue as n,
           sum(case when o.update_data is null then 39
                    else 4 * ((octet_length(o.update_data) + 2) / 3) + 3 end) over queue as wire,
           first_value(o.next_attempt_at) over queue as due_at
    from public.federation_outbox o
    join public.peers p on p.id = o.peer_id
    join public.sharing_agreements a on a.peer_id = o.peer_id and a.board_id = o.board_id
    where o.delivered_at is null
      and p.endpoint_url is not null and p.outbound_token is not null
      and a.remote_board_id is not null
    window queue as (partition by p.id, a.remote_board_id order by o.created_at, o.id
                     rows between unbounded preceding and current row))
  select peer, endpoint_url, outbound_token, remote_board_id,
         array_agg(id order by created_at, id),
         coalesce(array_agg(update_data order by created_at, id) filter (where update_data is not null), '{}'),
         coalesce(array_agg(deleted_record order by created_at, id) filter (where deleted_record is not null), '{}')
  from queued
  where due_at <= now() and (n = 1 or (wire <= max_bytes and n <= 5000))
  group by peer, endpoint_url, outbound_token, remote_board_id
  limit batch
$$;
revoke all on function public.claim_federation_batches(integer, integer) from public;
grant execute on function public.claim_federation_batches(integer, integer) to app_runtime;
