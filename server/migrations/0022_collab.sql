-- Collaboration adapters and incident spaces (VEOC-32, F15/R6). A backend
-- (Mattermost or Matrix) is integrated strictly across a process boundary
-- over its HTTP API; nothing from those systems is vendored. One backend
-- may be configured per jurisdiction, disabled by default until credentials
-- exist. Incident activation provisions a space with a channel per ICS
-- section; the mirror of desired membership lives here so sync is a diff and
-- the structure is auditable. With no backend configured the platform still
-- runs (INV-3): provisioning and announcements degrade to in-app
-- notifications, and these tables simply stay empty.

create table collab_backends (
  jurisdiction_id uuid primary key references jurisdictions (id),
  kind text not null check (kind in ('mattermost', 'matrix')),
  base_url text not null,
  token_envelope text,
  homeserver text,
  enabled boolean not null default false,
  updated_by uuid references persons (id),
  updated_at timestamptz not null default now()
);

create table collab_spaces (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references incidents (id) unique,
  backend_kind text not null,
  remote_space_id text not null,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_by uuid not null references persons (id),
  created_at timestamptz not null default now(),
  archived_at timestamptz
);

create table collab_channels (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references collab_spaces (id),
  section text not null,
  name text not null,
  remote_channel_id text not null,
  created_at timestamptz not null default now(),
  unique (space_id, section)
);

create table collab_channel_members (
  channel_id uuid not null references collab_channels (id),
  person_id uuid not null references persons (id),
  added_at timestamptz not null default now(),
  primary key (channel_id, person_id)
);

grant select, insert, update on collab_backends to app_runtime;
grant select, insert, update on collab_spaces to app_runtime;
grant select, insert, update on collab_channels to app_runtime;
grant select, insert, delete on collab_channel_members to app_runtime;

alter table collab_backends enable row level security;
create policy collab_backends_read on collab_backends for select
  using (is_member_of(jurisdiction_id));
create policy collab_backends_insert on collab_backends for insert
  with check (is_admin_of(jurisdiction_id));
create policy collab_backends_update on collab_backends for update
  using (is_admin_of(jurisdiction_id));

alter table collab_spaces enable row level security;
create policy collab_spaces_read on collab_spaces for select
  using (exists (select 1 from incidents i where i.id = incident_id
                 and is_member_of(i.jurisdiction_id)));
create policy collab_spaces_write on collab_spaces for insert
  with check (exists (select 1 from incidents i where i.id = incident_id
                      and is_admin_of(i.jurisdiction_id)));
create policy collab_spaces_update on collab_spaces for update
  using (exists (select 1 from incidents i where i.id = incident_id
                 and is_admin_of(i.jurisdiction_id)));

alter table collab_channels enable row level security;
create policy collab_channels_read on collab_channels for select
  using (exists (select 1 from collab_spaces s join incidents i on i.id = s.incident_id
                 where s.id = space_id and is_member_of(i.jurisdiction_id)));
create policy collab_channels_write on collab_channels for insert
  with check (exists (select 1 from collab_spaces s join incidents i on i.id = s.incident_id
                      where s.id = space_id and is_admin_of(i.jurisdiction_id)));
create policy collab_channels_update on collab_channels for update
  using (exists (select 1 from collab_spaces s join incidents i on i.id = s.incident_id
                 where s.id = space_id and is_admin_of(i.jurisdiction_id)));

alter table collab_channel_members enable row level security;
create policy collab_members_read on collab_channel_members for select
  using (exists (
    select 1 from collab_channels c join collab_spaces s on s.id = c.space_id
    join incidents i on i.id = s.incident_id
    where c.id = channel_id and is_member_of(i.jurisdiction_id)));
create policy collab_members_write on collab_channel_members for insert
  with check (exists (
    select 1 from collab_channels c join collab_spaces s on s.id = c.space_id
    join incidents i on i.id = s.incident_id
    where c.id = channel_id and is_admin_of(i.jurisdiction_id)));
create policy collab_members_delete on collab_channel_members for delete
  using (exists (
    select 1 from collab_channels c join collab_spaces s on s.id = c.space_id
    join incidents i on i.id = s.incident_id
    where c.id = channel_id and is_admin_of(i.jurisdiction_id)));
