-- Multi-factor authentication for local accounts.
--
-- person_mfa holds one TOTP secret per person, envelope-encrypted by the
-- application. It counts only once activated_at is set, which happens when
-- the person proves the authenticator with a first code. last_step is the
-- highest TOTP step accepted, so a code cannot be replayed.
--
-- mfa_recovery_codes holds single-use recovery codes as SHA-256 hashes.
--
-- mfa_challenges links a verified password to the second factor. The client
-- holds the token; only its hash is stored. 'verify' challenges complete a
-- sign-in for an enrolled person; 'enroll' challenges let a person who must
-- use MFA enroll before any session is issued.

create table public.person_mfa (
  person_id uuid primary key references public.persons(id),
  secret_envelope text not null,
  activated_at timestamptz,
  last_step bigint not null default 0,
  created_at timestamptz not null default now()
);

create table public.mfa_recovery_codes (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.persons(id),
  code_hash text not null,
  used_at timestamptz,
  unique (person_id, code_hash)
);

create table public.mfa_challenges (
  token_hash text primary key,
  person_id uuid not null references public.persons(id),
  purpose text not null check (purpose in ('verify', 'enroll')),
  expires_at timestamptz not null,
  used_at timestamptz
);

create index mfa_challenges_person on public.mfa_challenges (person_id);

alter table public.person_mfa enable row level security;
alter table public.mfa_recovery_codes enable row level security;
alter table public.mfa_challenges enable row level security;

-- Each person reaches only their own factor rows. The sign-in path binds the
-- person context only after the password has been verified.
create policy person_mfa_own on public.person_mfa
  for all using (person_id = public.current_person())
  with check (person_id = public.current_person());
create policy mfa_recovery_codes_own on public.mfa_recovery_codes
  for all using (person_id = public.current_person())
  with check (person_id = public.current_person());
create policy mfa_challenges_own on public.mfa_challenges
  for all using (person_id = public.current_person())
  with check (person_id = public.current_person());

grant select, insert, update on table public.person_mfa to app_runtime;
grant select, insert, update, delete on table public.mfa_recovery_codes to app_runtime;
grant select, insert, update, delete on table public.mfa_challenges to app_runtime;

-- A challenge is presented before any person context exists, so the token
-- hash is resolved to its person through this function alone. It returns
-- null for an unknown, used, expired or wrong-purpose token, or a disabled
-- person.
create function public.resolve_mfa_challenge(hash text, wanted text)
  returns uuid
  language sql security definer
  set search_path to 'pg_catalog', 'public', 'pg_temp'
  as $$
  select c.person_id from public.mfa_challenges c
  join public.persons p on p.id = c.person_id
  where c.token_hash = hash and c.purpose = wanted
    and c.used_at is null and c.expires_at > now() and not p.disabled
$$;

revoke all on function public.resolve_mfa_challenge(text, text) from public;
grant execute on function public.resolve_mfa_challenge(text, text) to app_runtime;
