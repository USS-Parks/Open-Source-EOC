-- Executable plans (VC-09).
--
-- A plan is a jurisdiction's emergency plan as an object it can run: sections
-- linked to the parts of an incident template, tasks released on a schedule,
-- the notice activation sends and a review cadence, all in its definition.
-- The row holds the current version; plan_versions keeps every version,
-- append-only, whichever path saved it. Its kind and review cadence are read
-- from the definition, so the scheduler can find what is due.
--
-- Activation opens an incident from the plan's template and records the plan
-- version on it. A task whose release time has not come waits in
-- plan_task_releases, hidden from the incident's task list, until the
-- scheduler releases it into checklist_items. An incident closed first keeps
-- its waiting tasks unreleased; reopened, they release.

create table public.plans (
  id uuid primary key default gen_random_uuid(),
  jurisdiction_id uuid not null references public.jurisdictions (id),
  title text not null check (length(title) between 1 and 200),
  definition jsonb not null,
  kind text generated always as (definition ->> 'kind') stored
    check (kind in ('incident_response', 'recurring_event')),
  review_every_days integer generated always as ((definition ->> 'reviewEveryDays')::integer) stored
    check (review_every_days between 1 and 1095),
  version integer not null default 1 check (version >= 1),
  reviewed_at timestamptz,
  reviewed_by uuid references public.persons (id),
  -- The due date the last review reminder was for; a later review moves the due date past it.
  review_reminded_for timestamptz,
  created_by uuid not null references public.persons (id),
  created_at timestamptz not null default now(),
  updated_by uuid not null references public.persons (id),
  updated_at timestamptz not null default now()
);
create index plans_jurisdiction on public.plans (jurisdiction_id, title);

create table public.plan_versions (
  plan_id uuid not null references public.plans (id),
  version integer not null check (version >= 1),
  jurisdiction_id uuid not null references public.jurisdictions (id),
  title text not null,
  definition jsonb not null,
  created_by uuid references public.persons (id),
  created_at timestamptz not null default now(),
  primary key (plan_id, version)
);

create function public.reject_plan_version_change() returns trigger
  language plpgsql
  as $$
begin
  raise exception 'plan versions are append-only';
end $$;
create trigger plan_versions_immutable before delete or update on public.plan_versions
  for each row execute function public.reject_plan_version_change();

-- A change to a plan's title or definition is its next version, whoever makes
-- it: one that leaves the version alone is numbered here, and one that sets it
-- must move it by exactly one. A review changes neither.
create function public.number_plan_version() returns trigger
  language plpgsql
  as $$
begin
  if new.jurisdiction_id <> old.jurisdiction_id then
    raise exception 'a plan stays in its jurisdiction';
  end if;
  if new.version = old.version then
    if new.definition is distinct from old.definition or new.title is distinct from old.title then
      new.version := old.version + 1;
      new.updated_at := now();
    end if;
  elsif new.version <> old.version + 1 then
    raise exception 'a plan version moves by one';
  end if;
  return new;
end $$;
create trigger plan_versions_number before update on public.plans
  for each row execute function public.number_plan_version();

create function public.keep_plan_version() returns trigger
  language plpgsql security definer
  set search_path to 'pg_catalog', 'public', 'pg_temp'
  as $$
begin
  if tg_op = 'UPDATE' and new.version = old.version then
    return new;
  end if;
  insert into public.plan_versions (plan_id, version, jurisdiction_id, title, definition, created_by)
  values (new.id, new.version, new.jurisdiction_id, new.title, new.definition, new.updated_by);
  return new;
end $$;
create trigger plan_versions_keep after insert or update on public.plans
  for each row execute function public.keep_plan_version();

alter table public.incidents
  add column plan_id uuid references public.plans (id),
  add column plan_version integer,
  add column plan_event_at timestamptz,
  add constraint incidents_plan_version check ((plan_id is null) = (plan_version is null));

create table public.plan_task_releases (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents (id),
  jurisdiction_id uuid not null references public.jurisdictions (id),
  plan_id uuid not null references public.plans (id),
  position_id uuid not null references public.positions (id),
  item text not null check (length(item) between 1 and 500),
  category text not null,
  release_at timestamptz not null,
  due_minutes integer check (due_minutes between 1 and 43200),
  released_at timestamptz,
  checklist_item_id uuid references public.checklist_items (id),
  check ((released_at is null) = (checklist_item_id is null))
);
create index plan_task_releases_due on public.plan_task_releases (release_at) where released_at is null;
create index plan_task_releases_incident on public.plan_task_releases (incident_id, release_at);

