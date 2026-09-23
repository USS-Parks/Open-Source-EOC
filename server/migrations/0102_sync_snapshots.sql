-- Compaction cache for the append-only board sync log.
--
-- sync_updates carries a BEFORE DELETE OR UPDATE trigger and is an append-only
-- surface: it is never rewritten, trimmed or nulled out. Hydrating a board by
-- replaying every row since the beginning is what made open() cost grow with
-- the life of the board. This table stores one merged Yjs state per sync scope
-- so hydration starts from that state and replays only the rows after it.
--
-- It is a derived cache, not a record: every row can be dropped and rebuilt
-- from sync_updates alone. That is why it is the one sync table that may be
-- updated in place.

create table public.sync_snapshots (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards(id) on delete cascade,
  incident_id uuid references public.incidents(id) on delete cascade,
  through_seq bigint not null,
  state bytea not null,
  updated_at timestamptz not null default now()
);

-- One snapshot per scope. The legacy board-wide doc and each incident-scoped
-- doc are separate scopes, so the nil uuid stands in for "no incident".
create unique index sync_snapshots_scope on public.sync_snapshots
  (board_id, coalesce(incident_id, '00000000-0000-0000-0000-000000000000'::uuid));

alter table public.sync_snapshots enable row level security;

-- Readable by exactly who may read the log it summarizes.
create policy sync_snapshots_read on public.sync_snapshots
  for select using (
    ((incident_id is null) and exists (
      select 1 from public.boards b
      where b.id = sync_snapshots.board_id and public.is_member_of(b.jurisdiction_id)))
    or ((incident_id is not null) and public.can_read_incident(incident_id) and exists (
      select 1 from public.incident_boards ib
      where ib.board_id = sync_snapshots.board_id
        and ib.incident_id = sync_snapshots.incident_id))
  );

-- Writable on the same terms. A snapshot only ever restates updates the writer
-- could already read, so authority to read the scope is authority to cache it.
create policy sync_snapshots_write on public.sync_snapshots
  for insert with check (
    ((incident_id is null) and exists (
      select 1 from public.boards b
      where b.id = sync_snapshots.board_id and public.is_member_of(b.jurisdiction_id)))
    or ((incident_id is not null) and public.can_read_incident(incident_id) and exists (
      select 1 from public.incident_boards ib
      where ib.board_id = sync_snapshots.board_id
        and ib.incident_id = sync_snapshots.incident_id))
  );

create policy sync_snapshots_refresh on public.sync_snapshots
  for update using (
    ((incident_id is null) and exists (
      select 1 from public.boards b
      where b.id = sync_snapshots.board_id and public.is_member_of(b.jurisdiction_id)))
    or ((incident_id is not null) and public.can_read_incident(incident_id) and exists (
      select 1 from public.incident_boards ib
      where ib.board_id = sync_snapshots.board_id
        and ib.incident_id = sync_snapshots.incident_id))
  );

grant select, insert, update on table public.sync_snapshots to app_runtime;
