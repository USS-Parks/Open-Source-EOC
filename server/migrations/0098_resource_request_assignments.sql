-- D22 extends the existing 213RR lifecycle with explicit receiving and
-- supplying organizations plus the shared 81B assignment target.
alter table resource_requests
  add column receiving_organization_id uuid references jurisdictions(id),
  add column supplying_organization_id uuid references jurisdictions(id),
  add column assigned_participant_id uuid references incident_participants(id);

update resource_requests
set receiving_organization_id = jurisdiction_id
where receiving_organization_id is null;

-- Existing requests assigned to a local position already have a known
-- supplying organization; preserve that visible assignment on upgrade.
update resource_requests request
set supplying_organization_id = position.jurisdiction_id
from positions position
where position.id = request.assigned_position
  and request.supplying_organization_id is null;

create index resource_requests_receiving_organization
  on resource_requests (receiving_organization_id, created_at desc);
create index resource_requests_supplying_organization
  on resource_requests (supplying_organization_id, created_at desc)
  where supplying_organization_id is not null;
create index resource_requests_assigned_participant
  on resource_requests (assigned_participant_id)
  where assigned_participant_id is not null;
