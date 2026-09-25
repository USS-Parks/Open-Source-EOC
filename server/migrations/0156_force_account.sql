-- FEMA Public Assistance force account (VC-10).
--
-- The applicant's own labor and equipment on eligible work. Labor hours are
-- read from staff check-ins and shifts; this adds what costs them: each
-- person's labor rate (job title, regular and overtime rates, fringe and the
-- daily hours after which time is overtime), an equipment rate schedule
-- (FEMA's Schedule of Equipment Rates or local rates, imported by an
-- administrator, named by the edition it came from, and empty until then),
-- and a log of equipment hours against pool resources for an incident.
--
-- A Public Assistance line item a force account summary is rolled into keeps
-- the summary it was costed from and when, so its estimated cost can be
-- traced back to the rows. Wage rates are read by the jurisdiction's
-- administrators and members, not by viewers or guests.

create table public.pa_labor_rates (
  id uuid primary key default gen_random_uuid(),
  jurisdiction_id uuid not null references public.jurisdictions (id),
  person_id uuid not null references public.persons (id),
  job_title text not null check (length(job_title) between 1 and 200),
  hourly_rate numeric(12, 4) not null check (hourly_rate > 0),
  overtime_rate numeric(12, 4) check (overtime_rate > 0),
  fringe_percent numeric(6, 3) not null default 0 check (fringe_percent between 0 and 100),
  overtime_fringe_percent numeric(6, 3) check (overtime_fringe_percent between 0 and 100),
  overtime_after_hours numeric(5, 2) not null default 8 check (overtime_after_hours between 0 and 24),
  updated_by uuid not null references public.persons (id),
  updated_at timestamptz not null default now(),
  unique (jurisdiction_id, person_id)
);

create table public.pa_equipment_rates (
  id uuid primary key default gen_random_uuid(),
  jurisdiction_id uuid not null references public.jurisdictions (id),
  code text not null check (length(code) between 1 and 40),
  equipment text not null check (length(equipment) between 1 and 200),
  manufacturer text not null default '' check (length(manufacturer) <= 200),
  specification text not null default '' check (length(specification) <= 200),
  capacity text not null default '' check (length(capacity) <= 200),
  hp text not null default '' check (length(hp) <= 40),
  notes text not null default '' check (length(notes) <= 500),
  unit text not null default 'hour' check (length(unit) between 1 and 40),
  rate numeric(12, 4) not null check (rate >= 0),
  source text not null check (source in ('fema', 'local')),
  edition text not null check (length(edition) between 1 and 120),
  imported_by uuid not null references public.persons (id),
  imported_at timestamptz not null default now(),
  unique (jurisdiction_id, code)
);

create table public.pa_equipment_hours (
  id uuid primary key default gen_random_uuid(),
  jurisdiction_id uuid not null references public.jurisdictions (id),
  incident_id uuid not null references public.incidents (id),
  resource_id uuid references public.resources (id),
  rate_code text not null check (length(rate_code) between 1 and 40),
  operator_person_id uuid references public.persons (id),
  used_on date not null,
  quantity numeric(10, 2) not null check (quantity > 0),
  note text not null default '' check (length(note) <= 500),
  recorded_by uuid not null references public.persons (id),
  recorded_at timestamptz not null default now()
);
create index pa_equipment_hours_incident on public.pa_equipment_hours (incident_id, used_on, id);

alter table public.damage_pa_items
  add column force_account jsonb,
  add column force_account_at timestamptz,
  add constraint damage_pa_items_force_account check ((force_account is null) = (force_account_at is null));

alter table public.pa_labor_rates enable row level security;
alter table public.pa_equipment_rates enable row level security;
alter table public.pa_equipment_hours enable row level security;

create policy pa_labor_rates_read on public.pa_labor_rates
  for select using (public.is_writer_of(jurisdiction_id));
create policy pa_labor_rates_insert on public.pa_labor_rates
  for insert with check (public.is_admin_of(jurisdiction_id));
create policy pa_labor_rates_update on public.pa_labor_rates
  for update using (public.is_admin_of(jurisdiction_id)) with check (public.is_admin_of(jurisdiction_id));

create policy pa_equipment_rates_read on public.pa_equipment_rates
  for select using (public.is_member_of(jurisdiction_id));
create policy pa_equipment_rates_insert on public.pa_equipment_rates
  for insert with check (public.is_admin_of(jurisdiction_id));
create policy pa_equipment_rates_update on public.pa_equipment_rates
  for update using (public.is_admin_of(jurisdiction_id)) with check (public.is_admin_of(jurisdiction_id));

create policy pa_equipment_hours_read on public.pa_equipment_hours
  for select using (public.is_member_of(jurisdiction_id));
create policy pa_equipment_hours_insert on public.pa_equipment_hours
  for insert with check (public.is_writer_of(jurisdiction_id));
create policy pa_equipment_hours_delete on public.pa_equipment_hours
  for delete using (public.is_writer_of(jurisdiction_id));

grant select, insert, update on table public.pa_labor_rates to app_runtime;
grant select, insert, update on table public.pa_equipment_rates to app_runtime;
grant select, insert, delete on table public.pa_equipment_hours to app_runtime;
