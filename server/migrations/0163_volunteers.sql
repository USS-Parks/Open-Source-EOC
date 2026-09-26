-- Volunteer and CERT roster (VC-20).
--
-- Volunteers are not accounts. A roster entry names a person, their
-- affiliation (a CERT team, a faith group, a partner organization), their
-- skills, and their credentials with issuer and expiry. How to reach them is
-- kept apart in volunteer_contacts, read only by the jurisdiction's writers
-- and the organization that entered them, never by viewers or guests.
--
-- The jurisdiction's staff enter and edit entries. A partner organization
-- taking part in an incident enters its own volunteers for that incident
-- (organization_id and incident_id); its people read only those, and only
-- while a grant on the incident lasts. Contributors and coordinators write;
-- a viewer grant reads without the contacts.
--
-- A deployment assigns a volunteer to an incident of the jurisdiction in a
-- role, from a start to an end (none while under way), naming the
-- credentials the role needs. Hours are read from deployments. A partner's
-- volunteer is deployed only on the incident it was entered for.

create table public.volunteers (
  id uuid primary key default gen_random_uuid(),
  jurisdiction_id uuid not null references public.jurisdictions (id),
  organization_id uuid references public.jurisdictions (id),
  incident_id uuid references public.incidents (id),
  name text not null check (length(name) between 1 and 200),
  affiliation text not null check (affiliation in ('cert', 'faith', 'partner', 'community', 'other')),
  affiliation_name text not null default '' check (length(affiliation_name) <= 200),
  skills text[] not null default '{}' check (cardinality(skills) <= 30),
  credentials jsonb not null default '[]' check (jsonb_typeof(credentials) = 'array'),
  notes text not null default '' check (length(notes) <= 2000),
  active boolean not null default true,
  created_by uuid not null references public.persons (id),
  created_at timestamptz not null default now(),
  updated_by uuid not null references public.persons (id),
  updated_at timestamptz not null default now(),
  check ((organization_id is null) = (incident_id is null)),
  unique (id, jurisdiction_id)
);
create index volunteers_roster on public.volunteers (jurisdiction_id, name, id);
create index volunteers_incident on public.volunteers (incident_id) where incident_id is not null;

create table public.volunteer_contacts (
  volunteer_id uuid primary key references public.volunteers (id),
  phone text not null default '' check (length(phone) <= 40),
  email text not null default '' check (length(email) <= 254)
);

create table public.volunteer_deployments (
  id uuid primary key default gen_random_uuid(),
  volunteer_id uuid not null,
  jurisdiction_id uuid not null,
  incident_id uuid not null references public.incidents (id),
  role text not null check (length(role) between 1 and 200),
  starts_at timestamptz not null,
  ends_at timestamptz,
  needs text[] not null default '{}' check (cardinality(needs) <= 10),
  note text not null default '' check (length(note) <= 500),
  created_by uuid not null references public.persons (id),
  created_at timestamptz not null default now(),
  updated_by uuid not null references public.persons (id),
  updated_at timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at),
  foreign key (volunteer_id, jurisdiction_id) references public.volunteers (id, jurisdiction_id)
);
create index volunteer_deployments_volunteer on public.volunteer_deployments (volunteer_id, starts_at);
create index volunteer_deployments_incident on public.volunteer_deployments (incident_id, starts_at);
create index volunteer_deployments_jurisdiction on public.volunteer_deployments (jurisdiction_id, starts_at);

-- The acting person holds a live grant on the incident, which belongs to the
-- jurisdiction, for the organization: any role for 'viewer', a contributor
-- or coordinator for 'contributor'.
create function public.is_volunteer_partner(jid uuid, iid uuid, oid uuid, minimum_role text) returns boolean
  language sql stable security definer
  set search_path to 'pg_catalog', 'public', 'pg_temp'
  as $$
  select exists (select 1 from public.incidents i
    join public.incident_participants ip on ip.incident_id = i.id
    join public.jurisdiction_memberships m on m.person_id = ip.person_id and m.jurisdiction_id = ip.organization_id
    join public.persons p on p.id = ip.person_id
    where i.id = iid and i.jurisdiction_id = jid and ip.organization_id = oid
      and ip.person_id = public.current_person() and not p.disabled
      and ip.revoked_at is null and ip.expires_at > now()
      and (minimum_role = 'viewer' or ip.role in ('contributor', 'coordinator')))
$$;

create function public.can_read_volunteer(vid uuid) returns boolean
  language sql stable security definer
  set search_path to 'pg_catalog', 'public', 'pg_temp'
  as $$
  select exists (select 1 from public.volunteers v where v.id = vid and (public.is_member_of(v.jurisdiction_id)
    or (v.organization_id is not null
        and public.is_volunteer_partner(v.jurisdiction_id, v.incident_id, v.organization_id, 'viewer'))))
