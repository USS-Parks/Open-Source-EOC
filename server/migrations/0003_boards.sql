-- Board engine (VEOC-09).

create table board_templates (
  key text not null,
  version integer not null,
  title text not null,
  definition jsonb not null,
  created_at timestamptz not null default now(),
  primary key (key, version)
);

create table boards (
  id uuid primary key default gen_random_uuid(),
  jurisdiction_id uuid not null references jurisdictions (id),
  template_key text not null,
  template_version integer not null,
  title text not null,
  local_fields jsonb not null default '[]',
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  foreign key (template_key, template_version) references board_templates (key, version)
);

create table board_records (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references boards (id),
  data jsonb not null,
  created_by uuid not null references persons (id),
  created_by_position uuid references positions (id),
  created_at timestamptz not null default now(),
  updated_by uuid references persons (id),
  updated_at timestamptz
);
create index board_records_board on board_records (board_id, created_at desc);

grant select, insert, update on board_templates, boards, board_records to app_runtime;

-- Membership roles that may write records (viewers and guests read only).
create function is_writer_of(jid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from jurisdiction_memberships
    where person_id = current_person() and jurisdiction_id = jid
      and role in ('admin', 'member'))
$$;

-- Templates are instance-level: readable by any authenticated principal,
-- writable only by instance admins.
alter table board_templates enable row level security;
create policy templates_read on board_templates for select
  using (current_person() is not null);
create policy templates_write on board_templates for insert
  with check (is_instance_admin());

alter table boards enable row level security;
create policy boards_read on boards for select
  using (is_member_of(jurisdiction_id)
         or has_guest_scope(jurisdiction_id, 'board:' || id::text || ':read'));
create policy boards_write on boards for insert
  with check (is_admin_of(jurisdiction_id));
create policy boards_update on boards for update
  using (is_admin_of(jurisdiction_id));

alter table board_records enable row level security;
create policy records_read on board_records for select
  using (exists (
    select 1 from boards b where b.id = board_id
      and (is_member_of(b.jurisdiction_id)
           or has_guest_scope(b.jurisdiction_id, 'board:' || b.id::text || ':read'))));
create policy records_write on board_records for insert
  with check (exists (
    select 1 from boards b where b.id = board_id and is_writer_of(b.jurisdiction_id)));
create policy records_update on board_records for update
  using (exists (
    select 1 from boards b where b.id = board_id and is_writer_of(b.jurisdiction_id)));
