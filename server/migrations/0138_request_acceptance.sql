-- Receipt is not acceptance. The receiving
-- organization accepts a request, which records who accepted it, acting as
-- which position, and when; that person owns the request until it is
-- assigned. The accepted state takes the place of triaged, declined ends a
-- request with a reason, and fulfilled marks a deployed resource meeting the
-- need. Recorded history keeps its triaged entries as they were written.

alter table public.resource_requests
  add column accepted_by uuid references public.persons(id),
  add column accepted_position uuid references public.positions(id),
  add column accepted_at timestamptz;

-- A request past triage was accepted by whoever triaged it.
update public.resource_requests r
   set accepted_by = first_triage.actor_person, accepted_at = first_triage.at
  from (select distinct on (request_id) request_id, actor_person, at
          from public.rr_events where to_state = 'triaged'
         order by request_id, at, id) first_triage
 where first_triage.request_id = r.id;

update public.resource_requests set state = 'accepted' where state = 'triaged';

-- The Resource Requests board takes its State choices from the same list, so
-- its records and its Open requests view move with the lifecycle.
update public.board_records r
   set data = jsonb_set(r.data, '{state}', '"accepted"')
  from public.boards b
 where b.id = r.board_id and b.template_key = 'resource_request' and r.data->>'state' = 'triaged';

update public.board_templates t
   set definition = jsonb_set(t.definition, '{views}', (
         select jsonb_agg(case when v->>'key' = 'open'
                  then jsonb_set(v, '{filter,0,value}', '["submitted", "accepted", "sourcing", "assigned", "deployed", "fulfilled"]'::jsonb)
                  else v end order by n)
           from jsonb_array_elements(t.definition->'views') with ordinality as views(v, n)))
 where t.key = 'resource_request' and t.definition->'views' @> '[{"key": "open"}]';

-- The assigned participant's delivery steps now pass through fulfilled.
create or replace function public.record_request_delivery(rid uuid, to_state text, delivery_note text) returns text
  language plpgsql security definer
  set search_path to 'pg_catalog', 'public', 'pg_temp'
  as $$
declare
  actor uuid := public.current_person();
  req record;
begin
  select r.id, r.jurisdiction_id, r.incident_id, r.state, r.item, r.requested_by, r.assigned_participant_id
    into req from public.resource_requests r where r.id = rid for update;
  if req.id is null or req.incident_id is null or actor is null or not exists (
    select 1 from public.incident_participants ip
    where ip.id = req.assigned_participant_id and ip.incident_id = req.incident_id
      and ip.person_id = actor and ip.revoked_at is null and ip.expires_at > now()
      and ip.role in ('contributor', 'coordinator')
      and public.eligible_incident_person(ip.person_id, ip.organization_id)) then
    return null;
  end if;
  if exists (select 1 from public.incidents i where i.id = req.incident_id and i.closed_at is not null) then
    return null;
  end if;
  if to_state is null or (req.state, to_state) not in (
    ('assigned', 'deployed'), ('deployed', 'fulfilled'), ('fulfilled', 'demobilizing'), ('demobilizing', 'closed')) then
    return null;
  end if;
  update public.resource_requests set state = to_state, updated_at = now() where id = rid;
  insert into public.rr_events (request_id, from_state, to_state, note, actor_person)
  values (rid, req.state, to_state, left(delivery_note, 2000), actor);
  insert into public.notifications (jurisdiction_id, person_id, channel, title, body, status)
  values (req.jurisdiction_id, req.requested_by, 'resource', 'Resource request',
    req.item || ': ' || req.state || ' → ' || to_state, 'delivered');
  insert into public.audit_events (jurisdiction_id, incident_id, person_id, category, subject_table, subject_id, payload)
  values (req.jurisdiction_id, req.incident_id, actor, 'rr.transition', 'resource_requests', rid,
    jsonb_build_object('from', req.state, 'to', to_state));
  return to_state;
end $$;
revoke all on function public.record_request_delivery(uuid, text, text) from public;
grant execute on function public.record_request_delivery(uuid, text, text) to app_runtime;
