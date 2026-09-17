-- Scan-first tracking objects and reunification (VEOC-25, F11). A tracked
-- object is anchored by a scan tag (QR/barcode); every scan across every
-- agency appends to one custody chain. Restricted details (health, full
-- identity) live in a separate jsonb column masked by role at the service
-- layer, while whereabouts stays queryable for reunification.

create table tracked_objects (
  id uuid primary key default gen_random_uuid(),
  jurisdiction_id uuid not null references jurisdictions (id),
  tag text not null,
  kind text not null,
  label text not null,
  restricted jsonb not null default '{}',
  created_by uuid not null references persons (id),
  created_at timestamptz not null default now(),
  unique (jurisdiction_id, tag)
);
create index tracked_objects_jurisdiction on tracked_objects (jurisdiction_id);

create table tracking_events (
  id uuid primary key default gen_random_uuid(),
  object_id uuid not null references tracked_objects (id),
  jurisdiction_id uuid not null references jurisdictions (id),
  custody_state text not null,
  station text,
  agency text,
  location text,
  geom geometry(Point, 4326),
  note text,
  occurred_at timestamptz not null default now(),
  recorded_by uuid not null references persons (id),
  created_at timestamptz not null default now()
);
create index tracking_events_object on tracking_events (object_id, occurred_at);

grant select, insert on tracked_objects to app_runtime;
grant select, insert on tracking_events to app_runtime;

-- Row access is jurisdiction membership (any role, so a reunification desk
-- can query); field-level need-to-know is enforced in the service, which
-- masks the restricted column for anyone below operational staff.
alter table tracked_objects enable row level security;
create policy tracked_read on tracked_objects for select using (is_member_of(jurisdiction_id));
create policy tracked_write on tracked_objects for insert with check (is_writer_of(jurisdiction_id));

alter table tracking_events enable row level security;
create policy tracking_events_read on tracking_events for select
  using (is_member_of(jurisdiction_id));
create policy tracking_events_write on tracking_events for insert
  with check (is_writer_of(jurisdiction_id));
