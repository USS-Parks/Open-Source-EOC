-- VEOC-82: incident checklist tasks, guarded assignment, and offline receipts.

alter table checklist_items alter column position_id drop not null;
alter table checklist_items add column category text not null default 'general'
  check (category ~ '^[a-z][a-z0-9_]{0,79}$');
alter table checklist_items add column status text not null default 'open'
  check (status in ('open', 'in_progress', 'completed'));
alter table checklist_items add column due_at timestamptz;
alter table checklist_items add column assigned_participant_id uuid
  references incident_participants (id);
alter table checklist_items add column revision integer not null default 1
  check (revision > 0);
alter table checklist_items add column created_at timestamptz not null default now();
alter table checklist_items add column updated_at timestamptz not null default now();
alter table checklist_items add column completed_by_organization_id uuid
  references jurisdictions (id);
alter table checklist_items add column completed_by_participation_id uuid
  references incident_participants (id);
alter table checklist_items add column completed_as_title text
  check (completed_as_title is null or length(trim(completed_as_title)) between 1 and 160);

update checklist_items set status = 'completed' where completed_at is not null;
update checklist_items c
set completed_by_organization_id = p.jurisdiction_id,
    completed_as_title = p.title
from positions p
where c.completed_by_position = p.id and c.completed_at is not null;

alter table checklist_items add constraint checklist_one_assignment
  check (num_nonnulls(position_id, assigned_participant_id) <= 1);
alter table checklist_items add constraint checklist_completion_shape check (
  (status <> 'completed' and completed_at is null and completed_by is null
    and completed_by_position is null and completed_by_organization_id is null
    and completed_by_participation_id is null and completed_as_title is null)
  or
  (status = 'completed' and completed_at is not null and completed_by is not null
    and completed_by_organization_id is not null and completed_as_title is not null
    and num_nonnulls(completed_by_position, completed_by_participation_id) = 1)
);

create index checklist_items_filters
  on checklist_items (incident_id, status, category, due_at);
create index checklist_items_participant
  on checklist_items (assigned_participant_id) where assigned_participant_id is not null;

create table checklist_completion_operations (
  operation_id uuid primary key,
  task_id uuid not null references checklist_items (id),
  incident_id uuid not null references incidents (id),
  actor_person_id uuid not null references persons (id),
  request_digest text not null check (length(request_digest) = 64),
  receipt jsonb not null,
  created_at timestamptz not null default now()
);
create index checklist_completion_operations_task
  on checklist_completion_operations (task_id, actor_person_id);

grant select, insert on checklist_completion_operations to app_runtime;
revoke update, delete on checklist_completion_operations from app_runtime;
alter table checklist_completion_operations enable row level security;
create policy checklist_completion_operations_read on checklist_completion_operations for select
  using (actor_person_id = current_person() and can_read_incident(incident_id));
create policy checklist_completion_operations_insert on checklist_completion_operations for insert
  with check (
    checklist_completion_operations.actor_person_id = current_person()
    and can_read_incident(checklist_completion_operations.incident_id)
    and checklist_completion_operations.receipt->>'operationId' =
      checklist_completion_operations.operation_id::text
    and checklist_completion_operations.receipt->>'taskId' =
      checklist_completion_operations.task_id::text
    and checklist_completion_operations.receipt->>'incidentId' =
      checklist_completion_operations.incident_id::text
    and checklist_completion_operations.receipt->>'status' = 'completed'
    and checklist_completion_operations.receipt->'completedBy'->>'personId' =
      current_person()::text
    and checklist_completion_operations.receipt->'completedBy' ? 'positionId'
    and checklist_completion_operations.receipt->'completedBy' ? 'participationId'
    and exists (
      select 1 from checklist_items c
      where c.id = checklist_completion_operations.task_id
        and c.incident_id = checklist_completion_operations.incident_id
        and c.status = 'completed' and c.completed_by = current_person()
        and c.revision::text = checklist_completion_operations.receipt->>'revision'
        and date_trunc('milliseconds', c.completed_at) =
          (checklist_completion_operations.receipt->>'completedAt')::timestamptz
        and c.completed_by_organization_id::text =
          checklist_completion_operations.receipt->'completedBy'->>'organizationId'
        and c.completed_by_position::text is not distinct from
          checklist_completion_operations.receipt->'completedBy'->>'positionId'
        and c.completed_by_participation_id::text is not distinct from
          checklist_completion_operations.receipt->'completedBy'->>'participationId'
        and c.completed_as_title =
          checklist_completion_operations.receipt->'completedBy'->>'title'
    )
  );

