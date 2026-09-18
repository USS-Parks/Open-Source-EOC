-- After-action review and improvement planning (VEOC-36). Observations are
-- captured during the incident, not reconstructed after. The AAR composes
-- from those observations plus the exported chronology as evidence. Corrective
-- actions are jurisdiction-scoped and outlive the incident: they persist into
-- daily-ops mode and keep reporting status until closed.

create table aar_observations (
  id uuid primary key default gen_random_uuid(),
  jurisdiction_id uuid not null references jurisdictions (id),
  incident_id uuid not null references incidents (id),
  capability text not null,
  kind text not null check (kind in ('strength', 'improvement')),
  observation text not null,
  recommendation text,
  created_by uuid not null references persons (id),
  created_at timestamptz not null default now()
);
create index aar_observations_incident on aar_observations (incident_id);

create table corrective_actions (
  id uuid primary key default gen_random_uuid(),
  jurisdiction_id uuid not null references jurisdictions (id),
  incident_id uuid references incidents (id),
  capability text not null,
  recommendation text not null,
  owner_position uuid references positions (id),
  owner_person uuid references persons (id),
  due_date date,
  status text not null default 'open' check (status in ('open', 'in_progress', 'complete')),
  created_by uuid not null references persons (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);
create index corrective_actions_jurisdiction on corrective_actions (jurisdiction_id, status);

create table aars (
  id uuid primary key default gen_random_uuid(),
  jurisdiction_id uuid not null references jurisdictions (id),
  incident_id uuid not null references incidents (id),
  title text not null,
  content jsonb not null,
  created_by uuid not null references persons (id),
  created_at timestamptz not null default now()
);
create index aars_incident on aars (incident_id, created_at desc);

grant select, insert on aar_observations to app_runtime;
grant select, insert, update on corrective_actions to app_runtime;
grant select, insert on aars to app_runtime;

alter table aar_observations enable row level security;
create policy aar_obs_read on aar_observations for select using (is_member_of(jurisdiction_id));
create policy aar_obs_write on aar_observations for insert with check (is_member_of(jurisdiction_id));

alter table corrective_actions enable row level security;
create policy ca_read on corrective_actions for select using (is_member_of(jurisdiction_id));
create policy ca_write on corrective_actions for insert with check (is_member_of(jurisdiction_id));
create policy ca_update on corrective_actions for update using (is_member_of(jurisdiction_id));

alter table aars enable row level security;
create policy aars_read on aars for select using (is_member_of(jurisdiction_id));
create policy aars_write on aars for insert with check (is_member_of(jurisdiction_id));
