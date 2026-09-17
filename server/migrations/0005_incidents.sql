-- Incident lifecycle, scenario templates, checklists, libraries (VEOC-12).

create table incident_templates (
  key text primary key,
  title text not null,
  definition jsonb not null,
  created_at timestamptz not null default now()
);
grant select, insert, update on incident_templates to app_runtime;
alter table incident_templates enable row level security;
create policy incident_templates_read on incident_templates for select
  using (current_person() is not null);
create policy incident_templates_write on incident_templates for insert
  with check (is_instance_admin());

create table incidents (
  id uuid primary key default gen_random_uuid(),
  jurisdiction_id uuid not null references jurisdictions (id),
  template_key text references incident_templates (key),
  name text not null,
  kind text not null check (kind in ('incident', 'daily_ops', 'planned_event')),
  collab_requested boolean not null default true, -- fulfilled by VEOC-32
  activated_at timestamptz not null default now(),
  activated_by uuid not null references persons (id),
  closed_at timestamptz,
  closed_by uuid references persons (id)
);

create table incident_positions (
  incident_id uuid not null references incidents (id),
  position_id uuid not null references positions (id),
  primary key (incident_id, position_id)
);

create table incident_boards (
  incident_id uuid not null references incidents (id),
  board_id uuid not null references boards (id),
  primary key (incident_id, board_id)
);

create table checklist_items (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references incidents (id),
  position_id uuid not null references positions (id),
  item text not null,
  sort_order integer not null default 0,
  completed_at timestamptz,
  completed_by uuid references persons (id),
  completed_by_position uuid references positions (id)
);
create index checklist_items_incident on checklist_items (incident_id, position_id);

create table libraries (
  id uuid primary key default gen_random_uuid(),
  jurisdiction_id uuid not null references jurisdictions (id),
  title text not null,
  kind text not null check (kind in ('scenario', 'plan', 'reference')),
  for_template text references incident_templates (key),
  body text not null default '',
  created_by uuid not null references persons (id),
  created_at timestamptz not null default now()
);

create table incident_libraries (
  incident_id uuid not null references incidents (id),
  library_id uuid not null references libraries (id),
  primary key (incident_id, library_id)
);

grant select, insert, update on incidents, incident_positions, incident_boards,
  checklist_items, libraries, incident_libraries to app_runtime;

alter table incidents enable row level security;
create policy incidents_read on incidents for select
  using (is_member_of(jurisdiction_id));
create policy incidents_write on incidents for insert
  with check (is_admin_of(jurisdiction_id));
create policy incidents_update on incidents for update
  using (is_admin_of(jurisdiction_id));

alter table incident_positions enable row level security;
create policy incident_positions_read on incident_positions for select
  using (exists (select 1 from incidents i where i.id = incident_id
                 and is_member_of(i.jurisdiction_id)));
create policy incident_positions_write on incident_positions for insert
  with check (exists (select 1 from incidents i where i.id = incident_id
                      and is_admin_of(i.jurisdiction_id)));

alter table incident_boards enable row level security;
create policy incident_boards_read on incident_boards for select
  using (exists (select 1 from incidents i where i.id = incident_id
                 and is_member_of(i.jurisdiction_id)));
create policy incident_boards_write on incident_boards for insert
  with check (exists (select 1 from incidents i where i.id = incident_id
                      and is_admin_of(i.jurisdiction_id)));

alter table checklist_items enable row level security;
create policy checklist_read on checklist_items for select
  using (exists (select 1 from incidents i where i.id = incident_id
                 and is_member_of(i.jurisdiction_id)));
create policy checklist_write on checklist_items for insert
  with check (exists (select 1 from incidents i where i.id = incident_id
                      and is_admin_of(i.jurisdiction_id)));
create policy checklist_complete on checklist_items for update
  using (exists (select 1 from incidents i where i.id = incident_id
                 and is_writer_of(i.jurisdiction_id)));

alter table libraries enable row level security;
create policy libraries_read on libraries for select
  using (is_member_of(jurisdiction_id));
create policy libraries_write on libraries for insert
  with check (is_admin_of(jurisdiction_id));

alter table incident_libraries enable row level security;
create policy incident_libraries_read on incident_libraries for select
  using (exists (select 1 from incidents i where i.id = incident_id
                 and is_member_of(i.jurisdiction_id)));
create policy incident_libraries_write on incident_libraries for insert
  with check (exists (select 1 from incidents i where i.id = incident_id
                      and is_admin_of(i.jurisdiction_id)));
