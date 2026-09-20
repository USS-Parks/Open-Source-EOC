-- Incident-scoped operational-area snapshots (VEOC-79).
create table incident_area_revisions (
  incident_id uuid not null references incidents (id),
  revision integer not null check (revision > 0),
  geometry geometry(Geometry, 4326),
  period_label text,
  period_starts_at timestamptz,
  period_ends_at timestamptz,
  reason text not null check (length(trim(reason)) between 1 and 1000),
  created_at timestamptz not null default now(),
  created_by uuid not null references persons (id),
  position_id uuid references positions (id),
  primary key (incident_id, revision),
  constraint area_valid check (
    geometry is null or (
      GeometryType(geometry) in ('POLYGON', 'MULTIPOLYGON')
      and not ST_IsEmpty(geometry) and ST_IsValid(geometry)
      and ST_NDims(geometry) = 2 and ST_NPoints(geometry) <= 10000
      and ST_XMin(geometry) >= -180 and ST_XMax(geometry) <= 180
      and ST_YMin(geometry) >= -90 and ST_YMax(geometry) <= 90
      and ST_Area(geometry) > 0
    )
  ),
  constraint period_valid check (
    (period_label is null and period_starts_at is null and period_ends_at is null)
    or (period_label is not null and length(trim(period_label)) between 1 and 120
        and period_starts_at is not null and period_ends_at is not null
        and isfinite(period_starts_at) and isfinite(period_ends_at)
        and period_ends_at > period_starts_at)
  )
);

grant select, insert on incident_area_revisions to app_runtime;
revoke update, delete on incident_area_revisions from app_runtime;
alter table incident_area_revisions enable row level security;
create policy incident_area_read on incident_area_revisions for select
  using (exists (
    select 1 from incidents i where i.id = incident_id
      and is_member_of(i.jurisdiction_id)
  ));
create policy incident_area_insert on incident_area_revisions for insert
  with check (created_by = current_person() and exists (
    select 1 from incidents i where i.id = incident_id
      and is_admin_of(i.jurisdiction_id)
  ) and (position_id is null or exists (
    select 1 from auth_sessions s join positions p on p.id = s.active_position_id
    where s.person_id = current_person() and s.active_position_id = position_id
      and s.ended_at is null and p.jurisdiction_id = (
        select jurisdiction_id from incidents where id = incident_id)
  )));

-- Even the table owner cannot silently rewrite a revision.
create function reject_incident_area_change() returns trigger language plpgsql as $$
begin
  raise exception 'incident area revisions are append-only';
end $$;
create trigger incident_area_immutable before update or delete on incident_area_revisions
  for each row execute function reject_incident_area_change();

-- Defend the revision sequence and closure boundary beneath the API.
create function check_incident_area_append() returns trigger language plpgsql as $$
declare
  incident_closed timestamptz;
  next_revision integer;
begin
  select closed_at into incident_closed from incidents
    where id = new.incident_id for update;
  if not found then raise exception 'incident not found'; end if;
  if incident_closed is not null then raise exception 'incident is closed'; end if;
  select coalesce(max(revision), 0) + 1 into next_revision
    from incident_area_revisions where incident_id = new.incident_id;
  if new.revision <> next_revision then
    raise exception 'incident area revision out of sequence';
  end if;
  new.created_at := now();
  return new;
end $$;
create trigger incident_area_append before insert on incident_area_revisions
  for each row execute function check_incident_area_append();