alter table public.plans enable row level security;
alter table public.plan_versions enable row level security;
alter table public.plan_task_releases enable row level security;

create policy plans_read on public.plans
  for select using (public.is_member_of(jurisdiction_id));
create policy plans_insert on public.plans
  for insert with check (public.is_admin_of(jurisdiction_id));
create policy plans_update on public.plans
  for update using (public.is_admin_of(jurisdiction_id)) with check (public.is_admin_of(jurisdiction_id));

-- A participating organization reads the version its incident was activated from, and no other.
create policy plan_versions_read on public.plan_versions
  for select using (public.is_member_of(jurisdiction_id) or exists (
    select 1 from public.incidents i
    where i.plan_id = plan_versions.plan_id and i.plan_version = plan_versions.version
      and public.can_read_incident(i.id)));

-- Whoever reads the incident sees what its plan still has to release.
create policy plan_task_releases_read on public.plan_task_releases
  for select using (public.can_read_incident(incident_id));
create policy plan_task_releases_insert on public.plan_task_releases
  for insert with check (public.is_admin_of(jurisdiction_id));
create policy plan_task_releases_update on public.plan_task_releases
  for update using (public.is_admin_of(jurisdiction_id)) with check (public.is_admin_of(jurisdiction_id));

grant select, insert, update on table public.plans to app_runtime;
grant select on table public.plan_versions to app_runtime;
grant select, insert, update on table public.plan_task_releases to app_runtime;

-- The scheduler's plans work: a waiting task whose release time has come on
-- an open incident, and a plan whose review is due and not yet reminded.
create or replace function public.scheduler_due(work text, due_at timestamptz)
  returns table (jurisdiction_id uuid, person_id uuid)
  language sql stable security definer
  set search_path to 'pg_catalog', 'public', 'pg_temp'
  as $$
  with due as (
    select r.jurisdiction_id, r.created_by
    from public.notification_rules r
    where scheduler_due.work = 'rules'
      and r.enabled and r.event = 'scheduled' and r.schedule_interval_minutes is not null
      and (r.last_fired_at is null
           or r.last_fired_at <= scheduler_due.due_at - make_interval(mins => r.schedule_interval_minutes))
    union all
    select i.jurisdiction_id, b.created_by
    from public.briefings b
    join public.incidents i on i.id = b.incident_id
    where scheduler_due.work = 'briefings'
      and i.closed_at is null and b.notified_at is null and b.scheduled_at <= scheduler_due.due_at
    union all
    select m.jurisdiction_id, m.sent_by
    from public.mass_notifications m
    cross join lateral (
      select r.notified_at, r.acknowledged_at from public.mass_notification_recipients r
      where r.mass_notification_id = m.id and r.notified_at is not null
      order by r.priority desc limit 1) latest
    where scheduler_due.work = 'calldowns'
      and m.mode = 'calldown' and m.completed_at is null
      and (latest.acknowledged_at is not null
           or latest.notified_at <= scheduler_due.due_at - make_interval(mins => m.interval_minutes))
    union all
    select t.jurisdiction_id, i.activated_by
    from public.plan_task_releases t
    join public.incidents i on i.id = t.incident_id
    where scheduler_due.work = 'plans'
      and t.released_at is null and t.release_at <= scheduler_due.due_at and i.closed_at is null
    union all
    select p.jurisdiction_id, p.updated_by
    from public.plans p
    where scheduler_due.work = 'plans'
      and p.review_every_days is not null
      and coalesce(p.reviewed_at, p.created_at) + make_interval(days => p.review_every_days) <= scheduler_due.due_at
      and (p.review_reminded_for is null
           or p.review_reminded_for < coalesce(p.reviewed_at, p.created_at) + make_interval(days => p.review_every_days))
  )
  select distinct on (m.jurisdiction_id) m.jurisdiction_id, m.person_id
  from public.jurisdiction_memberships m
  join public.persons p on p.id = m.person_id and not p.disabled
  where m.role = 'admin' and m.jurisdiction_id in (select d.jurisdiction_id from due d)
  order by m.jurisdiction_id,
    exists (select 1 from due d
            where d.jurisdiction_id = m.jurisdiction_id and d.created_by = m.person_id) desc,
    m.created_at, m.person_id
$$;