create policy audit_checklist_completion_read on audit_events for select using (
  category = 'checklist.completed' and person_id = current_person()
  and incident_id is not null and subject_table = 'checklist_items'
  and can_read_incident(incident_id)
  and exists (
    select 1 from checklist_completion_operations op
    join checklist_items c on c.id = op.task_id and c.incident_id = op.incident_id
    where op.actor_person_id = current_person()
      and op.incident_id = audit_events.incident_id
      and op.task_id = audit_events.subject_id
      and op.operation_id::text = audit_events.payload->>'operationId'
      and op.request_digest is not null
      and op.receipt->>'operationId' = op.operation_id::text
      and op.receipt->>'taskId' = op.task_id::text
      and op.receipt->>'incidentId' = op.incident_id::text
      and op.receipt->'completedBy'->>'personId' = current_person()::text
      and c.status = 'completed' and c.completed_by = current_person()
      and c.revision::text = audit_events.payload->>'revision'
      and op.receipt->>'revision' = audit_events.payload->>'revision'
  )
);
create policy audit_checklist_completion_append on audit_events for insert with check (
  category = 'checklist.completed' and person_id = current_person()
  and incident_id is not null and subject_table = 'checklist_items'
  and can_read_incident(incident_id)
  and exists (
    select 1 from checklist_completion_operations op
    join checklist_items c on c.id = op.task_id and c.incident_id = op.incident_id
    where op.actor_person_id = current_person()
      and op.incident_id = audit_events.incident_id
      and op.task_id = audit_events.subject_id
      and op.operation_id::text = audit_events.payload->>'operationId'
      and op.request_digest is not null
      and op.receipt->>'operationId' = op.operation_id::text
      and op.receipt->>'taskId' = op.task_id::text
      and op.receipt->>'incidentId' = op.incident_id::text
      and op.receipt->'completedBy'->>'personId' = current_person()::text
      and c.status = 'completed' and c.completed_by = current_person()
      and c.revision::text = audit_events.payload->>'revision'
      and op.receipt->>'revision' = audit_events.payload->>'revision'
  )
);

create function checklist_actor_can_update(task checklist_items) returns boolean
language sql stable security invoker set search_path = pg_catalog, public as $$
  select exists (
    select 1 from incidents i
    where i.id = task.incident_id and i.closed_at is null and (
      is_admin_of(i.jurisdiction_id)
      or (task.position_id is not null and is_writer_of(i.jurisdiction_id) and exists (
        select 1 from auth_sessions s
        join position_assignments a on a.position_id = s.active_position_id
          and a.person_id = s.person_id and a.revoked_at is null
        where s.person_id = current_person() and s.ended_at is null
          and s.active_position_id = task.position_id
      ))
      or (task.assigned_participant_id is not null and exists (
        select 1 from incident_participants ip
        where ip.id = task.assigned_participant_id and ip.incident_id = task.incident_id
          and ip.person_id = current_person() and ip.revoked_at is null
          and ip.expires_at > now()
          and ip.role in ('contributor', 'coordinator')
          and eligible_incident_person(ip.person_id, ip.organization_id)
      ))
    )
  )
$$;
revoke all on function checklist_actor_can_update(checklist_items) from public;
grant execute on function checklist_actor_can_update(checklist_items) to app_runtime;

create policy audit_checklist_status_read on audit_events for select using (
  category = 'checklist.task.updated' and person_id = current_person()
  and incident_id is not null and subject_table = 'checklist_items'
  and payload->'changed' = '["status"]'::jsonb
  and payload - 'revision' - 'changed' - 'status' = '{}'::jsonb
  and can_read_incident(incident_id)
  and exists (
    select 1 from checklist_items c
    join incidents i on i.id = c.incident_id
    join incident_participants ip on ip.id = c.assigned_participant_id
      and ip.incident_id = c.incident_id
    where c.id = audit_events.subject_id
      and c.incident_id = audit_events.incident_id
      and i.jurisdiction_id = audit_events.jurisdiction_id
      and c.revision::text = audit_events.payload->>'revision'
      and c.status = audit_events.payload->>'status'
      and ip.person_id = current_person() and ip.revoked_at is null
      and ip.expires_at > now() and ip.role in ('contributor', 'coordinator')
      and eligible_incident_person(ip.person_id, ip.organization_id)
  )
);

