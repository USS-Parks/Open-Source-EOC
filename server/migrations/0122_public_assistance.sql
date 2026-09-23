-- Public Assistance damage inventory for the preliminary damage assessment.
--
-- One row is one line item: an applicant (a public entity or an eligible
-- private nonprofit), a FEMA PA work category A to G, the site, the work and
-- its estimated cost. The category is checked against the doctrinal
-- dictionary by the application, as damage degrees are. Submitted and
-- reviewed items count toward the declaration summary; drafts do not.
-- Line items are records: nothing purges them.

create table public.damage_pa_items (
  id uuid primary key default gen_random_uuid(),
  jurisdiction_id uuid not null references public.jurisdictions(id),
  incident_id uuid references public.incidents(id),
  applicant text not null,
  category text not null,
  site text,
  description text not null default '',
  estimated_cost_cents bigint not null check (estimated_cost_cents >= 0),
  insured boolean,
  percent_complete smallint not null default 0 check (percent_complete between 0 and 100),
  status text not null default 'submitted' check (status in ('draft', 'submitted', 'reviewed')),
  geom public.geometry(Point, 4326),
  created_by uuid not null references public.persons(id),
  created_at timestamptz not null default now(),
  updated_by uuid not null references public.persons(id),
  updated_at timestamptz not null default now()
);

create index damage_pa_items_page
  on public.damage_pa_items (jurisdiction_id, created_at desc, id desc);

alter table public.damage_pa_items enable row level security;

create policy damage_pa_items_read on public.damage_pa_items
  for select using (public.is_member_of(jurisdiction_id));
create policy damage_pa_items_insert on public.damage_pa_items
  for insert with check (public.is_writer_of(jurisdiction_id));
create policy damage_pa_items_update on public.damage_pa_items
  for update using (public.is_writer_of(jurisdiction_id))
  with check (public.is_writer_of(jurisdiction_id));

grant select, insert, update on table public.damage_pa_items to app_runtime;
