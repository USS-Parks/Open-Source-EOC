-- Personal, incident-scoped saved workspace state. The payload remains opaque
-- to this engine, but its namespace, schema version, size and revision are
-- bounded so later workspace, table, dashboard and board surfaces share one
-- mechanism without creating an unbounded document store.

create table saved_states (
  person_id uuid not null references persons (id) on delete cascade,
  incident_id uuid not null references incidents (id) on delete cascade,
  kind text not null check (kind in (
    'workspace_preferences', 'workspace_layout', 'table_view', 'dashboard_config'
  )),
  state_key text not null check (
    length(state_key) between 1 and 128 and
    state_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
  ),
  schema_version integer not null check (schema_version between 1 and 2147483647),
  revision integer not null default 1 check (revision between 1 and 2147483647),
  -- The payload is opaque and unindexed. json preserves the compact API
  -- serialization, so the database enforces the same exact UTF-8 byte bound.
  payload json not null check (
    json_typeof(payload) = 'object' and octet_length(payload::text) <= 65536
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (person_id, incident_id, kind, state_key)
);

grant select, insert, update, delete on saved_states to app_runtime;

-- A readable incident is enough to persist personal presentation state. Every
-- operation is additionally restricted to current_person, so even an incident
-- administrator cannot inspect or overwrite another operator's preferences.
alter table saved_states enable row level security;
create policy saved_states_read on saved_states for select
  using (person_id = current_person() and can_read_incident(incident_id));
create policy saved_states_insert on saved_states for insert
  with check (person_id = current_person() and can_read_incident(incident_id));
create policy saved_states_update on saved_states for update
  using (person_id = current_person() and can_read_incident(incident_id))
  with check (person_id = current_person() and can_read_incident(incident_id));
create policy saved_states_delete on saved_states for delete
  using (person_id = current_person() and can_read_incident(incident_id));
