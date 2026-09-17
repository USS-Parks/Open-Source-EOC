-- Smart forms (VEOC-22, F7). Imported XLSForm definitions are versioned
-- data, per jurisdiction, mirroring boards and dashboards. Submissions
-- do not live here: they are written to boards through the schema engine,
-- so a captured form becomes an ordinary, queryable, audited board record.

create table form_definitions (
  id uuid primary key default gen_random_uuid(),
  jurisdiction_id uuid not null references jurisdictions (id),
  key text not null,
  version integer not null,
  title text not null,
  board_template text,
  definition jsonb not null,
  created_by uuid not null references persons (id),
  created_at timestamptz not null default now(),
  unique (jurisdiction_id, key, version)
);
create index form_definitions_jurisdiction on form_definitions (jurisdiction_id, key);

grant select, insert on form_definitions to app_runtime;

alter table form_definitions enable row level security;
create policy forms_read on form_definitions for select
  using (is_member_of(jurisdiction_id));
create policy forms_write on form_definitions for insert
  with check (is_admin_of(jurisdiction_id));
