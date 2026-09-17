-- Damage assessment with pre-disaster baseline (VEOC-23, F8/F9).
-- Baselines are the pre-loaded jurisdiction inventory; assessments are
-- damage observations against that inventory. Public self-reports land in
-- the same table but quarantined by status, so they can never pollute the
-- assessed record until a moderator approves them.

create table damage_baselines (
  id uuid primary key default gen_random_uuid(),
  jurisdiction_id uuid not null references jurisdictions (id),
  parcel_id text not null,
  address text not null,
  structure_type text not null,
  replacement_value numeric(14, 2) not null default 0,
  geom geometry(Point, 4326),
  imported_at timestamptz not null default now(),
  imported_by uuid not null references persons (id),
  unique (jurisdiction_id, parcel_id)
);
create index damage_baselines_jurisdiction on damage_baselines (jurisdiction_id);

create table damage_assessments (
  id uuid primary key default gen_random_uuid(),
  jurisdiction_id uuid not null references jurisdictions (id),
  baseline_id uuid references damage_baselines (id),
  address text not null,
  structure_type text not null,
  degree text not null,
  ownership text,
  insured boolean,
  estimated_loss numeric(14, 2) not null default 0,
  source text not null check (source in ('official', 'public')),
  status text not null check (status in ('submitted', 'approved', 'rejected')),
  notes text,
  geom geometry(Point, 4326),
  reporter_contact text,
  assessed_by uuid references persons (id),
  moderated_by uuid references persons (id),
  created_at timestamptz not null default now(),
  moderated_at timestamptz
);
create index damage_assessments_jurisdiction
  on damage_assessments (jurisdiction_id, status);

-- Public-intake configuration: an admin enables it and gets a token to
-- publish; submissions run under the enabling owner's authority (like a
-- feed's creator) but land quarantined by status.
create table damage_intake (
  jurisdiction_id uuid primary key references jurisdictions (id),
  token_hash text not null,
  owner_person uuid not null references persons (id),
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

grant select, insert, update on damage_baselines to app_runtime;
grant select, insert, update on damage_assessments to app_runtime;
grant select, insert, update on damage_intake to app_runtime;

alter table damage_intake enable row level security;
create policy intake_read on damage_intake for select
  using (is_member_of(jurisdiction_id) or current_person() is null);
create policy intake_write on damage_intake for insert
  with check (is_admin_of(jurisdiction_id));
create policy intake_update on damage_intake for update
  using (is_admin_of(jurisdiction_id));

alter table damage_baselines enable row level security;
create policy baselines_read on damage_baselines for select
  using (is_member_of(jurisdiction_id));
create policy baselines_write on damage_baselines for insert
  with check (is_admin_of(jurisdiction_id));

alter table damage_assessments enable row level security;
create policy assessments_read on damage_assessments for select
  using (is_member_of(jurisdiction_id));
-- Writers create official assessments and land moderated public intake;
-- the status column, not the write policy, is what quarantines a report.
create policy assessments_write on damage_assessments for insert
  with check (is_writer_of(jurisdiction_id));
create policy assessments_moderate on damage_assessments for update
  using (is_writer_of(jurisdiction_id));
