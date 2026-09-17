-- Situation reports (VEOC-20, F8). The archive is immutable: a sitrep is
-- the record of what the picture WAS; corrections are new sitreps.

create table sitreps (
  id uuid primary key default gen_random_uuid(),
  jurisdiction_id uuid not null references jurisdictions (id),
  incident_id uuid references incidents (id),
  period text not null,
  content jsonb not null,
  composed_by uuid not null references persons (id),
  composed_by_position uuid references positions (id),
  composed_at timestamptz not null default now()
);
create index sitreps_jurisdiction on sitreps (jurisdiction_id, composed_at desc);

grant select, insert on sitreps to app_runtime;

-- Same three walls as the audit substrate: no UPDATE/DELETE privilege for
-- the runtime role, the immutability trigger for everyone else, RLS.
create trigger sitreps_immutable
  before update or delete on sitreps
  for each row execute function audit_events_immutable();

alter table sitreps enable row level security;
create policy sitreps_read on sitreps for select
  using (is_member_of(jurisdiction_id));
create policy sitreps_write on sitreps for insert
  with check (is_writer_of(jurisdiction_id));
