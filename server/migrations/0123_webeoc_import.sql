-- WebEOC board migration, records only.
--
-- A board keeps one saved WebEOC mapping: the CSV column that fills each board
-- field, and the time zone the WebEOC server wrote its dates in. Each imported
-- row whose export carried a WebEOC dataid is remembered with the record it
-- created, so a second import of the same export skips the row instead of
-- duplicating the record. Both tables belong to the board's jurisdiction and
-- only its writers read or write them. Nothing purges them.

create table public.webeoc_mappings (
  board_id uuid primary key references public.boards(id),
  jurisdiction_id uuid not null references public.jurisdictions(id),
  mapping jsonb not null,
  time_zone text,
  updated_by uuid not null references public.persons(id),
  updated_at timestamptz not null default now()
);

create table public.webeoc_imported_rows (
  board_id uuid not null references public.boards(id),
  dataid text not null,
  jurisdiction_id uuid not null references public.jurisdictions(id),
  record_id uuid not null,
  imported_by uuid not null references public.persons(id),
  imported_at timestamptz not null default now(),
  primary key (board_id, dataid)
);

alter table public.webeoc_mappings enable row level security;
alter table public.webeoc_imported_rows enable row level security;

create policy webeoc_mappings_read on public.webeoc_mappings
  for select using (public.is_writer_of(jurisdiction_id));
create policy webeoc_mappings_insert on public.webeoc_mappings
  for insert with check (public.is_writer_of(jurisdiction_id) and exists (
    select 1 from public.boards b where b.id = board_id and b.jurisdiction_id = webeoc_mappings.jurisdiction_id));
create policy webeoc_mappings_update on public.webeoc_mappings
  for update using (public.is_writer_of(jurisdiction_id))
  with check (public.is_writer_of(jurisdiction_id) and exists (
    select 1 from public.boards b where b.id = board_id and b.jurisdiction_id = webeoc_mappings.jurisdiction_id));

create policy webeoc_imported_rows_read on public.webeoc_imported_rows
  for select using (public.is_writer_of(jurisdiction_id));
create policy webeoc_imported_rows_insert on public.webeoc_imported_rows
  for insert with check (public.is_writer_of(jurisdiction_id) and imported_by = public.current_person() and exists (
    select 1 from public.boards b where b.id = board_id and b.jurisdiction_id = webeoc_imported_rows.jurisdiction_id));

grant select, insert, update on table public.webeoc_mappings to app_runtime;
grant select, insert on table public.webeoc_imported_rows to app_runtime;
