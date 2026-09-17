-- Native messaging (VEOC-15A, R6). Threads and messages are operational
-- record, not ephemeral chat: messages are append-only for the runtime
-- (no update ever; deletion only as an out-of-band records-schedule act by
-- the database owner, documented in the deployment guide). Position
-- membership resolves to whoever holds an active assignment at READ time,
-- so a seat's thread history follows the seat across shift changes.

create table jurisdiction_settings (
  jurisdiction_id uuid primary key references jurisdictions (id),
  message_retention_days integer,
  messages_in_incident_record boolean not null default true,
  updated_by uuid references persons (id),
  updated_at timestamptz not null default now()
);
grant select, insert, update on jurisdiction_settings to app_runtime;
alter table jurisdiction_settings enable row level security;
create policy settings_read on jurisdiction_settings for select
  using (is_member_of(jurisdiction_id));
create policy settings_write on jurisdiction_settings for insert
  with check (is_admin_of(jurisdiction_id));
create policy settings_update on jurisdiction_settings for update
  using (is_admin_of(jurisdiction_id));

create table threads (
  id uuid primary key default gen_random_uuid(),
  jurisdiction_id uuid not null references jurisdictions (id),
  kind text not null check (kind in ('direct', 'group')),
  incident_id uuid references incidents (id),
  title text not null default '',
  created_by uuid not null references persons (id),
  created_at timestamptz not null default now()
);

create table thread_members (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references threads (id),
  member_kind text not null check (member_kind in ('person', 'position')),
  person_id uuid references persons (id),
  position_id uuid references positions (id),
  added_by uuid not null references persons (id),
  added_at timestamptz not null default now(),
  removed_at timestamptz,
  check ((member_kind = 'person') = (person_id is not null)),
  check ((member_kind = 'position') = (position_id is not null))
);
create index thread_members_thread on thread_members (thread_id) where removed_at is null;

create table messages (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  thread_id uuid not null references threads (id),
  client_message_id text,
  sender_person uuid not null references persons (id),
  sender_position uuid references positions (id),
  body text not null,
  created_at timestamptz not null default now()
);
create index messages_thread_seq on messages (thread_id, seq);
-- Offline-queue idempotence: a client retry of the same message is one row.
create unique index messages_client_dedupe
  on messages (thread_id, sender_person, client_message_id)
  where client_message_id is not null;

grant select, insert on threads, thread_members, messages to app_runtime;
grant update on thread_members to app_runtime;
revoke update, delete on messages from app_runtime;
create trigger messages_no_update
  before update on messages
  for each row execute function audit_events_immutable();

-- Membership resolution: a person participates when they are a person
-- member, or hold an ACTIVE assignment to a position member.
create function is_thread_participant(tid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from thread_members m
    where m.thread_id = tid and m.removed_at is null
      and ((m.member_kind = 'person' and m.person_id = current_person())
        or (m.member_kind = 'position' and exists (
              select 1 from position_assignments a
              where a.position_id = m.position_id
                and a.person_id = current_person() and a.revoked_at is null))))
$$;

alter table threads enable row level security;
-- created_by visibility also lets INSERT ... RETURNING pass SELECT policy
-- evaluation before the creator's member row exists one statement later.
create policy threads_read on threads for select
  using (is_thread_participant(id) or created_by = current_person()
         or is_admin_of(jurisdiction_id));
create policy threads_write on threads for insert
  with check (is_member_of(jurisdiction_id) and created_by = current_person());

alter table thread_members enable row level security;
create policy members_read on thread_members for select
  using (is_thread_participant(thread_id)
         or exists (select 1 from threads t where t.id = thread_id
                    and is_admin_of(t.jurisdiction_id)));
create policy members_write on thread_members for insert
  with check (exists (select 1 from threads t where t.id = thread_id
                      and is_member_of(t.jurisdiction_id))
              and (is_thread_participant(thread_id) or added_by = current_person()));
create policy members_remove on thread_members for update
  using (is_thread_participant(thread_id)
         or exists (select 1 from threads t where t.id = thread_id
                    and is_admin_of(t.jurisdiction_id)));

alter table messages enable row level security;
create policy messages_read on messages for select
  using (is_thread_participant(thread_id));
create policy messages_write on messages for insert
  with check (sender_person = current_person() and is_thread_participant(thread_id));
