-- Joint Information Center (VEOC-33A, R4). Public information is an
-- attributable, approvable record. A press release drafts, then routes
-- through a configurable multi-agency approval chain (local agencies and
-- federation peers alike); only an approved release publishes, to the public
-- feed, to CAP where applicable, and to the collaboration adapters. Media
-- inquiries are logged, assigned, and answered with a reference to the
-- approved language. The approval chain is immutable: decisions are appended,
-- never edited.

create table press_releases (
  id uuid primary key default gen_random_uuid(),
  jurisdiction_id uuid not null references jurisdictions (id),
  incident_id uuid references incidents (id),
  title text not null,
  body text not null,
  status text not null default 'draft'
    check (status in ('draft', 'pending', 'approved', 'published', 'rejected')),
  required_agencies text[] not null default '{}',
  cap_alert_id uuid references cap_alerts (id),
  created_by uuid not null references persons (id),
  created_by_position uuid references positions (id),
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  approved_at timestamptz,
  published_at timestamptz
);

create table press_release_approvals (
  id uuid primary key default gen_random_uuid(),
  release_id uuid not null references press_releases (id),
  agency text not null,
  decision text not null check (decision in ('approve', 'reject')),
  note text,
  decided_by_person uuid references persons (id),
  decided_by_peer text,
  decided_at timestamptz not null default now(),
  unique (release_id, agency)
);

create table press_release_publications (
  id uuid primary key default gen_random_uuid(),
  release_id uuid not null references press_releases (id),
  channel text not null,
  ref text,
  published_at timestamptz not null default now()
);

create table public_messages (
  id uuid primary key default gen_random_uuid(),
  jurisdiction_id uuid not null references jurisdictions (id),
  release_id uuid references press_releases (id),
  title text not null,
  body text not null,
  published_at timestamptz not null default now()
);
create index public_messages_jurisdiction on public_messages (jurisdiction_id, published_at desc);

create table media_inquiries (
  id uuid primary key default gen_random_uuid(),
  jurisdiction_id uuid not null references jurisdictions (id),
  incident_id uuid references incidents (id),
  outlet text not null,
  subject text not null,
  question text not null,
  status text not null default 'open' check (status in ('open', 'assigned', 'answered')),
  assigned_position uuid references positions (id),
  response_release_id uuid references press_releases (id),
  answered_by uuid references persons (id),
  answered_at timestamptz,
  created_by uuid not null references persons (id),
  created_at timestamptz not null default now()
);
create index media_inquiries_jurisdiction on media_inquiries (jurisdiction_id, created_at desc);

grant select, insert, update on press_releases to app_runtime;
grant select, insert on press_release_approvals to app_runtime;
grant select, insert on press_release_publications to app_runtime;
grant select, insert on public_messages to app_runtime;
grant select, insert, update on media_inquiries to app_runtime;

alter table press_releases enable row level security;
create policy press_releases_read on press_releases for select
  using (is_member_of(jurisdiction_id));
create policy press_releases_write on press_releases for insert
  with check (is_member_of(jurisdiction_id));
create policy press_releases_update on press_releases for update
  using (is_member_of(jurisdiction_id));

alter table press_release_approvals enable row level security;
create policy approvals_read on press_release_approvals for select
  using (exists (select 1 from press_releases r where r.id = release_id
                 and is_member_of(r.jurisdiction_id)));
create policy approvals_write on press_release_approvals for insert
  with check (exists (select 1 from press_releases r where r.id = release_id
                      and is_member_of(r.jurisdiction_id)));

alter table press_release_publications enable row level security;
create policy publications_read on press_release_publications for select
  using (exists (select 1 from press_releases r where r.id = release_id
                 and is_member_of(r.jurisdiction_id)));
create policy publications_write on press_release_publications for insert
  with check (exists (select 1 from press_releases r where r.id = release_id
                      and is_member_of(r.jurisdiction_id)));

alter table public_messages enable row level security;
create policy public_messages_read on public_messages for select
  using (is_member_of(jurisdiction_id));
create policy public_messages_write on public_messages for insert
  with check (is_member_of(jurisdiction_id));

alter table media_inquiries enable row level security;
create policy media_inquiries_read on media_inquiries for select
  using (is_member_of(jurisdiction_id));
create policy media_inquiries_write on media_inquiries for insert
  with check (is_member_of(jurisdiction_id));
create policy media_inquiries_update on media_inquiries for update
  using (is_member_of(jurisdiction_id));
