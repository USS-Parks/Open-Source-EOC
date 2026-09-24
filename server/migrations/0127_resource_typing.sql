-- NIMS resource typing, a resource pool and demobilization.
--
-- The seed catalog of resource kinds is code, in the shared dictionary. A
-- jurisdiction adds its own kinds and imports definitions from a FEMA
-- Resource Typing Library Tool (RTLT) export; those rows live here, and an
-- import replaces the previous one. Requests and pool resources name a kind
-- by key and a type level by number. The application checks both against the
-- seed and the jurisdiction's rows on every write, so there is no foreign key;
-- a kind dropped by a later import stays named on the rows that used it.
--
-- A pool resource is available, assigned to one request, out of service, or
-- demobilized, which is terminal and records the return condition and the
-- demobilization checks made. Each move is written to the audit log.

create table public.resource_kinds (
  id uuid primary key default gen_random_uuid(),
  jurisdiction_id uuid not null references public.jurisdictions(id),
  key text not null check (key ~ '^(local|rtlt):.{1,120}$'),
  name text not null check (length(name) between 1 and 200),
  discipline text not null default '' check (length(discipline) <= 200),
  levels jsonb not null default '[]',
  notes text not null default '' check (length(notes) <= 4000),
  source text not null check (source in ('local', 'rtlt')),
  rtlt_id text,
  source_note text not null default '' check (length(source_note) <= 500),
  created_by uuid not null references public.persons(id),
  created_at timestamptz not null default now(),
  unique (jurisdiction_id, key),
  check ((source = 'rtlt') = (rtlt_id is not null))
);

alter table public.resource_requests
  add column resource_kind text,
  add column resource_type smallint check (resource_type between 1 and 10),
  add constraint resource_requests_type_needs_kind check (resource_type is null or resource_kind is not null);

create table public.resources (
  id uuid primary key default gen_random_uuid(),
  jurisdiction_id uuid not null references public.jurisdictions(id),
  name text not null check (length(name) between 1 and 200),
  resource_kind text not null,
  resource_type smallint check (resource_type between 1 and 10),
  status text not null default 'available'
    check (status in ('available', 'assigned', 'out_of_service', 'demobilized')),
  request_id uuid references public.resource_requests(id),
  return_condition text check (return_condition in ('ready', 'needs_service', 'damaged', 'lost')),
  demobilization_checks text[] not null default '{}',
  demobilized_at timestamptz,
  created_by uuid not null references public.persons(id),
  created_at timestamptz not null default now(),
  updated_by uuid not null references public.persons(id),
  updated_at timestamptz not null default now(),
  check ((status = 'assigned') = (request_id is not null)),
  check ((status = 'demobilized') = (return_condition is not null and demobilized_at is not null))
);

create index resources_pool on public.resources (jurisdiction_id, name, id);
create index resources_request on public.resources (request_id) where request_id is not null;

alter table public.resource_kinds enable row level security;
alter table public.resources enable row level security;

create policy resource_kinds_read on public.resource_kinds
  for select using (public.is_member_of(jurisdiction_id));
create policy resource_kinds_insert on public.resource_kinds
  for insert with check (public.is_admin_of(jurisdiction_id));
create policy resource_kinds_delete on public.resource_kinds
  for delete using (public.is_admin_of(jurisdiction_id));

create policy resources_read on public.resources
  for select using (public.is_member_of(jurisdiction_id));
create policy resources_insert on public.resources
  for insert with check (public.is_writer_of(jurisdiction_id));
create policy resources_update on public.resources
  for update using (public.is_writer_of(jurisdiction_id))
  with check (public.is_writer_of(jurisdiction_id));

grant select, insert, delete on table public.resource_kinds to app_runtime;
grant select, insert, update on table public.resources to app_runtime;
