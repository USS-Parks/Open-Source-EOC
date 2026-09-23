-- Saved reports over boards, and the runs of scheduled ones.
--
-- A report is a saved definition over one board: the columns to show, the
-- view conditions that select records, up to two grouping fields, totals and
-- sort keys, optionally narrowed to one incident. It holds no board data.
-- Every run reads the board as the person running it, so record rules and
-- field visibility apply to that person. Members read and run reports,
-- writers create them, and the owner, while still a writer, or an admin
-- changes or deletes one.
--
-- A report may carry a schedule. The scheduler finds due reports through
-- reports_due and runs each as its owner, who must still be a writer of the
-- jurisdiction. Each scheduled run is recorded in report_runs.

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  jurisdiction_id uuid not null references public.jurisdictions(id),
  board_id uuid not null references public.boards(id),
  incident_id uuid references public.incidents(id),
  name text not null check (length(name) between 1 and 200),
  definition jsonb not null,
  schedule jsonb,
  next_run_at timestamptz,
  created_by uuid not null references public.persons(id),
  created_at timestamptz not null default now(),
  updated_by uuid not null references public.persons(id),
  updated_at timestamptz not null default now(),
  check ((schedule is null) = (next_run_at is null))
);

create index reports_page on public.reports (jurisdiction_id, created_at desc, id desc);
create index reports_next_run on public.reports (next_run_at) where next_run_at is not null;

create table public.report_runs (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.reports(id) on delete cascade,
  jurisdiction_id uuid not null references public.jurisdictions(id),
  run_by uuid not null references public.persons(id),
  ran_at timestamptz not null default now(),
  row_count integer check (row_count >= 0),
  outcome text not null check (outcome in ('delivered', 'partial', 'failed')),
  detail jsonb not null default '{}'::jsonb
);

create index report_runs_recent on public.report_runs (report_id, ran_at desc, id desc);

alter table public.reports enable row level security;
alter table public.report_runs enable row level security;

create policy reports_read on public.reports
  for select using (public.is_member_of(jurisdiction_id));
create policy reports_insert on public.reports
  for insert with check (public.is_writer_of(jurisdiction_id) and created_by = public.current_person());
create policy reports_update on public.reports
  for update using ((created_by = public.current_person() and public.is_writer_of(jurisdiction_id))
                    or public.is_admin_of(jurisdiction_id))
  with check ((created_by = public.current_person() and public.is_writer_of(jurisdiction_id))
              or public.is_admin_of(jurisdiction_id));
create policy reports_delete on public.reports
  for delete using ((created_by = public.current_person() and public.is_writer_of(jurisdiction_id))
                    or public.is_admin_of(jurisdiction_id));

-- A run is written by the scheduled job acting as the report's owner.
create policy report_runs_read on public.report_runs
  for select using (public.is_member_of(jurisdiction_id));
create policy report_runs_insert on public.report_runs
  for insert with check (run_by = public.current_person() and exists (
    select 1 from public.reports r
    where r.id = report_runs.report_id and r.jurisdiction_id = report_runs.jurisdiction_id
      and r.created_by = public.current_person()));

grant select, insert, update, delete on table public.reports to app_runtime;
grant select, insert on table public.report_runs to app_runtime;

-- Work discovery for the scheduler, which acts for no person: each due
-- report and its owner, when the owner is enabled and still a writer of the
-- report's jurisdiction. The run itself happens as that owner under
-- row-level security.
create function public.reports_due(due_at timestamptz)
  returns table (report_id uuid, person_id uuid)
  language sql stable security definer
  set search_path to 'pg_catalog', 'public', 'pg_temp'
  as $$
  select r.id, r.created_by
  from public.reports r
  join public.persons p on p.id = r.created_by and not p.disabled
  join public.jurisdiction_memberships m
    on m.person_id = r.created_by and m.jurisdiction_id = r.jurisdiction_id
   and m.role in ('admin', 'member')
  where r.next_run_at <= reports_due.due_at
  order by r.next_run_at, r.id
$$;

revoke all on function public.reports_due(timestamptz) from public;
grant execute on function public.reports_due(timestamptz) to app_runtime;

-- The jurisdiction's email channel for a scheduled report, read by the run
-- acting as the report's owner, who need not be an admin. The secret stays
-- encrypted; the application decrypts it at send time.
create function public.report_email_channel(report uuid)
  returns jsonb
  language sql stable security definer
  set search_path to 'pg_catalog', 'public', 'pg_temp'
  as $$
  select jsonb_build_object('settings', c.settings, 'secret', c.secret_envelope)
  from public.reports r
  join public.notification_channels c on c.jurisdiction_id = r.jurisdiction_id and c.kind = 'email'
  where r.id = report_email_channel.report and r.schedule is not null
    and r.created_by = public.current_person()
$$;

revoke all on function public.report_email_channel(uuid) from public;
grant execute on function public.report_email_channel(uuid) to app_runtime;
