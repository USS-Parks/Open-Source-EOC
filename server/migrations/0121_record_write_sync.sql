-- A board record written over REST reaches the sync log.
--
-- The REST record routes write board_records directly. The server appends the
-- same change as a Yjs update to sync_updates, in the writing transaction, so
-- open documents, later replays and federation peers see it exactly as they
-- see a sync edit. The update goes under the record's own scope, or under the
-- board-wide scope when board_wide is set (the fields of an incident's record
-- that the incident's documents do not project). A record with no incident
-- queues for every peer that reads the board; a record of an incident never
-- does, as its sync edits never do.
--
-- The append goes through this function rather than the table's insert
-- policy, which a writer to a record of another jurisdiction's incident may
-- not satisfy. It is refused unless the caller made the record's latest
-- write, so it can only restate a change the caller just committed.

create function public.append_board_record_write(rid uuid, payload bytea, board_wide boolean)
  returns bigint
  language plpgsql volatile security definer
  set search_path to 'pg_catalog', 'public', 'pg_temp'
  as $$
declare
  bid uuid;
  iid uuid;
  scope uuid;
  seq_out bigint;
begin
  select r.board_id, r.incident_id into bid, iid
  from public.board_records r
  where r.id = rid and r.deleted_at is null
    and coalesce(r.updated_by, r.created_by) = public.current_person();
  if bid is null then
    raise exception 'record write is not permitted' using errcode = '42501';
  end if;
  scope := case when board_wide then null else iid end;
  insert into public.sync_updates
    (board_id, update_data, origin_person, incident_id, operation_id, request_digest, conflicts)
  values (bid, payload, public.current_person(), scope,
          case when scope is null then null else gen_random_uuid() end,
          case when scope is null then null else encode(sha256(payload), 'hex') end,
          case when scope is null then null else 0 end)
  returning seq into seq_out;
  if iid is null then
    perform public.queue_federation(bid, payload, null);
  end if;
  return seq_out;
end $$;

revoke all on function public.append_board_record_write(uuid, bytea, boolean) from public;
grant execute on function public.append_board_record_write(uuid, bytea, boolean) to app_runtime;
