-- Immutable audit substrate (VEOC-11, INV-2).
-- Three walls against history rewrite: the runtime role holds no UPDATE or
-- DELETE privilege on audit_events; a trigger rejects UPDATE/DELETE from
-- any role including the owner; RLS scopes reads and binds inserts to the
-- acting person. Corrections are new rows referencing the original.

create table audit_events (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  jurisdiction_id uuid not null references jurisdictions (id),
  incident_id uuid, -- references incidents(id) once VEOC-12 creates them
  person_id uuid not null references persons (id),
  position_id uuid references positions (id),
  category text not null,
  subject_table text,
  subject_id uuid,
  payload jsonb not null default '{}',
  corrects uuid references audit_events (id),
  created_at timestamptz not null default now()
);
create index audit_events_jurisdiction_seq on audit_events (jurisdiction_id, seq);
create index audit_events_position on audit_events (position_id) where position_id is not null;

-- Wall 1: privilege. The runtime role can read and append, nothing else.
grant select, insert on audit_events to app_runtime;
revoke update, delete on audit_events from app_runtime;

-- Wall 2: trigger. Even the table owner cannot rewrite or remove history
-- without first dropping this trigger, which is itself an auditable DDL act.
create function audit_events_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'audit_events is append-only: % is not permitted', tg_op;
end $$;

create trigger audit_events_no_update
  before update or delete on audit_events
  for each row execute function audit_events_immutable();

-- Wall 3: RLS. Reads are jurisdiction-scoped; an insert must be the acting
-- person's own entry inside a jurisdiction they belong to.
alter table audit_events enable row level security;
create policy audit_read on audit_events for select
  using (is_member_of(jurisdiction_id));
create policy audit_append on audit_events for insert
  with check (person_id = current_person() and is_member_of(jurisdiction_id));
