-- Authorization, tenancy walls, guests, OIDC identities (VEOC-08).

alter table persons add column is_instance_admin boolean not null default false;

-- External identity links (OIDC). A person may hold several.
create table person_identities (
  person_id uuid not null references persons (id),
  issuer text not null,
  subject text not null,
  created_at timestamptz not null default now(),
  primary key (issuer, subject)
);

-- Time-boxed, scope-limited mutual-aid guest access (R3).
create table guest_grants (
  id uuid primary key default gen_random_uuid(),
  jurisdiction_id uuid not null references jurisdictions (id),
  person_id uuid not null references persons (id),
  scopes text[] not null,
  expires_at timestamptz not null,
  created_by uuid not null references persons (id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references persons (id)
);
create index guest_grants_person on guest_grants (person_id) where revoked_at is null;

-- Runtime role: the application connects as app_runtime, which is not the
-- table owner and not a superuser, so row-level security applies to it.
-- Deployments set its password (ALTER ROLE app_runtime PASSWORD ...).
do $$
begin
  if not exists (select from pg_roles where rolname = 'app_runtime') then
    create role app_runtime login;
  end if;
end $$;

grant usage on schema public to app_runtime;
grant select, insert, update on all tables in schema public to app_runtime;
alter default privileges in schema public grant select, insert, update on tables to app_runtime;

-- The second wall (INV-7, ADR-0005): row-level security keyed on the
-- person set by the service layer for the current transaction. The first
-- wall is the service-layer check; RLS catches anything that slips past.

create function current_person() returns uuid
language sql stable as $$
  select nullif(current_setting('app.person_id', true), '')::uuid
$$;

create function is_member_of(jid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from jurisdiction_memberships
    where person_id = current_person() and jurisdiction_id = jid)
$$;

create function is_admin_of(jid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from jurisdiction_memberships
    where person_id = current_person() and jurisdiction_id = jid and role = 'admin')
$$;

create function is_instance_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select is_instance_admin from persons where id = current_person()), false)
$$;

create function has_guest_scope(jid uuid, wanted text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from guest_grants
    where person_id = current_person() and jurisdiction_id = jid
      and revoked_at is null and expires_at > now()
      and wanted = any (scopes))
$$;

alter table positions enable row level security;
create policy positions_read on positions for select
  using (is_member_of(jurisdiction_id) or has_guest_scope(jurisdiction_id, 'positions:read'));
create policy positions_write on positions for insert
  with check (is_admin_of(jurisdiction_id) or is_instance_admin());
create policy positions_update on positions for update
  using (is_admin_of(jurisdiction_id));

alter table position_assignments enable row level security;
create policy assignments_read on position_assignments for select
  using (exists (select 1 from positions p where p.id = position_id
                 and is_member_of(p.jurisdiction_id)));
create policy assignments_write on position_assignments for insert
  with check (exists (select 1 from positions p where p.id = position_id
                      and is_admin_of(p.jurisdiction_id)));
create policy assignments_update on position_assignments for update
  using (exists (select 1 from positions p where p.id = position_id
                 and is_admin_of(p.jurisdiction_id)));

alter table position_signins enable row level security;
create policy signins_read on position_signins for select
  using (person_id = current_person()
         or exists (select 1 from positions p where p.id = position_id
                    and is_member_of(p.jurisdiction_id)));
create policy signins_write on position_signins for insert
  with check (person_id = current_person());
create policy signins_update on position_signins for update
  using (person_id = current_person());

alter table jurisdiction_memberships enable row level security;
create policy memberships_read on jurisdiction_memberships for select
  using (person_id = current_person() or is_member_of(jurisdiction_id));
create policy memberships_write on jurisdiction_memberships for insert
  with check (is_admin_of(jurisdiction_id) or is_instance_admin());

alter table guest_grants enable row level security;
create policy guests_read on guest_grants for select
  using (person_id = current_person() or is_admin_of(jurisdiction_id));
create policy guests_write on guest_grants for insert
  with check (is_admin_of(jurisdiction_id));
create policy guests_update on guest_grants for update
  using (is_admin_of(jurisdiction_id));
