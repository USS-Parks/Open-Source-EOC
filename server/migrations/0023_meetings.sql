-- Meetings and briefing bridges (VEOC-33, F15/R4). A one-click video bridge
-- per incident or ICS section via Jitsi, reached the same way the other
-- adapters are: across a process boundary, by minting a room URL (and, when
-- a JWT secret is configured, a signed token that scopes the room to the
-- incident audience). No Jitsi code is vendored. Briefings are scheduled
-- items that, when due, notify the incident's holders through the VEOC-14
-- notifications substrate. The Jitsi secret is stored only as an envelope.

create table meeting_config (
  jurisdiction_id uuid primary key references jurisdictions (id),
  base_url text not null,
  app_id text,
  secret_envelope text,
  enabled boolean not null default false,
  updated_by uuid references persons (id),
  updated_at timestamptz not null default now()
);

create table meetings (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references incidents (id),
  section text not null default 'incident',
  room text not null,
  created_by uuid not null references persons (id),
  created_at timestamptz not null default now(),
  unique (incident_id, section)
);

create table briefings (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references incidents (id),
  title text not null,
  section text,
  scheduled_at timestamptz not null,
  notified_at timestamptz,
  created_by uuid not null references persons (id),
  created_at timestamptz not null default now()
);
create index briefings_due on briefings (scheduled_at) where notified_at is null;

grant select, insert, update on meeting_config to app_runtime;
grant select, insert, update on meetings to app_runtime;
grant select, insert, update on briefings to app_runtime;

alter table meeting_config enable row level security;
create policy meeting_config_read on meeting_config for select
  using (is_member_of(jurisdiction_id));
create policy meeting_config_insert on meeting_config for insert
  with check (is_admin_of(jurisdiction_id));
create policy meeting_config_update on meeting_config for update
  using (is_admin_of(jurisdiction_id));

alter table meetings enable row level security;
create policy meetings_read on meetings for select
  using (exists (select 1 from incidents i where i.id = incident_id
                 and is_member_of(i.jurisdiction_id)));
create policy meetings_write on meetings for insert
  with check (exists (select 1 from incidents i where i.id = incident_id
                      and is_member_of(i.jurisdiction_id)));
create policy meetings_update on meetings for update
  using (exists (select 1 from incidents i where i.id = incident_id
                 and is_member_of(i.jurisdiction_id)));

alter table briefings enable row level security;
create policy briefings_read on briefings for select
  using (exists (select 1 from incidents i where i.id = incident_id
                 and is_member_of(i.jurisdiction_id)));
create policy briefings_write on briefings for insert
  with check (exists (select 1 from incidents i where i.id = incident_id
                      and is_member_of(i.jurisdiction_id)));
create policy briefings_update on briefings for update
  using (exists (select 1 from incidents i where i.id = incident_id
                 and is_member_of(i.jurisdiction_id)));
