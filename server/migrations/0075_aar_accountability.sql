-- VEOC-83: accountable AAR filters, analytics and improvement actions.
-- Operational-period links use the immutable incident-area revision key so a
-- label alone can never bind a record to the wrong incident or time window.

alter table aar_observations
  add column operational_period_revision integer,
  add constraint aar_observations_period_incident_fk
    foreign key (incident_id, operational_period_revision)
    references incident_area_revisions (incident_id, revision);
create index aar_observations_period
  on aar_observations (incident_id, operational_period_revision, created_at, id);

alter table corrective_actions
  add column operational_period_revision integer,
  add column priority text not null default 'unspecified'
    check (priority in ('unspecified', 'low', 'medium', 'high', 'critical')),
  add column revision integer not null default 0 check (revision >= 0),
  add column owner_participant uuid references incident_participants (id),
  add column assignment_snapshot jsonb,
  add column completed_by uuid references persons (id),
  add constraint corrective_actions_period_requires_incident
    check (operational_period_revision is null or incident_id is not null),
  add constraint corrective_actions_period_incident_fk
    foreign key (incident_id, operational_period_revision)
    references incident_area_revisions (incident_id, revision),
  add constraint corrective_actions_one_owner
    check (num_nonnulls(owner_position, owner_person, owner_participant) <= 1);
create index corrective_actions_incident_period
  on corrective_actions (incident_id, operational_period_revision, created_at, id)
  where incident_id is not null;
create index corrective_actions_assigned_participant
  on corrective_actions (owner_participant)
  where owner_participant is not null;

-- An external participant receives only the action explicitly assigned to
-- their current, eligible incident grant. This does not expose incident AAR
-- analytics, observations or chronology.
create policy ca_assignee_read on corrective_actions for select using (
  owner_participant is not null and exists (
    select 1 from incident_participants ip
    where ip.id = corrective_actions.owner_participant
      and ip.incident_id = corrective_actions.incident_id
      and ip.person_id = current_person()
      and ip.revoked_at is null and ip.expires_at > now()
      and eligible_incident_person(ip.person_id, ip.organization_id)
  )
);
create policy ca_assignee_update on corrective_actions for update using (
  owner_participant is not null and exists (
    select 1 from incident_participants ip
    where ip.id = corrective_actions.owner_participant
      and ip.incident_id = corrective_actions.incident_id
      and ip.person_id = current_person()
      and ip.revoked_at is null and ip.expires_at > now()
      and eligible_incident_person(ip.person_id, ip.organization_id)
  )
) with check (
  owner_participant is not null and exists (
    select 1 from incident_participants ip
    where ip.id = corrective_actions.owner_participant
      and ip.incident_id = corrective_actions.incident_id
      and ip.person_id = current_person()
      and ip.revoked_at is null and ip.expires_at > now()
      and eligible_incident_person(ip.person_id, ip.organization_id)
  )
);

create function enforce_corrective_action_revision() returns trigger
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $$
declare
  assigned_person boolean;
begin
  if new.revision <> old.revision + 1 then
    raise exception 'corrective action revision must advance by one' using errcode = '40001';
  end if;

  if old.completed_at is not null and
      (new.completed_at is distinct from old.completed_at
       or new.completed_by is distinct from old.completed_by) then
    raise exception 'first completion attribution is immutable';
  end if;
  if old.completed_at is null and new.completed_at is not null and
      (new.status <> 'complete' or new.completed_by is distinct from current_person()) then
    raise exception 'completion must be attributed to the current person';
  end if;
  if new.status = 'complete' and new.completed_at is null then
    raise exception 'completed action requires completion attribution';
  end if;

  if is_writer_of(old.jurisdiction_id) then
    return new;
  end if;

  select exists (
    select 1 from incident_participants ip
    where ip.id = old.owner_participant and ip.incident_id = old.incident_id
      and ip.person_id = current_person()
      and ip.revoked_at is null and ip.expires_at > now()
      and eligible_incident_person(ip.person_id, ip.organization_id)
  ) into assigned_person;
  if not assigned_person then
    raise exception 'corrective action update is not authorized' using errcode = '42501';
  end if;

  if row(new.jurisdiction_id, new.incident_id, new.operational_period_revision,
         new.capability, new.capability_element, new.recommendation, new.priority,
         new.owner_position, new.owner_person, new.owner_participant,
         new.assignment_snapshot, new.due_date, new.created_by, new.created_at)
     is distinct from
     row(old.jurisdiction_id, old.incident_id, old.operational_period_revision,
         old.capability, old.capability_element, old.recommendation, old.priority,
         old.owner_position, old.owner_person, old.owner_participant,
         old.assignment_snapshot, old.due_date, old.created_by, old.created_at) then
    raise exception 'assigned participant may update status only' using errcode = '42501';
  end if;
  return new;
end $$;

revoke all on function enforce_corrective_action_revision() from public;
create trigger corrective_action_revision_guard
  before update on corrective_actions
  for each row execute function enforce_corrective_action_revision();

-- Cross-organization assignees append and see only their own action-update
-- receipt. Existing audit_append/audit_read policies remain unchanged.
create policy audit_aar_assignee_append on audit_events for insert with check (
  person_id = current_person()
  and category = 'aar.corrective_action_updated'
  and subject_table = 'corrective_actions'
  and incident_id is not null
  and exists (
    select 1 from corrective_actions ca
    join incident_participants ip on ip.id = ca.owner_participant
      and ip.incident_id = ca.incident_id
    where ca.id = audit_events.subject_id
      and ca.jurisdiction_id = audit_events.jurisdiction_id
      and ca.incident_id = audit_events.incident_id
      and ip.person_id = current_person()
      and ip.revoked_at is null and ip.expires_at > now()
      and eligible_incident_person(ip.person_id, ip.organization_id)
      and ca.revision::text = audit_events.payload ->> 'toRevision'
      and ca.status = audit_events.payload ->> 'status'
  )
);
create policy audit_aar_assignee_receipt on audit_events for select using (
  person_id = current_person()
  and category = 'aar.corrective_action_updated'
  and subject_table = 'corrective_actions'
  and incident_id is not null
  and exists (
    select 1 from corrective_actions ca
    join incident_participants ip on ip.id = ca.owner_participant
      and ip.incident_id = ca.incident_id
    where ca.id = audit_events.subject_id
      and ca.jurisdiction_id = audit_events.jurisdiction_id
      and ca.incident_id = audit_events.incident_id
      and ip.person_id = current_person()
      and eligible_incident_person(ip.person_id, ip.organization_id)
  )
);
