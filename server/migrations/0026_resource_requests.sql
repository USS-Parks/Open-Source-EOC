-- The 213RR resource lifecycle (VEOC-35, F5). A first-class resource request
-- with the NIMS ordering state machine, an append-only chronology, escalation
-- across federation tiers, and cost capture for reimbursement. The state
-- column is guarded in code by the dictionary transition table; the chronology
-- is never edited, only appended.

create table resource_requests (
  id uuid primary key default gen_random_uuid(),
  jurisdiction_id uuid not null references jurisdictions (id),
  incident_id uuid references incidents (id),
  origin text not null check (origin in ('field', 'eoc', 'escalated')),
  item text not null,
  quantity integer not null default 1,
  priority text not null default 'routine',
  state text not null default 'submitted',
  needed_by timestamptz,
  notes text,
  requested_by uuid not null references persons (id),
  assigned_position uuid references positions (id),
  -- When this request arrived by escalation from a peer tier.
  source_peer text,
  source_request_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index resource_requests_jurisdiction on resource_requests (jurisdiction_id, created_at desc);

create table rr_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references resource_requests (id),
  from_state text,
  to_state text not null,
  note text,
  actor_person uuid references persons (id),
  actor_peer text,
  at timestamptz not null default now()
);
create index rr_events_request on rr_events (request_id, at);

create table rr_costs (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references resource_requests (id),
  category text not null,
  description text not null default '',
  amount_cents integer not null,
  incurred_at date not null default current_date,
  recorded_by uuid not null references persons (id),
  created_at timestamptz not null default now()
);
create index rr_costs_request on rr_costs (request_id);

grant select, insert, update on resource_requests to app_runtime;
grant select, insert on rr_events to app_runtime;
grant select, insert on rr_costs to app_runtime;

alter table resource_requests enable row level security;
create policy rr_read on resource_requests for select
  using (is_member_of(jurisdiction_id));
create policy rr_write on resource_requests for insert
  with check (is_member_of(jurisdiction_id));
create policy rr_update on resource_requests for update
  using (is_member_of(jurisdiction_id));

alter table rr_events enable row level security;
create policy rr_events_read on rr_events for select
  using (exists (select 1 from resource_requests r where r.id = request_id
                 and is_member_of(r.jurisdiction_id)));
create policy rr_events_write on rr_events for insert
  with check (exists (select 1 from resource_requests r where r.id = request_id
                      and is_member_of(r.jurisdiction_id)));

alter table rr_costs enable row level security;
create policy rr_costs_read on rr_costs for select
  using (exists (select 1 from resource_requests r where r.id = request_id
                 and is_member_of(r.jurisdiction_id)));
create policy rr_costs_write on rr_costs for insert
  with check (exists (select 1 from resource_requests r where r.id = request_id
                      and is_member_of(r.jurisdiction_id)));
