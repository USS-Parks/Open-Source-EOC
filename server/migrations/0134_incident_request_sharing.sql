-- One incident, one shared list of requests.
--
-- Every organization that can read an incident (the owner's members and each
-- active participant, whatever its role) reads the resource requests attached
-- to that incident and their chronology, whichever organization owns them.
-- Costs stay with the owning organization: rr_costs keeps its policies.
--
-- A partner writes to another organization's request by two narrow paths
-- only, each a SECURITY DEFINER function that locks what it changes, checks
-- the caller's current grant and the incident's state, and sets every
-- server-owned value itself (states, times, numbers, the chronology entry,
-- the notification and the audit row), so no policy lets a partner write a
-- column of its choosing:
--   record_request_delivery    the participant a request is assigned to
--                              records its delivery: assigned to deployed,
--                              deployed to demobilizing, demobilizing to closed;
--   submit_participant_request a contributor or coordinator requests from the
--                              incident's owner, who triages and assigns it.
-- Both end when the grant is revoked or expires or the incident closes.

create policy rr_incident_read on public.resource_requests for select
  using (incident_id is not null and public.can_read_incident(incident_id));

create policy rr_events_incident_read on public.rr_events for select
  using (exists (
    select 1 from public.resource_requests r
    where r.id = rr_events.request_id and r.incident_id is not null
      and public.can_read_incident(r.incident_id)));

-- Now that a request on an incident is read across the incident, a request
-- is tagged to an incident only by someone who works in that incident for
-- the request's organization: a writer of the incident's owner on the
-- owner's own request, or a contributor or coordinator whose grant is for
-- the request's organization. The check runs only when the tag or the owner
-- changes, so an unrelated update (an escalation claim released after the
-- grant lapsed) is not refused. The one path where a participant files a
-- request owned by the incident's owner is submit_participant_request below.
create function public.check_rr_incident_scope() returns trigger
  language plpgsql
  set search_path to 'pg_catalog', 'public', 'pg_temp'
  as $$
begin
  if new.incident_id is null or public.current_person() is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.incident_id is not distinct from old.incident_id
     and new.jurisdiction_id = old.jurisdiction_id then
    return new;
  end if;
  if exists (
    select 1 from public.incidents i where i.id = new.incident_id and (
      (i.jurisdiction_id = new.jurisdiction_id
        and (public.is_writer_of(i.jurisdiction_id) or public.has_incident_participation(i.id, 'contributor')))
      or exists (
        select 1 from public.incident_participants ip
        where ip.incident_id = i.id and ip.person_id = public.current_person()
          and ip.organization_id = new.jurisdiction_id
          and ip.revoked_at is null and ip.expires_at > now()
          and ip.role in ('contributor', 'coordinator')
          and public.eligible_incident_person(ip.person_id, ip.organization_id)))) then
    return new;
  end if;
  raise exception 'request incident scope invalid' using errcode = '42501';
end $$;

create trigger rr_incident_scope before insert or update of incident_id, jurisdiction_id
  on public.resource_requests for each row execute function public.check_rr_incident_scope();

-- Whether the current person holds the active contributor or coordinator
-- grant a request is assigned to. SECURITY DEFINER so the service can ask it
-- about a request whose assignment it may read but not resolve; it returns
-- only a boolean about the current person.
create function public.is_request_assignee(rid uuid) returns boolean
  language sql stable security definer
  set search_path to 'pg_catalog', 'public', 'pg_temp'
  as $$
  select exists (
    select 1 from public.resource_requests r
    join public.incident_participants ip
      on ip.id = r.assigned_participant_id and ip.incident_id = r.incident_id
    where r.id = rid and ip.person_id = public.current_person()
      and ip.revoked_at is null and ip.expires_at > now()
      and ip.role in ('contributor', 'coordinator')
      and public.eligible_incident_person(ip.person_id, ip.organization_id))
$$;
revoke all on function public.is_request_assignee(uuid) from public;
grant execute on function public.is_request_assignee(uuid) to app_runtime;

-- Records one delivery step and returns the new state, or null (changing
-- nothing) when the caller is not the current assignee, the incident is
-- closed, or the request's current state does not allow that step. The
-- service checks each of these first; null means one changed in between.
create function public.record_request_delivery(rid uuid, to_state text, delivery_note text) returns text
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
  if to_state is null or (req.state, to_state) not in (('assigned', 'deployed'), ('deployed', 'demobilizing'), ('demobilizing', 'closed')) then
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

-- Submits a partner's request to the incident's owner and returns its id, or
-- null (creating nothing) when the caller no longer holds contributor
-- standing on the open incident. The owner receives it and types it.
create function public.submit_participant_request(
  iid uuid, request_item text, request_quantity integer, request_priority text,
  request_notes text, request_needed_by timestamptz, request_origin text) returns uuid
  language plpgsql security definer
  set search_path to 'pg_catalog', 'public', 'pg_temp'
  as $$
declare
  actor uuid := public.current_person();
  owner_organization uuid;
  rid uuid;
begin
  if request_origin is null or request_origin not in ('field', 'eoc') then
    raise exception 'unsupported request origin' using errcode = '22023';
  end if;
  if request_priority is not null and request_priority not in ('routine', 'priority', 'immediate') then
    raise exception 'unsupported request priority' using errcode = '22023';
  end if;
  if request_item is null or length(trim(request_item)) = 0 or length(request_item) > 200
     or length(request_notes) > 4000 then
    raise exception 'a request names its item in at most 200 characters, with notes of at most 4000' using errcode = '22023';
  end if;
  select i.jurisdiction_id into owner_organization from public.incidents i
  where i.id = iid and i.closed_at is null and actor is not null
    and public.has_incident_participation(i.id, 'contributor')
  for share;
  if owner_organization is null then
    return null;
  end if;
  insert into public.resource_requests
    (jurisdiction_id, receiving_organization_id, incident_id, origin, item, quantity, priority, state,
     notes, needed_by, requested_by)
  values (owner_organization, owner_organization, iid, request_origin, request_item,
    greatest(coalesce(request_quantity, 1), 1), coalesce(request_priority, 'routine'), 'submitted',
    request_notes, request_needed_by, actor)
  returning id into rid;
  insert into public.rr_events (request_id, from_state, to_state, note, actor_person)
  values (rid, null, 'submitted', 'request submitted', actor);
  insert into public.notifications (jurisdiction_id, person_id, channel, title, body, status)
  values (owner_organization, actor, 'resource', 'Resource request', 'Resource request submitted: ' || request_item, 'delivered');
  insert into public.audit_events (jurisdiction_id, incident_id, person_id, category, subject_table, subject_id, payload)
  values (owner_organization, iid, actor, 'rr.submitted', 'resource_requests', rid,
    jsonb_build_object('item', request_item, 'origin', request_origin));
  return rid;
end $$;
revoke all on function public.submit_participant_request(uuid, text, integer, text, text, timestamptz, text) from public;
grant execute on function public.submit_participant_request(uuid, text, integer, text, text, timestamptz, text) to app_runtime;