create policy audit_checklist_status_append on audit_events for insert with check (
  category = 'checklist.task.updated' and person_id = current_person()
  and incident_id is not null and subject_table = 'checklist_items'
  and payload->'changed' = '["status"]'::jsonb
  and payload - 'revision' - 'changed' - 'status' = '{}'::jsonb
  and can_read_incident(incident_id)
  and exists (
    select 1 from checklist_items c
    join incidents i on i.id = c.incident_id
    join incident_participants ip on ip.id = c.assigned_participant_id
      and ip.incident_id = c.incident_id
    where c.id = audit_events.subject_id
      and c.incident_id = audit_events.incident_id
      and i.jurisdiction_id = audit_events.jurisdiction_id
      and c.revision::text = audit_events.payload->>'revision'
      and c.status = audit_events.payload->>'status'
      and ip.person_id = current_person() and ip.revoked_at is null
      and ip.expires_at > now() and ip.role in ('contributor', 'coordinator')
      and eligible_incident_person(ip.person_id, ip.organization_id)
  )
);

drop policy checklist_complete on checklist_items;
create policy checklist_task_update on checklist_items for update
  using (checklist_actor_can_update(checklist_items))
  with check (checklist_actor_can_update(checklist_items));

create function validate_checklist_task_update() returns trigger
language plpgsql security invoker set search_path = pg_catalog, public as $$
declare
  owner_id uuid;
  actor_position uuid;
  actor_title text;
  participant incident_participants%rowtype;
  metadata_changed boolean;
begin
  if new.id is distinct from old.id or new.created_at is distinct from old.created_at
    or new.incident_id <> old.incident_id or new.sort_order <> old.sort_order then
    raise exception 'checklist task scope is immutable';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(old.incident_id::text, 82::bigint));
  select i.jurisdiction_id into owner_id from incidents i
  where i.id = old.incident_id and i.closed_at is null;
  if owner_id is null then raise exception 'incident is closed'; end if;

  metadata_changed := row(new.item, new.category, new.due_at, new.position_id,
    new.assigned_participant_id) is distinct from row(old.item, old.category, old.due_at,
    old.position_id, old.assigned_participant_id);
  if metadata_changed and not is_admin_of(owner_id) then
    raise exception 'task metadata requires incident owner admin';
  end if;
  if new.position_id is not null and not exists (
    select 1 from incident_positions ip join positions p on p.id = ip.position_id
    where ip.incident_id = old.incident_id and ip.position_id = new.position_id
      and p.jurisdiction_id = owner_id
  ) then raise exception 'assigned position is not attached to the incident'; end if;
  if new.assigned_participant_id is not null then
    select * into participant from incident_participants ip
    where ip.id = new.assigned_participant_id and ip.incident_id = old.incident_id
      and ip.organization_id <> owner_id and ip.revoked_at is null and ip.expires_at > now()
      and ip.role in ('contributor', 'coordinator')
      and eligible_incident_person(ip.person_id, ip.organization_id);
    if not found then raise exception 'assigned participant is not active for this incident'; end if;
  end if;

  if old.status = 'completed' and row(new.status, new.completed_at, new.completed_by,
    new.completed_by_position, new.completed_by_organization_id,
    new.completed_by_participation_id, new.completed_as_title) is distinct from
    row(old.status, old.completed_at, old.completed_by, old.completed_by_position,
    old.completed_by_organization_id, old.completed_by_participation_id,
    old.completed_as_title) then
    raise exception 'task completion attribution is immutable';
  end if;

  if new.status = 'completed' and old.status <> 'completed' then
    if new.position_id is not null then
      select s.active_position_id, p.title into actor_position, actor_title
      from auth_sessions s
      join positions p on p.id = s.active_position_id
      join position_assignments a on a.position_id = s.active_position_id
        and a.person_id = s.person_id and a.revoked_at is null
      where s.person_id = current_person() and s.ended_at is null
        and s.active_position_id = new.position_id and p.jurisdiction_id = owner_id
      limit 1;
      if actor_position is null then raise exception 'task requires its assigned position'; end if;
      new.completed_by_position := actor_position;
      new.completed_by_participation_id := null;
      new.completed_by_organization_id := owner_id;
      new.completed_as_title := actor_title;
    elsif new.assigned_participant_id is not null and participant.person_id = current_person() then
      new.completed_by_position := null;
      new.completed_by_participation_id := participant.id;
      new.completed_by_organization_id := participant.organization_id;
      new.completed_as_title := participant.incident_position_title;
    else
      raise exception 'task has no current assignee';
    end if;
    new.completed_at := now();
    new.completed_by := current_person();
  elsif new.status is distinct from old.status and not (
    is_admin_of(owner_id) or checklist_actor_can_update(old)
  ) then
    raise exception 'task status requires the current assignee';
  end if;

  new.revision := old.revision + 1;
  new.updated_at := now();
  return new;
end
$$;
revoke all on function validate_checklist_task_update() from public;
grant execute on function validate_checklist_task_update() to app_runtime;
create trigger checklist_task_update_guard before update on checklist_items
  for each row execute function validate_checklist_task_update();
