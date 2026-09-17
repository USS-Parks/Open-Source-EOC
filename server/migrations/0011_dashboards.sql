-- Dashboards (VEOC-18): definitions as versioned templates, instances per
-- jurisdiction, mirroring the board template model.

create table dashboard_templates (
  key text not null,
  version integer not null,
  title text not null,
  definition jsonb not null,
  created_at timestamptz not null default now(),
  primary key (key, version)
);

create table dashboards (
  id uuid primary key default gen_random_uuid(),
  jurisdiction_id uuid not null references jurisdictions (id),
  template_key text not null,
  template_version integer not null,
  title text not null,
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  foreign key (template_key, template_version)
    references dashboard_templates (key, version)
);

grant select, insert, update on dashboard_templates, dashboards to app_runtime;

alter table dashboard_templates enable row level security;
create policy dashboard_templates_read on dashboard_templates for select
  using (current_person() is not null);
create policy dashboard_templates_write on dashboard_templates for insert
  with check (is_instance_admin());

alter table dashboards enable row level security;
create policy dashboards_read on dashboards for select
  using (is_member_of(jurisdiction_id));
create policy dashboards_write on dashboards for insert
  with check (is_admin_of(jurisdiction_id));
create policy dashboards_update on dashboards for update
  using (is_admin_of(jurisdiction_id));
