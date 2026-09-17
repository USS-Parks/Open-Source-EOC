-- Live feeds and sensor ingestion (VEOC-19, F18). External hazard feeds
-- and position streams land as read-only layers with provenance and
-- staleness; ingestion failure is a visible, alarmed state, never a
-- silent stop.

create table feeds (
  id uuid primary key default gen_random_uuid(),
  jurisdiction_id uuid not null references jurisdictions (id),
  name text not null,
  kind text not null check (kind in ('cap', 'geojson', 'georss', 'cot')),
  -- Poll feeds carry a url and interval; push feeds carry a token hash.
  url text,
  poll_interval_seconds integer,
  ingest_token_hash text,
  stale_after_seconds integer not null default 900,
  enabled boolean not null default true,
  last_polled_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  consecutive_failures integer not null default 0,
  created_by uuid not null references persons (id),
  created_at timestamptz not null default now(),
  check (url is not null or ingest_token_hash is not null)
);

create table feed_items (
  id uuid primary key default gen_random_uuid(),
  feed_id uuid not null references feeds (id),
  external_id text not null,
  title text,
  severity text,
  geom geometry(Geometry, 4326),
  properties jsonb not null default '{}',
  track jsonb not null default '[]',
  first_seen_at timestamptz not null default now(),
  fetched_at timestamptz not null default now(),
  unique (feed_id, external_id)
);
create index feed_items_feed on feed_items (feed_id, fetched_at desc);
create index feed_items_geom on feed_items using gist (geom) where geom is not null;

grant select, insert, update, delete on feeds, feed_items to app_runtime;

alter table feeds enable row level security;
create policy feeds_read on feeds for select
  using (is_member_of(jurisdiction_id)
         -- Server-internal scheduler lane: the process (no person set)
         -- may list due feeds; each poll then runs under the creator.
         or current_person() is null);
create policy feeds_write on feeds for insert
  with check (is_admin_of(jurisdiction_id));
create policy feeds_update on feeds for update
  using (is_admin_of(jurisdiction_id));

alter table feed_items enable row level security;
create policy feed_items_read on feed_items for select
  using (exists (
    select 1 from feeds f where f.id = feed_id and is_member_of(f.jurisdiction_id)));
create policy feed_items_write on feed_items for insert
  with check (exists (
    select 1 from feeds f where f.id = feed_id and is_admin_of(f.jurisdiction_id)));
create policy feed_items_update on feed_items for update
  using (exists (
    select 1 from feeds f where f.id = feed_id and is_admin_of(f.jurisdiction_id)));
create policy feed_items_delete on feed_items for delete
  using (exists (
    select 1 from feeds f where f.id = feed_id and is_admin_of(f.jurisdiction_id)));
