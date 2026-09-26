-- Validated migration (VC-13): a report for every import that writes.
--
-- An import keeps what it read and what it did with each row or part:
-- created, updated, skipped or refused, a refusal with its reason, and the
-- mapping of file columns to fields it used. The report belongs to the
-- jurisdiction the import wrote into and names who ran it and when. A
-- jurisdiction administrator signs it off on screen once, and the sign-off
-- names who and when. Nothing else about a report changes, nothing purges
-- one, and a dry run writes none.

create table public.import_reports (
  id uuid primary key default gen_random_uuid(),
  jurisdiction_id uuid not null references public.jurisdictions(id),
  kind text not null check (kind in ('webeoc', 'board_records', 'solution_package', 'form', 'parcel_baseline', 'people')),
  subject text not null check (length(subject) between 1 and 300),
  source_name text check (source_name is null or length(source_name) between 1 and 255),
  read_count integer not null check (read_count >= 0),
  created_count integer not null check (created_count >= 0),
  updated_count integer not null check (updated_count >= 0),
  skipped_count integer not null check (skipped_count >= 0),
  refused_count integer not null check (refused_count >= 0),
  mapping jsonb not null default '[]',
  row_outcomes jsonb not null default '[]',
  run_by uuid not null references public.persons(id),
  run_at timestamptz not null default now(),
  signed_off_by uuid references public.persons(id),
  signed_off_at timestamptz,
  sign_off_note text check (sign_off_note is null or length(sign_off_note) between 1 and 2000),
  check ((signed_off_by is null) = (signed_off_at is null)),
  check (sign_off_note is null or signed_off_by is not null)
);
create index import_reports_page on public.import_reports (jurisdiction_id, run_at desc, id desc);

alter table public.import_reports enable row level security;

-- Administrators read their jurisdiction's reports; whoever ran an import
-- reads its report back.
create policy import_reports_read on public.import_reports for select
  using (public.is_admin_of(jurisdiction_id) or run_by = public.current_person());
create policy import_reports_insert on public.import_reports for insert
  with check (public.is_writer_of(jurisdiction_id) and run_by = public.current_person() and signed_off_by is null);
-- A sign-off is the only update: once, by an administrator, in their own name.
create policy import_reports_sign_off on public.import_reports for update
  using (public.is_admin_of(jurisdiction_id) and signed_off_by is null)
  with check (public.is_admin_of(jurisdiction_id) and signed_off_by = public.current_person());

-- The schema's default privileges grant update on every column; only the
-- sign-off columns keep it.
revoke update on table public.import_reports from app_runtime;
grant select, insert on table public.import_reports to app_runtime;
grant update (signed_off_by, signed_off_at, sign_off_note) on table public.import_reports to app_runtime;

-- The parcel baseline import replaces a parcel already in the baseline, but
-- the table had no update policy, so a second import of any parcel failed
-- under row-level security. Its administrators may now update it.
create policy baselines_update on public.damage_baselines for update
  using (public.is_admin_of(jurisdiction_id))
  with check (public.is_admin_of(jurisdiction_id));
