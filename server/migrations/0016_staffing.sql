-- Check-in, staffing, and scheduling (VEOC-24, F-staffing). Check-ins are
-- bound to positions and feed the activity log. Badge tokens drive scan
-- check-in for speed under load; a client_checkin_id makes a replayed
-- offline scan idempotent so it reconciles to exactly one row.

create table badges (
  id uuid primary key default gen_random_uuid(),
  jurisdiction_id uuid not null references jurisdictions (id),
  person_id uuid not null references persons (id),
  token_hash text not null unique,
  label text,
  issued_by uuid not null references persons (id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index badges_jurisdiction on badges (jurisdiction_id);

create table staff_checkins (
  id uuid primary key default gen_random_uuid(),
  jurisdiction_id uuid not null references jurisdictions (id),
  incident_id uuid references incidents (id),
  person_id uuid not null references persons (id),
  position_id uuid not null references positions (id),
  method text not null check (method in ('manual', 'scan')),
  client_checkin_id text,
  checked_in_at timestamptz not null default now(),
  checked_out_at timestamptz,
  checked_in_by uuid not null references persons (id),
  created_at timestamptz not null default now(),
  unique (jurisdiction_id, client_checkin_id)
);
create index staff_checkins_open
  on staff_checkins (jurisdiction_id, position_id) where checked_out_at is null;

create table shifts (
  id uuid primary key default gen_random_uuid(),
  jurisdiction_id uuid not null references jurisdictions (id),
  incident_id uuid references incidents (id),
  position_id uuid not null references positions (id),
  person_id uuid references persons (id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  note text,
  created_by uuid not null references persons (id),
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index shifts_window on shifts (jurisdiction_id, starts_at, ends_at);

grant select, insert, update on badges to app_runtime;
grant select, insert, update on staff_checkins to app_runtime;
grant select, insert, update on shifts to app_runtime;

alter table badges enable row level security;
create policy badges_read on badges for select using (is_member_of(jurisdiction_id));
create policy badges_write on badges for insert with check (is_admin_of(jurisdiction_id));
create policy badges_update on badges for update using (is_admin_of(jurisdiction_id));

alter table staff_checkins enable row level security;
create policy checkins_read on staff_checkins for select using (is_member_of(jurisdiction_id));
create policy checkins_write on staff_checkins for insert with check (is_writer_of(jurisdiction_id));
create policy checkins_update on staff_checkins for update using (is_writer_of(jurisdiction_id));

alter table shifts enable row level security;
create policy shifts_read on shifts for select using (is_member_of(jurisdiction_id));
create policy shifts_write on shifts for insert with check (is_writer_of(jurisdiction_id));
create policy shifts_update on shifts for update using (is_writer_of(jurisdiction_id));
