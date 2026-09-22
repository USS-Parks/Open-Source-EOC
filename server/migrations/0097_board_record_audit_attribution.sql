-- Incident board writes are attributed to the board owner's jurisdiction so
-- every authorized incident reader sees one coherent record history. Permit
-- only the person who actually created or updated the matching incident record
-- to append the corresponding receipt. The existing sync-specific policy and
-- general jurisdiction-member policy remain in force independently.

create policy audit_incident_board_record_append on audit_events for insert
with check (
  person_id = current_person()
  and incident_id is not null
  and can_read_incident(incident_id)
  and subject_table = 'board_records'
  and category in ('board.record.created', 'board.record.updated')
  and exists (
    select 1
    from board_records r
    join boards b on b.id = r.board_id
    where r.id = audit_events.subject_id
      and r.incident_id = audit_events.incident_id
      and b.jurisdiction_id = audit_events.jurisdiction_id
      and (is_writer_of(b.jurisdiction_id)
        or has_incident_participation(r.incident_id, 'contributor'))
      and ((audit_events.category = 'board.record.created'
          and r.created_by = current_person())
        or (audit_events.category = 'board.record.updated'
          and r.updated_by = current_person()))
  )
);
-- Before this migration, REST-created incident records attributed their audit
-- receipt to the contributing partner. Preserve those immutable receipts for
-- current incident readers only when the record, board key, creator, partner
-- grant, and grant-time window all corroborate the historic attribution.
create policy audit_legacy_incident_board_record_read on audit_events for select
using (
  incident_id is not null
  and can_read_incident(incident_id)
  and subject_table = 'board_records'
  and category = 'board.record.created'
  and exists (
    select 1
    from board_records r
    join boards b on b.id = r.board_id
    join incident_participants ip
      on ip.incident_id = audit_events.incident_id
      and ip.person_id = audit_events.person_id
      and ip.organization_id = audit_events.jurisdiction_id
      and ip.role in ('contributor', 'coordinator')
      and ip.created_at <= audit_events.created_at
      and audit_events.created_at <= ip.expires_at
      and (ip.revoked_at is null or audit_events.created_at <= ip.revoked_at)
    where r.id = audit_events.subject_id
      and r.incident_id = audit_events.incident_id
      and r.created_by = audit_events.person_id
      and audit_events.jurisdiction_id <> b.jurisdiction_id
      and audit_events.payload->>'board' = b.template_key
  )
);
