-- Exact scoped receipts for durable board reconciliation.

alter table sync_updates add column incident_id uuid references incidents (id);
alter table sync_updates add column operation_id uuid;
alter table sync_updates add column request_digest text
  check (request_digest is null or length(request_digest) = 64);
alter table sync_updates add column conflicts integer
  check (conflicts is null or conflicts >= 0);
alter table sync_conflicts add column incident_id uuid references incidents (id);
create index sync_conflicts_incident on sync_conflicts (incident_id)
  where incident_id is not null;

alter table sync_updates add constraint sync_update_receipt_shape check (
  (incident_id is null and operation_id is null and request_digest is null and conflicts is null)
  or
  (incident_id is not null and operation_id is not null
    and request_digest is not null and conflicts is not null)
);

create unique index sync_updates_exact_operation
  on sync_updates (origin_person, operation_id)
  where operation_id is not null;

drop policy sync_updates_read on sync_updates;
create policy sync_updates_read on sync_updates for select using (
  (incident_id is null and exists (
    select 1 from boards b
    where b.id = sync_updates.board_id and is_member_of(b.jurisdiction_id)
  ))
  or
  (incident_id is not null and can_read_incident(incident_id)
    and exists (
      select 1 from incident_boards ib
      where ib.board_id = sync_updates.board_id
        and ib.incident_id = sync_updates.incident_id
    ))
);

drop policy sync_updates_append on sync_updates;
create policy sync_updates_append on sync_updates for insert with check (
  origin_person = current_person()
  and (
    (incident_id is null and operation_id is null
      and request_digest is null and conflicts is null
      and exists (
        select 1 from boards b
        where b.id = sync_updates.board_id and is_writer_of(b.jurisdiction_id)
      ))
    or
    (incident_id is not null and operation_id is not null
      and request_digest is not null and conflicts is not null
      and can_read_incident(incident_id)
      and exists (
        select 1 from incident_boards ib
        join incidents i on i.id = ib.incident_id
        where ib.board_id = sync_updates.board_id
          and ib.incident_id = sync_updates.incident_id
          and i.closed_at is null
          and (is_writer_of(i.jurisdiction_id)
            or has_incident_participation(i.id, 'contributor'))
      ))
  )
);

drop policy sync_conflicts_read on sync_conflicts;
create policy sync_conflicts_read on sync_conflicts for select using (
  (incident_id is null and exists (
    select 1 from boards b
    where b.id = sync_conflicts.board_id and is_member_of(b.jurisdiction_id)
  ))
  or
  (incident_id is not null and can_read_incident(incident_id)
    and exists (
      select 1 from incident_boards ib
      where ib.board_id = sync_conflicts.board_id
        and ib.incident_id = sync_conflicts.incident_id
    ))
);

drop policy sync_conflicts_append on sync_conflicts;
create policy sync_conflicts_append on sync_conflicts for insert with check (
  origin_person = current_person()
  and (
    (incident_id is null and exists (
      select 1 from boards b
      where b.id = sync_conflicts.board_id and is_member_of(b.jurisdiction_id)
    ))
    or
    (incident_id is not null and exists (
      select 1 from incident_boards ib join incidents i on i.id = ib.incident_id
      where ib.board_id = sync_conflicts.board_id
        and ib.incident_id = sync_conflicts.incident_id
        and i.closed_at is null
        and (is_writer_of(i.jurisdiction_id)
          or has_incident_participation(i.id, 'contributor'))
    ))
  )
);

create policy audit_sync_record_read on audit_events for select using (
  incident_id is not null and can_read_incident(incident_id)
  and subject_table = 'board_records'
  and category in ('board.record.created', 'board.record.updated')
  and exists (
    select 1 from board_records r join boards b on b.id = r.board_id
    where r.id = audit_events.subject_id
      and r.incident_id = audit_events.incident_id
      and b.jurisdiction_id = audit_events.jurisdiction_id
  )
);

create policy audit_sync_record_append on audit_events for insert with check (
  person_id = current_person()
  and incident_id is not null and can_read_incident(incident_id)
  and subject_table = 'board_records'
  and category in ('board.record.created', 'board.record.updated')
  and payload->>'via' = 'sync'
  and exists (
    select 1 from board_records r join boards b on b.id = r.board_id
    where r.id = audit_events.subject_id
      and r.incident_id = audit_events.incident_id
      and b.jurisdiction_id = audit_events.jurisdiction_id
      and ((audit_events.category = 'board.record.created' and r.created_by = current_person())
        or (audit_events.category = 'board.record.updated' and r.updated_by = current_person()))
  )
);

create policy audit_sync_conflict_read on audit_events for select using (
  category = 'sync.conflict' and subject_table = 'board_records'
  and incident_id is not null and can_read_incident(incident_id)
  and exists (
    select 1 from sync_conflicts c join boards b on b.id = c.board_id
    where c.record_id = audit_events.subject_id
      and c.incident_id = audit_events.incident_id
      and b.jurisdiction_id = audit_events.jurisdiction_id
  )
);

create policy audit_sync_conflict_append on audit_events for insert with check (
  category = 'sync.conflict' and subject_table = 'board_records'
  and person_id = current_person()
  and incident_id is not null and can_read_incident(incident_id)
  and exists (
    select 1 from sync_conflicts c join boards b on b.id = c.board_id
    where c.record_id = audit_events.subject_id
      and c.incident_id = audit_events.incident_id
      and c.origin_person = current_person()
      and b.jurisdiction_id = audit_events.jurisdiction_id
  )
);
