-- Board actions (VC-17) record each run as a board.action.run audit event on
-- the record whose write set it off. A jurisdiction member appends and reads
-- it under the general audit policies. An incident participant who is not a
-- member writes records on the incident's boards, so the actions those writes
-- set off are recorded as that participant; these two policies let them
-- append such an event and read it, shaped like the incident record policies,
-- and audit_board_record_scope still applies the record's own read rule.

create policy audit_board_action_append on public.audit_events for insert with check (
  person_id = public.current_person()
  and category = 'board.action.run'
  and subject_table = 'board_records'
  and incident_id is not null
  and public.can_read_incident(incident_id)
  and exists (
    select 1 from public.board_records r join public.boards b on b.id = r.board_id
    where r.id = audit_events.subject_id and r.incident_id = audit_events.incident_id
      and b.jurisdiction_id = audit_events.jurisdiction_id
      and (public.is_writer_of(b.jurisdiction_id) or public.has_incident_participation(r.incident_id, 'contributor'))));

create policy audit_board_action_read on public.audit_events for select using (
  category = 'board.action.run'
  and subject_table = 'board_records'
  and incident_id is not null
  and public.can_read_incident(incident_id)
  and exists (
    select 1 from public.board_records r join public.boards b on b.id = r.board_id
    where r.id = audit_events.subject_id and r.incident_id = audit_events.incident_id
      and b.jurisdiction_id = audit_events.jurisdiction_id));
