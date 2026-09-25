-- A peer's escalation of one request is received once; a repeated delivery
-- answers with the request the first one made. An instance that already holds
-- repeats keeps the earliest as the escalation's request, and the later ones
-- stay as they are without the link back to the origin request.
update public.resource_requests r set source_request_id = null
 where r.source_request_id is not null and exists (
   select 1 from public.resource_requests e
    where e.jurisdiction_id = r.jurisdiction_id and e.source_peer = r.source_peer
      and e.source_request_id = r.source_request_id and (e.created_at, e.id) < (r.created_at, r.id));
create unique index resource_requests_source_once on public.resource_requests
  (jurisdiction_id, source_peer, source_request_id) where source_request_id is not null;

-- An incident's requests are read by incident, newest number first.
create index resource_requests_incident on public.resource_requests (incident_id, number desc, id desc)
  where incident_id is not null;

-- A jurisdiction's administrators edit the kinds they added.
grant update on table public.resource_kinds to app_runtime;
create policy resource_kinds_update on public.resource_kinds for update
  using (public.is_admin_of(jurisdiction_id) and source = 'local')
  with check (public.is_admin_of(jurisdiction_id) and source = 'local');

-- A pool resource's history is read from the audit trail by subject.
create index audit_events_resource_subject on public.audit_events (subject_id, seq)
  where subject_table = 'resources';
