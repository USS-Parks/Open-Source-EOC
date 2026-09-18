-- Facility status networks (VEOC-28, F10). Standing facility registries,
-- always-on status reports, and event-driven status queries with response
-- tracking, all on EDXL-HAVE-shaped data.

create table facilities (
  id uuid primary key default gen_random_uuid(),
  jurisdiction_id uuid not null references jurisdictions (id),
  name text not null,
  kind text not null,
  contact text,
  geom geometry(Point, 4326),
  stale_after_seconds integer not null default 3600,
  created_by uuid not null references persons (id),
  created_at timestamptz not null default now()
);
create index facilities_jurisdiction on facilities (jurisdiction_id, kind);

create table facility_status_reports (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references facilities (id),
  jurisdiction_id uuid not null references jurisdictions (id),
  operating_status text not null,
  ems_traffic text,
  beds jsonb not null default '[]',
  capabilities jsonb not null default '[]',
  note text,
  reported_by uuid not null references persons (id),
  reported_at timestamptz not null default now()
);
create index facility_status_latest
  on facility_status_reports (facility_id, reported_at desc);

create table status_queries (
  id uuid primary key default gen_random_uuid(),
  jurisdiction_id uuid not null references jurisdictions (id),
  incident_id uuid references incidents (id),
  prompt text not null,
  target_kind text,
  due_at timestamptz,
  created_by uuid not null references persons (id),
  created_at timestamptz not null default now()
);

create table status_query_targets (
  query_id uuid not null references status_queries (id),
  facility_id uuid not null references facilities (id),
  responded_report uuid references facility_status_reports (id),
  responded_at timestamptz,
  primary key (query_id, facility_id)
);

grant select, insert on facilities to app_runtime;
grant select, insert on facility_status_reports to app_runtime;
grant select, insert on status_queries to app_runtime;
grant select, insert, update on status_query_targets to app_runtime;

alter table facilities enable row level security;
create policy facilities_read on facilities for select using (is_member_of(jurisdiction_id));
create policy facilities_write on facilities for insert with check (is_writer_of(jurisdiction_id));

alter table facility_status_reports enable row level security;
create policy fsr_read on facility_status_reports for select using (is_member_of(jurisdiction_id));
create policy fsr_write on facility_status_reports for insert with check (is_writer_of(jurisdiction_id));

alter table status_queries enable row level security;
create policy sq_read on status_queries for select using (is_member_of(jurisdiction_id));
create policy sq_write on status_queries for insert with check (is_writer_of(jurisdiction_id));

alter table status_query_targets enable row level security;
create policy sqt_read on status_query_targets for select
  using (exists (select 1 from status_queries q where q.id = query_id and is_member_of(q.jurisdiction_id)));
create policy sqt_write on status_query_targets for insert
  with check (exists (select 1 from status_queries q where q.id = query_id and is_writer_of(q.jurisdiction_id)));
create policy sqt_update on status_query_targets for update
  using (exists (select 1 from status_queries q where q.id = query_id and is_writer_of(q.jurisdiction_id)));
