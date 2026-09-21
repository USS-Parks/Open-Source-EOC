-- Activation-time data-pack onboarding (VEOC-79C). A participating
-- organization registers its datasets into an incident at runtime, with no
-- code change or redeploy: the organization is the source owner, and each
-- dataset maps its source onto the platform's normalized fields and declares
-- coverage and freshness. A dataset that has not loaded or has failed reads as
-- awaiting or unavailable, never zero, and never blocks incident activation.

create table data_packs (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references incidents (id),
  organization_id uuid not null references jurisdictions (id),
  name text not null check (length(trim(name)) between 1 and 200),
  description text check (description is null or length(description) <= 1000),
  created_by uuid not null references persons (id),
  created_at timestamptz not null default now()
);
create index data_packs_incident on data_packs (incident_id);

create table data_pack_datasets (
  id uuid primary key default gen_random_uuid(),
  pack_id uuid not null references data_packs (id),
  key text not null check (key ~ '^[a-z][a-z0-9_]*$'),
  name text not null check (length(trim(name)) between 1 and 200),
  kind text not null check (kind in ('geojson', 'cap', 'georss', 'cot', 'table')),
  url text,
  field_mapping jsonb not null,
  coverage geometry(Geometry, 4326),
  stale_after_seconds integer not null default 3600
    check (stale_after_seconds between 60 and 604800),
  last_success_at timestamptz,
  last_error text,
  item_count integer check (item_count is null or item_count >= 0),
  created_at timestamptz not null default now(),
  unique (pack_id, key),
  -- item_count is meaningful only after a successful load; a source that has
  -- never loaded keeps it null so it is never read as zero impact.
  constraint item_count_follows_success check ((last_success_at is null) = (item_count is null))
);
create index data_pack_datasets_pack on data_pack_datasets (pack_id);
create index data_pack_datasets_coverage on data_pack_datasets using gist (coverage)
  where coverage is not null;

grant select, insert, update on data_packs to app_runtime;
grant select, insert, update on data_pack_datasets to app_runtime;

-- Reads follow incident participation. A pack is registered by the incident
-- owner's admin or by a coordinator of the owning organization; the service
-- layer additionally binds the coordinator's own organization.
alter table data_packs enable row level security;
create policy data_packs_read on data_packs for select using (can_read_incident(incident_id));
create policy data_packs_insert on data_packs for insert
  with check (
    created_by = current_person()
    and exists (
      select 1 from incidents i
      where i.id = incident_id and i.closed_at is null
        and (
          is_admin_of(i.jurisdiction_id)
          or exists (
            select 1 from incident_participants ip
            where ip.incident_id = data_packs.incident_id
              and ip.person_id = current_person()
              and ip.organization_id = data_packs.organization_id
              and ip.role = 'coordinator' and ip.revoked_at is null and ip.expires_at > now()
              and eligible_incident_person(ip.person_id, ip.organization_id)
          )
        )
    )
  );

alter table data_pack_datasets enable row level security;
create policy data_pack_datasets_read on data_pack_datasets for select
  using (exists (select 1 from data_packs p where p.id = pack_id and can_read_incident(p.incident_id)));
create policy data_pack_datasets_insert on data_pack_datasets for insert
  with check (
    exists (
      select 1 from data_packs p join incidents i on i.id = p.incident_id
      where p.id = pack_id and i.closed_at is null
        and (
          is_admin_of(i.jurisdiction_id)
          or exists (
            select 1 from incident_participants ip
            where ip.incident_id = p.incident_id and ip.person_id = current_person()
              and ip.organization_id = p.organization_id
              and ip.role = 'coordinator' and ip.revoked_at is null and ip.expires_at > now()
          )
        )
    )
  );
-- Load status (freshness, item count, error) is written by a contributor of
-- the incident or a writer of its owning jurisdiction; a poller runs under the
-- same authority. Only the mutable load columns may change (enforced in-app).
create policy data_pack_datasets_update on data_pack_datasets for update
  using (
    exists (
      select 1 from data_packs p join incidents i on i.id = p.incident_id
      where p.id = pack_id
        and (is_writer_of(i.jurisdiction_id) or has_incident_participation(p.incident_id, 'contributor'))
    )
  )
  with check (
    exists (
      select 1 from data_packs p join incidents i on i.id = p.incident_id
      where p.id = pack_id
        and (is_writer_of(i.jurisdiction_id) or has_incident_participation(p.incident_id, 'contributor'))
    )
  );
