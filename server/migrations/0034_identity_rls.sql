-- Row-level security for the four identity tables (parity audit finding 1):
-- persons, jurisdictions, auth_sessions and person_identities were the only
-- tables without RLS. persons and jurisdictions are read across tenants by
-- design (attribution names, federation, incident participation), so their
-- wall is "an authenticated person is acting"; writes stay scoped. Session
-- and OIDC-link rows are per-person secrets, scoped to the acting person.
--
-- Authentication reads a row before any person context exists (login by
-- email, session resolve by token hash, resume by resume-token hash, OIDC by
-- issuer/subject). Those paths run through the SECURITY DEFINER functions
-- below, which are owned by the migration role and so are the only way to see
-- a row before current_person() is set. The application role never selects,
-- inserts or resumes a session row directly.

create function find_person_by_email(addr text)
returns table (id uuid, password_hash text, disabled boolean)
language sql security definer set search_path = pg_catalog, public, pg_temp as $$
  -- Columns are alias-qualified so they resolve to the table, not the
  -- same-named RETURNS TABLE output parameters (which would be ambiguous).
  select p.id, p.password_hash, p.disabled from public.persons p where lower(p.email) = lower(addr)
$$;

create function create_auth_session(
  pid uuid, access_hash text, resume_hash text, access_expires_at timestamptz)
returns uuid
language sql security definer set search_path = pg_catalog, public, pg_temp as $$
  insert into public.auth_sessions (person_id, access_hash, resume_hash, access_expires_at)
  values (pid, access_hash, resume_hash, access_expires_at)
  returning id
$$;

create function resume_auth_session(
  resume_hash_in text, new_access_hash text, access_expires_at_in timestamptz)
returns uuid
language sql security definer set search_path = pg_catalog, public, pg_temp as $$
  update public.auth_sessions
  set access_hash = new_access_hash, access_expires_at = access_expires_at_in, resumed_at = now()
  where resume_hash = resume_hash_in and ended_at is null
  returning id
$$;

create function resolve_auth_session(access_hash_in text)
returns table (
  session_id uuid, access_expires_at timestamptz, active_position_id uuid,
  person_id uuid, email text, display_name text, disabled boolean)
language sql security definer set search_path = pg_catalog, public, pg_temp as $$
  select s.id, s.access_expires_at, s.active_position_id,
         p.id, p.email, p.display_name, p.disabled
  from public.auth_sessions s
  join public.persons p on p.id = s.person_id
  where s.access_hash = access_hash_in and s.ended_at is null
$$;

create function resolve_identity(iss text, sub text)
returns uuid
language sql security definer set search_path = pg_catalog, public, pg_temp as $$
  select person_id from public.person_identities where issuer = iss and subject = sub
$$;

create function link_identity(pid uuid, iss text, sub text)
returns void
language sql security definer set search_path = pg_catalog, public, pg_temp as $$
  insert into public.person_identities (person_id, issuer, subject) values (pid, iss, sub)
$$;

revoke all on function
  find_person_by_email(text),
  create_auth_session(uuid, text, text, timestamptz),
  resume_auth_session(text, text, timestamptz),
  resolve_auth_session(text),
  resolve_identity(text, text),
  link_identity(uuid, text, text)
from public;
grant execute on function
  find_person_by_email(text),
  create_auth_session(uuid, text, text, timestamptz),
  resume_auth_session(text, text, timestamptz),
  resolve_auth_session(text),
  resolve_identity(text, text),
  link_identity(uuid, text, text)
to app_runtime;

-- persons: readable to any authenticated actor (cross-tenant attribution);
-- created by an authenticated actor (the /persons route is admin-gated as the
-- first wall). No app-role update path exists, so update stays denied; the
-- migration/owner role manages flags and disablement.
alter table persons enable row level security;
create policy persons_read on persons for select using (current_person() is not null);
create policy persons_insert on persons for insert with check (current_person() is not null);

-- jurisdictions: an instance directory, readable to any authenticated actor
-- (federation and participation reach across tenants). Created by instance
-- admins; the locked flag is updated by an admin of that jurisdiction.
alter table jurisdictions enable row level security;
create policy jurisdictions_read on jurisdictions for select using (current_person() is not null);
create policy jurisdictions_insert on jurisdictions for insert with check (is_instance_admin());
create policy jurisdictions_update on jurisdictions for update
  using (is_admin_of(id)) with check (is_admin_of(id));

-- auth_sessions: a person sees and updates only their own sessions (sign in
-- and out, logout). Minting and resuming happen before a person context
-- exists and go through the definer functions above, so there is no app-role
-- insert policy.
alter table auth_sessions enable row level security;
create policy auth_sessions_read on auth_sessions for select
  using (person_id = current_person());
create policy auth_sessions_update on auth_sessions for update
  using (person_id = current_person()) with check (person_id = current_person());

-- person_identities: a person sees only their own OIDC links. Lookup and
-- linking at login time go through the definer functions above.
alter table person_identities enable row level security;
create policy person_identities_read on person_identities for select
  using (person_id = current_person());
