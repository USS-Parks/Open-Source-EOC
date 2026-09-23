-- Work discovery for the in-process scheduler.
--
-- The scheduler acts for no person, and row-level security hides scheduled
-- notification rules and briefings from a session without one. This function
-- names, for each jurisdiction with work of the given kind due, one enabled
-- admin to run it as: the author of a due item when that author is still an
-- enabled admin, otherwise another enabled admin. It returns those two ids and
-- nothing else; the work itself then runs under that admin's principal with
-- row-level security in force.

create function public.scheduler_due(work text, due_at timestamptz)
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

revoke all on function public.scheduler_due(text, timestamptz) from public;
grant execute on function public.scheduler_due(text, timestamptz) to app_runtime;
