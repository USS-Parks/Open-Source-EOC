-- Service identities (VC-25): an integration that is not a person.
--
-- A jurisdiction administrator names an identity, gives it the viewer or
-- member role in that one jurisdiction and an expiry, and receives its token
-- once. The token is stored only as a SHA-256 hash, which the application
-- role can neither select nor get back from any function: the server hashes
-- the presented secret and the definer function below matches it, as session
-- tokens are matched through resolve_auth_session.
--
-- Every row-level security policy asks current_person() and that person's
-- memberships. So that the same policies hold an identity with no change to
-- any of them, each identity acts through a backing row in persons flagged
-- service_identity, with exactly one membership: in the identity's
-- jurisdiction, at the identity's role, never admin. The flag keeps that row
-- from signing in, holding a session, a second factor, a position, a guest
-- grant or an incident participation, and from any other membership. Its
-- writes are audited under its own row, whose name is the identity's.
--
-- An identity works only while it is not revoked, not expired, and the
-- administrator who created it is still an enabled administrator of its
-- jurisdiction. That holds for its requests and for every piece of
-- background work that would run as its backing row.

alter table public.persons add column service_identity boolean not null default false;

create table public.service_identities (
  id uuid primary key default gen_random_uuid(),
  jurisdiction_id uuid not null references public.jurisdictions(id),
  person_id uuid not null unique references public.persons(id),
  name text not null check (length(btrim(name)) between 1 and 120),
  role text not null check (role in ('viewer', 'member')),
  token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid not null references public.persons(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null check (isfinite(expires_at)),
  last_used_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references public.persons(id),
  check (expires_at > created_at),
  check ((revoked_at is null) = (revoked_by is null))
);
create unique index service_identities_live_name
  on public.service_identities (jurisdiction_id, lower(name)) where revoked_at is null;
create index service_identities_list on public.service_identities (jurisdiction_id, created_at desc);

alter table public.service_identities enable row level security;

-- Administrators of the jurisdiction read and create its identities, in their
-- own name, over a backing row that is flagged. Revocation and last use go
-- through the functions below; the application role updates nothing here.
create policy service_identities_read on public.service_identities for select
  using (public.is_admin_of(jurisdiction_id));
create policy service_identities_insert on public.service_identities for insert
  with check (public.is_admin_of(jurisdiction_id) and created_by = public.current_person()
    and revoked_at is null and last_used_at is null
    and exists (select 1 from public.persons p where p.id = person_id and p.service_identity));

revoke all on table public.service_identities from app_runtime;
grant insert on table public.service_identities to app_runtime;
grant select (id, jurisdiction_id, person_id, name, role, created_by, created_at, expires_at,
  last_used_at, revoked_at, revoked_by) on table public.service_identities to app_runtime;

-- Why a backing row may not act now: 'revoked', 'expired', or 'creator' when
-- whoever created the identity is no longer an enabled administrator of its
-- jurisdiction. Null for a live identity and for any row that is not a
-- backing row. The disabled flag is read beside it where it applies.
create function public.service_identity_stopped(pid uuid)
  returns text
  language sql stable security definer
  set search_path to 'pg_catalog', 'public', 'pg_temp'
  as $$
  select case
    when s.revoked_at is not null then 'revoked'
    when s.expires_at <= now() then 'expired'
    when not exists (
      select 1 from public.jurisdiction_memberships m
      join public.persons c on c.id = m.person_id
      where m.person_id = s.created_by and m.jurisdiction_id = s.jurisdiction_id
        and m.role = 'admin' and not c.disabled) then 'creator'
  end
  from public.service_identities s
  where s.person_id = pid
$$;

-- Token resolution precedes any person context. Matches the hash the server
-- computed from the presented secret and returns nothing for a wrong one, so
-- no caller learns a stored hash. A match that may act records its last use,
-- kept to the minute so a busy integration does not write on every request.
create function public.service_identity_credential(sid uuid, hash text)
  returns table (person_id uuid, email text, display_name text, name text,
    expires_at timestamptz, stopped text)
  language plpgsql security definer
  set search_path to 'pg_catalog', 'public', 'pg_temp'
  as $$
begin
  select s.person_id, p.email, p.display_name, s.name, s.expires_at,
    coalesce(public.service_identity_stopped(s.person_id), case when p.disabled then 'disabled' end)
    into person_id, email, display_name, name, expires_at, stopped
  from public.service_identities s join public.persons p on p.id = s.person_id
  where s.id = sid and s.token_hash = hash and p.service_identity;
  if not found then
    return;
  end if;
  if stopped is null then
    update public.service_identities u set last_used_at = now()
    where u.id = sid and (u.last_used_at is null or u.last_used_at < now() - interval '1 minute');
  end if;
  return next;
end
$$;

-- Revocation by an administrator of the identity's jurisdiction. The backing
-- row is disabled as well. Returns false when there is nothing live to revoke.
create function public.revoke_service_identity(sid uuid)
  returns boolean
  language plpgsql security definer
  set search_path to 'pg_catalog', 'public', 'pg_temp'
  as $$
declare
  pid uuid;
begin
  update public.service_identities set revoked_at = now(), revoked_by = public.current_person()
  where id = sid and revoked_at is null and public.is_admin_of(jurisdiction_id)
  returning person_id into pid;
  if pid is null then
    return false;
  end if;
  update public.persons set disabled = true where id = pid;
  return true;
end
$$;

-- A backing row holds nothing a person holds.
create function public.refuse_service_identity_person()
  returns trigger
  language plpgsql security definer
  set search_path to 'pg_catalog', 'public', 'pg_temp'
  as $$
begin
  if exists (select 1 from public.persons p where p.id = new.person_id and p.service_identity) then
    raise exception 'a service identity cannot hold %', case tg_table_name
      when 'auth_sessions' then 'a session'
      when 'person_mfa' then 'a second factor'
      when 'position_assignments' then 'a position'
      when 'guest_grants' then 'a guest grant'
      else 'an incident participation' end
      using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger service_identity_no_session before insert or update of person_id on public.auth_sessions
  for each row execute function public.refuse_service_identity_person();
create trigger service_identity_no_mfa before insert or update of person_id on public.person_mfa
  for each row execute function public.refuse_service_identity_person();
create trigger service_identity_no_position before insert or update of person_id on public.position_assignments
  for each row execute function public.refuse_service_identity_person();
create trigger service_identity_no_guest_grant before insert or update of person_id on public.guest_grants
  for each row execute function public.refuse_service_identity_person();
create trigger service_identity_no_participation before insert or update of person_id on public.incident_participants
  for each row execute function public.refuse_service_identity_person();

-- A backing row's only membership is the one its identity names.
create function public.check_service_identity_membership()
  returns trigger
  language plpgsql security definer
  set search_path to 'pg_catalog', 'public', 'pg_temp'
  as $$
begin
  if exists (select 1 from public.persons p where p.id = new.person_id and p.service_identity)
     and not exists (select 1 from public.service_identities s
                     where s.person_id = new.person_id and s.jurisdiction_id = new.jurisdiction_id
                       and s.role = new.role) then
    raise exception 'a service identity holds only the membership it was created with' using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger service_identity_membership before insert or update on public.jurisdiction_memberships
  for each row execute function public.check_service_identity_membership();

-- Sign-in and password change look accounts up here; a backing row is never found.
create or replace function public.find_person_by_email(addr text)
  returns table (id uuid, password_hash text, disabled boolean)
  language sql security definer
  set search_path to 'pg_catalog', 'public', 'pg_temp'
  as $$
  -- Columns are alias-qualified so they resolve to the table, not the
  -- same-named RETURNS TABLE output parameters (which would be ambiguous).
  select p.id, p.password_hash, p.disabled from public.persons p
  where lower(p.email) = lower(addr) and not p.service_identity
$$;

-- 0113's function, now refusing to enable the backing row of an identity
-- that is revoked, expired or without its creator, so background work
-- cannot be brought back that way.
create or replace function public.set_person_disabled(pid uuid, value boolean)
  returns void
  language plpgsql security definer
  set search_path to 'pg_catalog', 'public', 'pg_temp'
  as $$
begin
  if not public.may_administer_person(pid) then
    raise exception 'not permitted to administer this person' using errcode = '42501';
  end if;
  if not value and public.service_identity_stopped(pid) is not null then
    raise exception 'a service identity that is revoked, expired or without its creator cannot be enabled'
      using errcode = '42501';
  end if;
  update public.persons set disabled = value where id = pid;
end
$$;

-- 0124's work discovery for scheduled reports, now skipping an owner that is
-- a service identity which may not act.
create or replace function public.reports_due(due_at timestamptz)
  returns table (report_id uuid, person_id uuid)
  language sql stable security definer
  set search_path to 'pg_catalog', 'public', 'pg_temp'
  as $$
  select r.id, r.created_by
  from public.reports r
  join public.persons p on p.id = r.created_by and not p.disabled
  join public.jurisdiction_memberships m
    on m.person_id = r.created_by and m.jurisdiction_id = r.jurisdiction_id
   and m.role in ('admin', 'member')
  where r.next_run_at <= reports_due.due_at
    and public.service_identity_stopped(r.created_by) is null
  order by r.next_run_at, r.id
$$;

revoke all on function public.service_identity_stopped(uuid) from public;
revoke all on function public.service_identity_credential(uuid, text) from public;
revoke all on function public.revoke_service_identity(uuid) from public;
revoke all on function public.refuse_service_identity_person() from public;
revoke all on function public.check_service_identity_membership() from public;
grant execute on function public.service_identity_stopped(uuid) to app_runtime;
grant execute on function public.service_identity_credential(uuid, text) to app_runtime;
grant execute on function public.revoke_service_identity(uuid) to app_runtime;
