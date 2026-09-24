-- Incident lifecycle: archival and an opt-in per-incident lockdown.
--
-- An archived incident is a closed incident set aside from the default
-- incident lists. Nothing is deleted: its rows stay readable under the same
-- policies as before, and closure already refuses incident-scoped writes.
--
-- A locked incident withholds its boards from guest grants. Lockdown is off
-- by default, never automatic, and only an administrator of the owning
-- jurisdiction applies or lifts it. Every guest read of incident-scoped data
-- passes through has_guest_scope with a board scope (boards, board records,
-- record workflows and record permission rules), so the helper refuses a
-- board scope while any incident the board is attached to is locked. Members
-- read through is_member_of and participating organizations through their
-- incident participation; neither path consults has_guest_scope, so neither
-- changes.

alter table public.incidents
  add column archived_at timestamptz,
  add column archived_by uuid references public.persons(id),
  add column locked_at timestamptz,
  add column locked_by uuid references public.persons(id),
  add constraint incidents_archived_when_closed
    check (archived_at is null or closed_at is not null),
  add constraint incidents_archive_attributed
    check ((archived_at is null) = (archived_by is null)),
  add constraint incidents_lock_attributed
    check ((locked_at is null) = (locked_by is null));

-- The master view pages a jurisdiction's incidents newest first.
create index incidents_jurisdiction_page
  on public.incidents (jurisdiction_id, activated_at desc, id desc);

-- Locked incidents are few; the guest scope check reads only these.
create index incidents_locked on public.incidents (id) where locked_at is not null;

create or replace function public.has_guest_scope(jid uuid, wanted text) returns boolean
  language sql stable security definer
  set search_path to 'pg_catalog', 'public', 'pg_temp'
  as $$
  select exists (
    select 1 from public.guest_grants
    where person_id = public.current_person() and jurisdiction_id = jid
      and revoked_at is null and expires_at > now()
      and wanted = any (scopes))
  and not exists (
    select 1 from public.incidents i
    join public.incident_boards ib on ib.incident_id = i.id
    where i.locked_at is not null
      and wanted = 'board:' || ib.board_id::text || ':read')
$$;