$$;

-- Writing a volunteer, and reading how to reach them.
create function public.can_write_volunteer(vid uuid) returns boolean
  language sql stable security definer
  set search_path to 'pg_catalog', 'public', 'pg_temp'
  as $$
  select exists (select 1 from public.volunteers v where v.id = vid and (public.is_writer_of(v.jurisdiction_id)
    or (v.organization_id is not null
        and public.is_volunteer_partner(v.jurisdiction_id, v.incident_id, v.organization_id, 'contributor'))))
$$;

create function public.can_deploy_volunteer(vid uuid, iid uuid) returns boolean
  language sql stable security definer
  set search_path to 'pg_catalog', 'public', 'pg_temp'
  as $$
  select public.can_write_volunteer(vid) and exists (
    select 1 from public.volunteers v join public.incidents i on i.jurisdiction_id = v.jurisdiction_id
    where v.id = vid and i.id = iid and (v.incident_id is null or v.incident_id = iid))
$$;

revoke all on function public.is_volunteer_partner(uuid, uuid, uuid, text) from public;
revoke all on function public.can_read_volunteer(uuid) from public;
revoke all on function public.can_write_volunteer(uuid) from public;
revoke all on function public.can_deploy_volunteer(uuid, uuid) from public;
grant execute on function public.is_volunteer_partner(uuid, uuid, uuid, text) to app_runtime;
grant execute on function public.can_read_volunteer(uuid) to app_runtime;
grant execute on function public.can_write_volunteer(uuid) to app_runtime;
grant execute on function public.can_deploy_volunteer(uuid, uuid) to app_runtime;

alter table public.volunteers enable row level security;
alter table public.volunteer_contacts enable row level security;
alter table public.volunteer_deployments enable row level security;

create policy volunteers_read on public.volunteers
  for select using (public.is_member_of(jurisdiction_id) or (organization_id is not null
    and public.is_volunteer_partner(jurisdiction_id, incident_id, organization_id, 'viewer')));
-- Staff enter the jurisdiction's own entries; a partner enters only its own.
create policy volunteers_insert on public.volunteers
  for insert with check ((organization_id is null and public.is_writer_of(jurisdiction_id)) or (organization_id is not null
    and public.is_volunteer_partner(jurisdiction_id, incident_id, organization_id, 'contributor')));
create policy volunteers_update on public.volunteers
  for update using (public.is_writer_of(jurisdiction_id) or (organization_id is not null
    and public.is_volunteer_partner(jurisdiction_id, incident_id, organization_id, 'contributor')))
  with check (public.is_writer_of(jurisdiction_id) or (organization_id is not null
    and public.is_volunteer_partner(jurisdiction_id, incident_id, organization_id, 'contributor')));

create policy volunteer_contacts_read on public.volunteer_contacts
  for select using (public.can_write_volunteer(volunteer_id));
create policy volunteer_contacts_insert on public.volunteer_contacts
  for insert with check (public.can_write_volunteer(volunteer_id));
create policy volunteer_contacts_update on public.volunteer_contacts
  for update using (public.can_write_volunteer(volunteer_id)) with check (public.can_write_volunteer(volunteer_id));

create policy volunteer_deployments_read on public.volunteer_deployments
  for select using (public.can_read_volunteer(volunteer_id));
create policy volunteer_deployments_insert on public.volunteer_deployments
  for insert with check (public.can_deploy_volunteer(volunteer_id, incident_id));
create policy volunteer_deployments_update on public.volunteer_deployments
  for update using (public.can_deploy_volunteer(volunteer_id, incident_id))
  with check (public.can_deploy_volunteer(volunteer_id, incident_id));
create policy volunteer_deployments_delete on public.volunteer_deployments
  for delete using (public.can_deploy_volunteer(volunteer_id, incident_id));

-- A partner's people are not members of the jurisdiction, so their roster
-- changes are appended here: about a volunteer they may write, in its
-- jurisdiction. They read back the events they wrote, as the append returns them.
create policy audit_volunteer_partner_append on public.audit_events
  for insert with check (person_id = public.current_person() and subject_table = 'volunteers'
    and category like 'volunteer.%' and public.can_write_volunteer(subject_id)
    and exists (select 1 from public.volunteers v where v.id = subject_id and v.jurisdiction_id = audit_events.jurisdiction_id));
create policy audit_volunteer_partner_read on public.audit_events
  for select using (person_id = public.current_person() and subject_table = 'volunteers'
    and category like 'volunteer.%' and public.can_write_volunteer(subject_id));

grant select, insert, update on table public.volunteers to app_runtime;
grant select, insert, update on table public.volunteer_contacts to app_runtime;
grant select, insert, update, delete on table public.volunteer_deployments to app_runtime;
