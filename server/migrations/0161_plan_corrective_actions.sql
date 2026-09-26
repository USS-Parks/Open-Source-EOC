-- After-action corrective actions linked to plans, with reminders (VC-22).
-- A corrective action can name the plan, and the plan section, it changes.
-- The scheduler's plans work reminds the owner once for each due date an
-- open action reaches; the reminder is its own row because every change to a
-- corrective action advances its revision, and a reminder must not make an
-- open editor stale.

alter table public.corrective_actions
  add column plan_id uuid references public.plans(id),
  add column plan_section text check (plan_section is null or length(plan_section) between 1 and 200),
  add constraint corrective_actions_section_requires_plan check (plan_section is null or plan_id is not null);

create index corrective_actions_plan on public.corrective_actions (plan_id) where plan_id is not null;

create table public.corrective_action_reminders (
  corrective_action_id uuid not null references public.corrective_actions(id),
  due_date date not null,
  jurisdiction_id uuid not null references public.jurisdictions(id),
  reminded_at timestamptz not null default now(),
  primary key (corrective_action_id, due_date)
);

alter table public.corrective_action_reminders enable row level security;

create policy corrective_action_reminders_read on public.corrective_action_reminders
  for select using (public.is_member_of(jurisdiction_id));
create policy corrective_action_reminders_insert on public.corrective_action_reminders
  for insert with check (public.is_admin_of(jurisdiction_id));

grant select, insert on table public.corrective_action_reminders to app_runtime;

-- The plans work adds an open corrective action whose due date has come, by
-- the UTC calendar, and whose owner has not been reminded of that date.
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
    union all
    select ca.jurisdiction_id, ca.created_by
    from public.corrective_actions ca
    where scheduler_due.work = 'plans'
      and ca.status <> 'complete' and ca.due_date <= (scheduler_due.due_at at time zone 'UTC')::date
      and not exists (select 1 from public.corrective_action_reminders r
                      where r.corrective_action_id = ca.id and r.due_date = ca.due_date)
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
