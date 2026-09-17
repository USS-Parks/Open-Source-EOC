-- CAP 1.2 alerts (VEOC-26, F20/INV-4). Authored and ingested alerts are
-- stored with both their structured form and their CAP XML, so the record
-- is standards-native on the way in and the way out. Actual IPAWS
-- transmission is enable-at-will and lands at VEOC-31; eligibility is
-- computed and recorded here.

create table cap_alerts (
  id uuid primary key default gen_random_uuid(),
  jurisdiction_id uuid not null references jurisdictions (id),
  incident_id uuid references incidents (id),
  identifier text not null,
  origin text not null check (origin in ('authored', 'ingested')),
  status text not null,
  msg_type text not null,
  scope text not null,
  ipaws_eligible boolean not null default false,
  alert jsonb not null,
  xml text not null,
  created_by uuid not null references persons (id),
  created_at timestamptz not null default now(),
  unique (jurisdiction_id, identifier)
);
create index cap_alerts_jurisdiction on cap_alerts (jurisdiction_id, created_at desc);

grant select, insert on cap_alerts to app_runtime;

alter table cap_alerts enable row level security;
create policy cap_read on cap_alerts for select using (is_member_of(jurisdiction_id));
create policy cap_write on cap_alerts for insert with check (is_writer_of(jurisdiction_id));
