-- Identity, jurisdictions, positions, sessions (VEOC-07).
-- Audit-grade tables (position_signins) are append-only by policy; the
-- database-level enforcement (revoked grants, RLS) lands with VEOC-08/11.

create table jurisdictions (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  created_at timestamptz not null default now()
);

create table persons (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  display_name text not null,
  password_hash text not null,
  disabled boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index persons_email_lower on persons (lower(email));

create table jurisdiction_memberships (
  person_id uuid not null references persons (id),
  jurisdiction_id uuid not null references jurisdictions (id),
  role text not null check (role in ('admin', 'member', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (person_id, jurisdiction_id)
);

create table positions (
  id uuid primary key default gen_random_uuid(),
  jurisdiction_id uuid not null references jurisdictions (id),
  key text not null,
  title text not null,
  created_at timestamptz not null default now(),
  unique (jurisdiction_id, key)
);

create table position_assignments (
  id uuid primary key default gen_random_uuid(),
  position_id uuid not null references positions (id),
  person_id uuid not null references persons (id),
  assigned_by uuid not null references persons (id),
  assigned_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references persons (id)
);
create unique index position_assignments_active
  on position_assignments (position_id, person_id)
  where revoked_at is null;

create table auth_sessions (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references persons (id),
  access_hash text not null unique,
  resume_hash text not null unique,
  access_expires_at timestamptz not null,
  active_position_id uuid references positions (id),
  created_at timestamptz not null default now(),
  resumed_at timestamptz,
  ended_at timestamptz
);

-- Position sign-in chronology: who held which seat, when. Append-only.
create table position_signins (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references auth_sessions (id),
  person_id uuid not null references persons (id),
  position_id uuid not null references positions (id),
  signed_in_at timestamptz not null default now(),
  signed_out_at timestamptz
);
