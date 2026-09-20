-- Named, incident-scoped participation. The activating jurisdiction is the owner;
-- other organizations remain independent jurisdictions, never child tenants.
create table incident_participants (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references incidents (id),
  organization_id uuid not null references jurisdictions (id),
  person_id uuid not null references persons (id),
  incident_position_title text not null check (length(trim(incident_position_title)) between 1 and 120),
  role text not null check (role in ('viewer', 'contributor', 'coordinator')),
  expires_at timestamptz not null check (isfinite(expires_at)),
  reason text not null check (length(trim(reason)) between 1 and 1000),
  created_by uuid not null references persons (id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references persons (id),
  revoke_reason text,
  constraint revocation_complete check
    ((revoked_at is null and revoked_by is null and revoke_reason is null) or
     (revoked_at is not null and revoked_by is not null and revoke_reason is not null and
      length(trim(revoke_reason)) between 1 and 1000))
);
create unique index incident_participants_active_person
  on incident_participants (incident_id, person_id) where revoked_at is null;
create index incident_participants_person on incident_participants (person_id, incident_id)
  where revoked_at is null;

create function eligible_incident_person(pid uuid, oid uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, public, pg_temp as $$
  select exists (select 1 from public.persons p
    join public.jurisdiction_memberships m on m.person_id = p.id
    where p.id = pid and not p.disabled and m.jurisdiction_id = oid)
$$;
create function has_incident_participation(iid uuid, minimum_role text default 'viewer')
returns boolean language sql stable security definer
set search_path = pg_catalog, public, pg_temp as $$
  select exists (select 1 from public.incident_participants ip
    join public.jurisdiction_memberships m on m.person_id = ip.person_id
      and m.jurisdiction_id = ip.organization_id
    join public.persons p on p.id = ip.person_id
    where ip.incident_id = iid and ip.person_id = public.current_person()
      and not p.disabled and ip.revoked_at is null and ip.expires_at > now()
      and case minimum_role
        when 'viewer' then true
        when 'contributor' then ip.role in ('contributor', 'coordinator')
        when 'coordinator' then ip.role = 'coordinator'
        else false end)
$$;
create function can_read_incident(iid uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, public, pg_temp as $$
  select exists (select 1 from public.incidents i where i.id = iid
    and (public.is_member_of(i.jurisdiction_id) or
         public.has_incident_participation(i.id)))
$$;
create function can_revise_incident_area(iid uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, public, pg_temp as $$
  select exists (select 1 from public.incidents i where i.id = iid
    and (public.is_admin_of(i.jurisdiction_id) or
         public.has_incident_participation(i.id, 'coordinator')))
$$;
revoke all on function eligible_incident_person(uuid, uuid),
  has_incident_participation(uuid, text), can_read_incident(uuid),
  can_revise_incident_area(uuid) from public;
grant execute on function eligible_incident_person(uuid, uuid),
  has_incident_participation(uuid, text), can_read_incident(uuid),
  can_revise_incident_area(uuid) to app_runtime;

grant select, insert, update on incident_participants to app_runtime;
alter table incident_participants enable row level security;
create policy participant_read on incident_participants for select
  using (can_read_incident(incident_id));
create policy participant_insert on incident_participants for insert
  with check (created_by = current_person() and expires_at > now()
    and eligible_incident_person(person_id, organization_id)
    and exists (select 1 from incidents i where i.id = incident_id
      and i.closed_at is null and is_admin_of(i.jurisdiction_id)));
create policy participant_update on incident_participants for update
  using (exists (select 1 from incidents i where i.id = incident_id
    and is_admin_of(i.jurisdiction_id)))
  with check (exists (select 1 from incidents i where i.id = incident_id
    and is_admin_of(i.jurisdiction_id)));
create function check_incident_participant_change() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'participation grants are append-only';
  end if;
  if tg_op = 'INSERT' then
    if new.expires_at <= now() then raise exception 'grant must expire in the future'; end if;
    new.created_at := now();
    return new;
  end if;
  if row(old.id, old.incident_id, old.organization_id, old.person_id,
         old.incident_position_title, old.role, old.expires_at, old.reason,
         old.created_by, old.created_at, old.revoked_at, old.revoked_by, old.revoke_reason)
     is distinct from
     row(new.id, new.incident_id, new.organization_id, new.person_id,
         new.incident_position_title, new.role, new.expires_at, new.reason,
         new.created_by, new.created_at, old.revoked_at, old.revoked_by, old.revoke_reason)
     or old.revoked_at is not null or new.revoked_at is null
     or new.revoked_by is distinct from current_person()
     or new.revoke_reason is null or length(trim(new.revoke_reason)) not between 1 and 1000 then
    raise exception 'participation grants are immutable except revocation';
  end if;
  new.revoked_at := now();
  return new;
end $$;
create trigger participant_immutable before insert or update on incident_participants
  for each row execute function check_incident_participant_change();
create trigger participant_no_delete before delete on incident_participants
  for each row execute function check_incident_participant_change();

drop policy incidents_read on incidents;
create policy incidents_read on incidents for select
  using (is_member_of(jurisdiction_id) or has_incident_participation(id));
drop policy incident_positions_read on incident_positions;
create policy incident_positions_read on incident_positions for select
  using (can_read_incident(incident_id));
drop policy incident_boards_read on incident_boards;
create policy incident_boards_read on incident_boards for select
  using (can_read_incident(incident_id));
drop policy checklist_read on checklist_items;
create policy checklist_read on checklist_items for select
  using (can_read_incident(incident_id));
drop policy incident_libraries_read on incident_libraries;
create policy incident_libraries_read on incident_libraries for select
  using (can_read_incident(incident_id));

alter table incident_area_revisions add column home_organization_id uuid references jurisdictions (id);
alter table incident_area_revisions add column incident_position_title text
  check (incident_position_title is null or length(trim(incident_position_title)) between 1 and 120);
alter table incident_area_revisions add column participation_id uuid references incident_participants (id);
-- Historical revisions stay immutable. Readers derive their owner attribution.
drop policy incident_area_read on incident_area_revisions;
create policy incident_area_read on incident_area_revisions for select
  using (can_read_incident(incident_id));
drop policy incident_area_insert on incident_area_revisions;
create policy incident_area_insert on incident_area_revisions for insert
  with check (created_by = current_person() and can_revise_incident_area(incident_id)
    and ((participation_id is null and exists (
      select 1 from incidents i where i.id = incident_area_revisions.incident_id
        and is_admin_of(i.jurisdiction_id)
        and incident_area_revisions.home_organization_id = i.jurisdiction_id
        and ((incident_area_revisions.position_id is null and
              incident_area_revisions.incident_position_title is null) or exists (
          select 1 from auth_sessions s join positions p on p.id = s.active_position_id
          where s.person_id = current_person() and s.ended_at is null
            and s.active_position_id = incident_area_revisions.position_id
            and p.jurisdiction_id = i.jurisdiction_id
            and p.title = incident_area_revisions.incident_position_title
        ))
    )) or (position_id is null and exists (
      select 1 from incident_participants ip where ip.id = participation_id
        and ip.incident_id = incident_area_revisions.incident_id
        and ip.person_id = current_person()
        and ip.organization_id = incident_area_revisions.home_organization_id
        and ip.incident_position_title = incident_area_revisions.incident_position_title
        and ip.role = 'coordinator' and ip.revoked_at is null and ip.expires_at > now()
        and eligible_incident_person(ip.person_id, ip.organization_id)
    ))));

-- Area insertion locks the incident under owner rights without granting
-- participant UPDATE access to the incident row.
create function lock_incident_area(iid uuid) returns timestamptz
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare closed timestamptz;
begin
  if not public.can_revise_incident_area(iid) then
    raise exception 'incident area revision forbidden';
  end if;
  select closed_at into closed from public.incidents where id = iid for update;
  if not found then raise exception 'incident not found'; end if;
  return closed;
end $$;
revoke all on function lock_incident_area(uuid) from public;
grant execute on function lock_incident_area(uuid) to app_runtime;
alter function check_incident_area_append() security definer;
alter function check_incident_area_append() set search_path = pg_catalog, public, pg_temp;

-- A partner may append and see only their own area-revision audit receipt.
drop policy audit_read on audit_events;
create policy audit_read on audit_events for select using (
  is_member_of(jurisdiction_id) or
  (category = 'incident.area.revised' and person_id = current_person()
   and incident_id is not null and can_read_incident(incident_id))
);
drop policy audit_append on audit_events;
create policy audit_append on audit_events for insert with check (
  person_id = current_person() and
  (is_member_of(jurisdiction_id) or
   (category = 'incident.area.revised' and incident_id is not null
    and subject_table = 'incident_area_revisions' and subject_id = incident_id
    and can_revise_incident_area(incident_id)
    and exists (select 1 from incident_area_revisions a
      join incidents i on i.id = a.incident_id
      where a.incident_id = audit_events.incident_id
        and i.jurisdiction_id = audit_events.jurisdiction_id
        and a.created_by = current_person()
        and a.revision::text = audit_events.payload->>'revision'
        and a.reason = audit_events.payload->>'reason'
        and a.home_organization_id::text = audit_events.payload->>'homeOrganizationId'
        and a.incident_position_title = audit_events.payload->>'incidentPositionTitle'
        and a.participation_id::text = audit_events.payload->>'participationId')))
);
