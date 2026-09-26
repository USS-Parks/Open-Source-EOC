-- The incident room (VC-12): dashboards and file folders an incident opens
-- with, made at activation from its template.
--
-- incident_dashboards links an incident to the dashboards made for it, as
-- incident_boards links its boards. Listed for an incident, a jurisdiction's
-- dashboards show the incident's own first and leave out other incidents'.
--
-- file_folders are an incident's named folders. A file filed in one is
-- attached to that folder's incident and stays in its jurisdiction; the
-- composite keys below hold both in the database.

create table public.incident_dashboards (
  incident_id uuid not null references public.incidents (id),
  dashboard_id uuid not null references public.dashboards (id),
  primary key (incident_id, dashboard_id)
);
create index incident_dashboards_dashboard on public.incident_dashboards (dashboard_id);

create table public.file_folders (
  id uuid primary key default gen_random_uuid(),
  jurisdiction_id uuid not null references public.jurisdictions (id),
  incident_id uuid not null references public.incidents (id),
  name text not null check (length(name) between 1 and 120),
  sort_order integer not null default 0,
  created_by uuid not null references public.persons (id),
  created_at timestamptz not null default now(),
  unique (incident_id, name),
  unique (id, jurisdiction_id),
  unique (id, incident_id)
);

alter table public.files
  add column folder_id uuid,
  add constraint files_folder_jurisdiction foreign key (folder_id, jurisdiction_id)
    references public.file_folders (id, jurisdiction_id),
  add constraint files_folder_incident foreign key (folder_id, attached_id)
    references public.file_folders (id, incident_id),
  add constraint files_folder_attached check (folder_id is null or (attached_kind = 'incident' and attached_id is not null));
create index files_folder_page on public.files (folder_id, created_at desc, id desc) where folder_id is not null;

alter table public.incident_dashboards enable row level security;
alter table public.file_folders enable row level security;

create policy incident_dashboards_read on public.incident_dashboards for select
  using (public.can_read_incident(incident_id));
create policy incident_dashboards_write on public.incident_dashboards for insert
  with check (exists (
    select 1 from public.incidents i
    where i.id = incident_dashboards.incident_id and public.is_admin_of(i.jurisdiction_id)));

-- Folders are read as files are, by the jurisdiction's members.
create policy file_folders_read on public.file_folders for select
  using (public.is_member_of(jurisdiction_id));
create policy file_folders_write on public.file_folders for insert
  with check (public.is_admin_of(jurisdiction_id) and exists (
    select 1 from public.incidents i
    where i.id = file_folders.incident_id and i.jurisdiction_id = file_folders.jurisdiction_id));

grant select, insert on table public.incident_dashboards to app_runtime;
grant select, insert on table public.file_folders to app_runtime;
