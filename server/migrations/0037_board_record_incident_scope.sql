-- Incident-scoped board records (VEOC-79B1). A board record may belong to an
-- incident, so authorized participants of that incident (including other
-- organizations) can read and contribute records on the boards that incident
-- uses, without changing the board's source ownership. Legacy and reusable
-- reference records keep a null incident_id and are never silently assigned to
-- an incident. A record's incident_id, when set, must name an incident the
-- board is actually attached to (incident_boards), so a record cannot be
-- tagged into a foreign incident and leaked.

alter table board_records add column incident_id uuid references incidents (id);
create index board_records_incident on board_records (incident_id) where incident_id is not null;

-- A participant may read the boards their incident uses, in addition to the
-- jurisdiction members and scoped guests who already can.
drop policy boards_read on boards;
create policy boards_read on boards for select
  using (
    is_member_of(jurisdiction_id)
    or has_guest_scope(jurisdiction_id, 'board:' || id::text || ':read')
    or exists (
      select 1 from incident_boards ib
      where ib.board_id = boards.id and can_read_incident(ib.incident_id)
    )
  );

-- Reads: jurisdiction members and scoped guests as before, plus a participant
-- who can read the incident this record belongs to, when the board is attached
-- to that incident.
drop policy records_read on board_records;
create policy records_read on board_records for select
  using (
    exists (
      select 1 from boards b
      where b.id = board_id
        and (
          is_member_of(b.jurisdiction_id)
          or has_guest_scope(b.jurisdiction_id, 'board:' || b.id::text || ':read')
        )
    )
    or (
      incident_id is not null
      and can_read_incident(incident_id)
      and exists (
        select 1 from incident_boards ib
        where ib.incident_id = board_records.incident_id and ib.board_id = board_records.board_id
      )
    )
  );

-- Writes: a jurisdiction writer as before, or an incident contributor. Either
-- way, an incident_id, when set, must match a board the incident uses, so a
-- record can only be tagged into an incident whose boards genuinely include it.
drop policy records_write on board_records;
create policy records_write on board_records for insert
  with check (
    (
      incident_id is null
      or exists (
        select 1 from incident_boards ib
        where ib.incident_id = board_records.incident_id and ib.board_id = board_records.board_id
      )
    )
    and (
      exists (select 1 from boards b where b.id = board_id and is_writer_of(b.jurisdiction_id))
      or (incident_id is not null and has_incident_participation(incident_id, 'contributor'))
    )
  );

drop policy records_update on board_records;
create policy records_update on board_records for update
  using (
    exists (select 1 from boards b where b.id = board_id and is_writer_of(b.jurisdiction_id))
    or (incident_id is not null and has_incident_participation(incident_id, 'contributor'))
  );
