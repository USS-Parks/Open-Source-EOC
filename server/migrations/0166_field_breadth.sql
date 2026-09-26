-- Field breadth (AG-07).
--
-- late_submissions holds work a device queued against an incident that was
-- closed by the time it arrived: a board edit, a message, a new task or a task
-- completion. It is never applied to the closed incident and never dropped.
-- The incident's owner administrators read it, attributed to the person who
-- sent it, and accept it (which applies it as its sender once the incident is
-- open again) or refuse it with a reason. A row keeps what was submitted; only
-- the decision is written, once.
--
-- field_operations makes a queued message, task or task completion exactly
-- once: a retry of an operation its sender already delivered returns the
-- first receipt.

create table public.late_submissions (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents (id),
  jurisdiction_id uuid not null references public.jurisdictions (id),
  kind text not null check (kind in ('board', 'message', 'task', 'task_completion')),
  operation_id uuid not null,
  request_digest text not null check (length(request_digest) = 64),
  payload jsonb not null,
  summary text not null check (length(summary) between 1 and 500),
  detail jsonb not null default '{}'::jsonb,
  submitted_by uuid not null references public.persons (id),
  submitted_position uuid references public.positions (id),
  -- When the device queued it, by the device's clock.
  captured_at timestamptz,
  received_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'refused')),
  decided_by uuid references public.persons (id),
  decided_at timestamptz,
  reason text check (reason is null or length(reason) between 1 and 1000),
  unique (submitted_by, operation_id),
  check ((status = 'pending') = (decided_at is null)),
  check ((status = 'pending') = (decided_by is null)),
  check (status <> 'refused' or reason is not null)
);
create index late_submissions_incident on public.late_submissions (incident_id, received_at desc);

create function public.guard_late_submission() returns trigger
  language plpgsql
  as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'late submissions are kept';
  end if;
  if old.status <> 'pending' then
    raise exception 'a late submission is decided once';
  end if;
  if row(new.id, new.incident_id, new.jurisdiction_id, new.kind, new.operation_id, new.request_digest,
         new.payload, new.summary, new.detail, new.submitted_by, new.submitted_position,
         new.captured_at, new.received_at)
     is distinct from
     row(old.id, old.incident_id, old.jurisdiction_id, old.kind, old.operation_id, old.request_digest,
         old.payload, old.summary, old.detail, old.submitted_by, old.submitted_position,
         old.captured_at, old.received_at) then
    raise exception 'a late submission keeps what was submitted';
  end if;
  return new;
end $$;
create trigger late_submissions_guard before update or delete on public.late_submissions
  for each row execute function public.guard_late_submission();

-- Every administrator of the owning organization hears of it in the console,
-- whoever sent it; a partner participant may not write the owner's notices.
create function public.announce_late_submission() returns trigger
  language plpgsql security definer
  set search_path to 'pg_catalog', 'public', 'pg_temp'
  as $$
begin
  insert into public.notifications
    (jurisdiction_id, person_id, incident_id, channel, title, body, status, detail)
  select new.jurisdiction_id, m.person_id, new.incident_id, 'late_submission',
    'Late submission for ' || i.name,
    sender.display_name || ' sent work to ' || i.name || ' after it closed: ' || new.summary
      || '. Accept or refuse it in the incident''s setup, under Late submissions.',
    'delivered', jsonb_build_object('lateSubmissionId', new.id, 'route', '#/incidents')
  from public.jurisdiction_memberships m
  join public.persons administrator on administrator.id = m.person_id and not administrator.disabled
  join public.incidents i on i.id = new.incident_id
  join public.persons sender on sender.id = new.submitted_by
  where m.jurisdiction_id = new.jurisdiction_id and m.role = 'admin';
  return new;
end $$;
create trigger late_submissions_announce after insert on public.late_submissions
  for each row execute function public.announce_late_submission();

alter table public.late_submissions enable row level security;

-- Sent by its author, only to a closed incident of the owner it names, and
-- only by someone who may contribute to that incident.
create policy late_submissions_submit on public.late_submissions
  for insert with check (
    submitted_by = public.current_person() and status = 'pending'
    and exists (
      select 1 from public.incidents i
      where i.id = late_submissions.incident_id and i.jurisdiction_id = late_submissions.jurisdiction_id
        and i.closed_at is not null
        and (public.is_writer_of(i.jurisdiction_id) or public.has_incident_participation(i.id, 'contributor'))));
create policy late_submissions_read on public.late_submissions
  for select using (public.is_admin_of(jurisdiction_id) or submitted_by = public.current_person());
create policy late_submissions_decide on public.late_submissions
  for update using (public.is_admin_of(jurisdiction_id))
  with check (public.is_admin_of(jurisdiction_id) and decided_by = public.current_person());

grant select, insert, update on table public.late_submissions to app_runtime;

create table public.field_operations (
  person_id uuid not null references public.persons (id),
  operation_id uuid not null,
  incident_id uuid not null references public.incidents (id),
  kind text not null check (kind in ('message', 'task', 'task_completion')),
  request_digest text not null check (length(request_digest) = 64),
  receipt jsonb not null,
  created_at timestamptz not null default now(),
  primary key (person_id, operation_id)
);

alter table public.field_operations enable row level security;

create policy field_operations_own on public.field_operations
  for all using (person_id = public.current_person()) with check (person_id = public.current_person());

grant select, insert on table public.field_operations to app_runtime;

-- Whether a record id a writer sent is taken on this board and incident by a
-- record its read rule hides from them, so the sync hub can make the write a
-- conflict of theirs. It answers only on an incident the caller reads, for an
-- id the caller already holds.
create function public.board_record_hidden_in_scope(rid uuid, bid uuid, iid uuid) returns boolean
  language sql stable security definer
  set search_path to 'pg_catalog', 'public', 'pg_temp'
  as $$
  select public.can_read_incident(iid) and exists (
    select 1 from public.board_records r
    where r.id = rid and r.board_id = bid and r.incident_id = iid and r.deleted_at is null)
$$;

revoke all on function public.board_record_hidden_in_scope(uuid, uuid, uuid) from public;
grant execute on function public.board_record_hidden_in_scope(uuid, uuid, uuid) to app_runtime;
