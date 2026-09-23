-- Board records gain archive, delete and record-level access.
--
-- Archive is reversible and only hides a record from default views. Delete is
-- a tombstone: the row stays, so the audit trail, workflow history and every
-- foreign key remain whole, but no read path returns it again. The prior data
-- is also carried in the board.record.deleted audit payload.
--
-- A template may declare `recordAccess`, grants for reading and editing
-- individual records. The rule is enforced here, in two restrictive policies,
-- so every query that reads board_records under a person (views, detail,
-- references, exports, dashboards, map layers, sync rows) sees the same
-- answer without code of its own. A restrictive policy on audit_events keeps
-- a restricted record's audit entries, which carry its values, from callers
-- the rule excludes.

alter table public.board_records
  add column archived_at timestamptz,
  add column archived_by uuid references public.persons(id),
  add column deleted_at timestamptz,
  add column deleted_by uuid references public.persons(id);

-- The rule is read once per row by the policies below; a stored column keeps
-- that read off the full template document.
alter table public.board_templates
  add column record_access jsonb
  generated always as (nullif(definition -> 'recordAccess', 'null'::jsonb)) stored;

create function public.board_record_permitted(
  bid uuid, iid uuid, creator uuid, creator_position uuid, rid uuid, action text)
  returns boolean
  language plpgsql stable security definer
  set search_path to 'pg_catalog', 'public', 'pg_temp'
  as $$
declare
  jid uuid;
  access jsonb;
  item jsonb;
  me uuid := public.current_person();
begin
  select b.jurisdiction_id, t.record_access into jid, access
  from public.boards b
  join public.board_templates t on t.key = b.template_key and t.version = b.template_version
  where b.id = bid;
  if access is null then return true; end if;
  if me is null then return false; end if;
  if public.is_admin_of(jid) then return true; end if;
  for item in select value from jsonb_array_elements(access -> action) loop
    case item ->> 'kind'
      when 'creator' then
        if creator = me then return true; end if;
      when 'creator_position' then
        if creator_position is not null and exists (
          select 1 from public.position_assignments pa
          where pa.position_id = creator_position and pa.person_id = me and pa.revoked_at is null
        ) then return true; end if;
      when 'assigned_position' then
        if exists (
          select 1 from public.board_workflow_instances w
          join public.position_assignments pa on pa.position_id = w.assignment_position_id
          where w.record_id = rid and pa.person_id = me and pa.revoked_at is null
        ) then return true; end if;
      when 'role' then
        if (item -> 'roles') ? 'member' and (
          exists (select 1 from public.jurisdiction_memberships m
                  where m.person_id = me and m.jurisdiction_id = jid and m.role = 'member')
          or (iid is not null and public.has_incident_participation(iid))
        ) then return true; end if;
        if (item -> 'roles') ? 'viewer' and exists (
          select 1 from public.jurisdiction_memberships m
          where m.person_id = me and m.jurisdiction_id = jid and m.role = 'viewer'
        ) then return true; end if;
        if (item -> 'roles') ? 'guest'
          and public.has_guest_scope(jid, 'board:' || bid::text || ':read') then return true; end if;
      else
        null;
    end case;
  end loop;
  return false;
end $$;

revoke all on function public.board_record_permitted(uuid, uuid, uuid, uuid, uuid, text) from public;
grant execute on function public.board_record_permitted(uuid, uuid, uuid, uuid, uuid, text) to app_runtime;

create policy records_scope on public.board_records as restrictive for select
  using (deleted_at is null
    and public.board_record_permitted(board_id, incident_id, created_by, created_by_position, id, 'read'));

create policy records_edit_scope on public.board_records as restrictive for update
  using (deleted_at is null
    and public.board_record_permitted(board_id, incident_id, created_by, created_by_position, id, 'edit'))
  with check (true);

