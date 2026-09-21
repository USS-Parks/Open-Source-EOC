-- Durable normalized dataset items (VEOC-79C1). A dataset load persists its
-- mapped records here so they survive the request: each item carries its source
-- identity, normalized fields, geometry, incident association and load
-- provenance. A repeated load is idempotent (upsert by source id), a changed
-- item updates in place, and an item the source no longer sends is pruned, so
-- the dataset's persisted set always reflects its last successful load.

create table data_pack_items (
  id uuid primary key default gen_random_uuid(),
  dataset_id uuid not null references data_pack_datasets (id) on delete cascade,
  incident_id uuid not null references incidents (id),
  source_id text not null check (length(source_id) between 1 and 512),
  data jsonb not null,
  geom geometry(Geometry, 4326),
  first_loaded_at timestamptz not null default now(),
  last_loaded_at timestamptz not null default now(),
  loaded_by uuid not null references persons (id),
  unique (dataset_id, source_id)
);
create index data_pack_items_dataset on data_pack_items (dataset_id);
create index data_pack_items_incident on data_pack_items (incident_id);
create index data_pack_items_geom on data_pack_items using gist (geom) where geom is not null;

grant select, insert, update, delete on data_pack_items to app_runtime;

-- Items follow their incident: any incident reader sees them, and a writer of
-- the owning jurisdiction or an incident contributor may load (insert/update)
-- and prune (delete) them, the same authority that writes a dataset's load
-- status in 0035.
alter table data_pack_items enable row level security;
create policy dpi_read on data_pack_items for select
  using (can_read_incident(incident_id));
create policy dpi_insert on data_pack_items for insert
  with check (
    exists (
      select 1 from incidents i
      where i.id = incident_id
        and (is_writer_of(i.jurisdiction_id) or has_incident_participation(incident_id, 'contributor'))
    )
  );
create policy dpi_update on data_pack_items for update
  using (
    exists (
      select 1 from incidents i
      where i.id = incident_id
        and (is_writer_of(i.jurisdiction_id) or has_incident_participation(incident_id, 'contributor'))
    )
  )
  with check (
    exists (
      select 1 from incidents i
      where i.id = incident_id
        and (is_writer_of(i.jurisdiction_id) or has_incident_participation(incident_id, 'contributor'))
    )
  );
create policy dpi_delete on data_pack_items for delete
  using (
    exists (
      select 1 from incidents i
      where i.id = incident_id
        and (is_writer_of(i.jurisdiction_id) or has_incident_participation(incident_id, 'contributor'))
    )
  );
