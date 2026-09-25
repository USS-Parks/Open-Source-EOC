-- Reads that slowed as an incident's work piled up.
--
-- The incident summary and the incidents overview counted open resource
-- requests through the table's row-level security, which runs its checks
-- once for every request. Anyone who can read an incident reads every
-- request on it (rr_incident_read), so the count is gated once per incident
-- here and taken without the per-row checks. Nothing is returned for an
-- incident the caller cannot read.
create function public.incident_request_counts(p_incidents uuid[], p_finished text[])
  returns table (incident_id uuid, unfinished integer, open_requests integer, urgent_requests integer)
  language sql stable security definer
  set search_path to 'pg_catalog', 'public', 'pg_temp'
  as $$
  select r.incident_id,
    count(*)::int,
    (count(*) filter (where r.state <> 'draft'))::int,
    (count(*) filter (where r.state <> 'draft' and r.priority = 'immediate'))::int
  from unnest(p_incidents) as i(id)
  join public.resource_requests r on r.incident_id = i.id
  where public.can_read_incident(i.id) and r.state <> all(p_finished)
  group by r.incident_id
$$;
revoke all on function public.incident_request_counts(uuid[], text[]) from public;
grant execute on function public.incident_request_counts(uuid[], text[]) to app_runtime;

-- The notification list ordered every notification by time and let the read
-- policy (notifications_read) drop the ones not for the reader, one row at a
-- time, so a page cost more the more notifications other people had. This
-- picks a page's candidates from the three sources the policy allows (the
-- person's own, their current positions', and every one in a jurisdiction
-- they administer), each read newest first through its own index and with the
-- policy's own tests. The list still reads the candidates under the policy.
create index notifications_jurisdiction_page on public.notifications (jurisdiction_id, created_at desc, id desc);

create function public.notification_page(p_before_at timestamptz, p_before_id uuid, p_limit integer)
  returns table (id uuid)
  language sql stable security definer
  set search_path to 'pg_catalog', 'public', 'pg_temp'
  as $$
  (select n.id from public.notifications n
    where n.person_id = public.current_person()
      and (n.created_at, n.id) < (coalesce(p_before_at, 'infinity'), coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'))
    order by n.created_at desc, n.id desc limit p_limit)
  union
  (select held.id from public.position_assignments a cross join lateral (
      select n.id from public.notifications n
      where n.position_id = a.position_id
        and (n.created_at, n.id) < (coalesce(p_before_at, 'infinity'), coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'))
      order by n.created_at desc, n.id desc limit p_limit) held
    where a.person_id = public.current_person() and a.revoked_at is null)
  union
  (select administered.id from public.jurisdictions j cross join lateral (
      select n.id from public.notifications n
      where n.jurisdiction_id = j.id
        and (n.created_at, n.id) < (coalesce(p_before_at, 'infinity'), coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'))
      order by n.created_at desc, n.id desc limit p_limit) administered
    where public.is_admin_of(j.id))
$$;
revoke all on function public.notification_page(timestamptz, uuid, integer) from public;
grant execute on function public.notification_page(timestamptz, uuid, integer) to app_runtime;