-- Whether the caller may see audit entries about one record: the record's
-- read rule, evaluated on the row whether or not it has been deleted.
create function public.board_record_audit_visible(rid uuid) returns boolean
  language sql stable security definer
  set search_path to 'pg_catalog', 'public', 'pg_temp'
  as $$
  select coalesce((
    select public.board_record_permitted(r.board_id, r.incident_id, r.created_by,
                                         r.created_by_position, r.id, 'read')
    from public.board_records r where r.id = rid), true)
$$;

revoke all on function public.board_record_audit_visible(uuid) from public;
grant execute on function public.board_record_audit_visible(uuid) to app_runtime;

create policy audit_board_record_scope on public.audit_events as restrictive for select
  using (subject_table is distinct from 'board_records' or public.board_record_audit_visible(subject_id));

-- A file attached to a record follows that record's read rule, so its name,
-- text and bytes never reach a caller the rule excludes.
create policy files_record_scope on public.files as restrictive for select
  using (attached_kind is distinct from 'record' or attached_id is null
         or public.board_record_audit_visible(attached_id));

-- A tombstone makes the row unreadable, and an update through the policies
-- above must leave its row readable, so delete goes through this narrow
-- function. Only a jurisdiction admin of the record's board may call it.
create function public.tombstone_board_record(rid uuid) returns boolean
  language sql volatile security definer
  set search_path to 'pg_catalog', 'public', 'pg_temp'
  as $$
  update public.board_records r
  set deleted_at = now(), deleted_by = public.current_person()
  where r.id = rid and r.deleted_at is null
    and public.is_admin_of((select b.jurisdiction_id from public.boards b where b.id = r.board_id))
  returning true
$$;

revoke all on function public.tombstone_board_record(uuid) from public;
grant execute on function public.tombstone_board_record(uuid) to app_runtime;

-- Whether an id is a deleted record of a board the caller can read, so a sync
-- write to it becomes a conflict rather than a failed insert.
create function public.board_record_tombstoned(rid uuid, bid uuid) returns boolean
  language sql stable security definer
  set search_path to 'pg_catalog', 'public', 'pg_temp'
  as $$
  select exists (
    select 1 from public.board_records r join public.boards b on b.id = r.board_id
    where r.id = rid and r.board_id = bid and r.deleted_at is not null
      and (public.is_member_of(b.jurisdiction_id)
           or (r.incident_id is not null and public.can_read_incident(r.incident_id))))
$$;

revoke all on function public.board_record_tombstoned(uuid, uuid) from public;
grant execute on function public.board_record_tombstoned(uuid, uuid) to app_runtime;

-- Append the Yjs update that removes a deleted record from its sync
-- documents. It is written under the record's own scope so both the incident
-- and the board-wide replay apply it, and it is refused unless the record is
-- already a tombstone the calling admin could have made.
create function public.append_board_record_removal(rid uuid, removal bytea) returns bigint
  language plpgsql volatile security definer
  set search_path to 'pg_catalog', 'public', 'pg_temp'
  as $$
declare
  bid uuid;
  iid uuid;
  seq_out bigint;
begin
  select r.board_id, r.incident_id into bid, iid
  from public.board_records r join public.boards b on b.id = r.board_id
  where r.id = rid and r.deleted_at is not null and public.is_admin_of(b.jurisdiction_id);
  if bid is null then
    raise exception 'record removal is not permitted' using errcode = '42501';
  end if;
  insert into public.sync_updates
    (board_id, update_data, origin_person, incident_id, operation_id, request_digest, conflicts)
  values (bid, removal, public.current_person(), iid,
          case when iid is null then null else gen_random_uuid() end,
          case when iid is null then null else encode(sha256(removal), 'hex') end,
          case when iid is null then null else 0 end)
  returning seq into seq_out;
  return seq_out;
end $$;

revoke all on function public.append_board_record_removal(uuid, bytea) from public;
grant execute on function public.append_board_record_removal(uuid, bytea) to app_runtime;
