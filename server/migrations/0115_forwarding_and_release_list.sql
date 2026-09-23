-- Automatic federation forwarding, and the index behind the release list.
--
-- The sync hub queues each jurisdiction-wide update to a shared board for
-- every peer allowed to read that board, inside the transaction that records
-- the update. The editor may not satisfy the outbox insert policy (it needs
-- writer rights in the peer's jurisdiction), so the hub reaches the outbox
-- only through this function. exclude_peer is the peer the update arrived
-- from, if any, so an update is never sent back to its sender.

create function public.queue_federation(board uuid, payload bytea, exclude_peer uuid)
  returns integer
  language sql security definer
  set search_path to 'pg_catalog', 'public', 'pg_temp'
  as $$
  with queued as (
    insert into public.federation_outbox (peer_id, board_id, update_data)
    select a.peer_id, a.board_id, payload
    from public.sharing_agreements a
    where a.board_id = board and a.can_read and a.peer_id is distinct from exclude_peer
    returning 1)
  select count(*)::integer from queued
$$;

revoke all on function public.queue_federation(uuid, bytea, uuid) from public;
grant execute on function public.queue_federation(uuid, bytea, uuid) to app_runtime;

-- The JIC review queue lists a jurisdiction's releases newest first.
create index press_releases_jurisdiction on public.press_releases (jurisdiction_id, created_at desc);
