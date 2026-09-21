-- Declarative board workflow runtime. Definitions remain in immutable board
-- template versions; instances pin the version under which they started.

create table board_workflow_instances (
  record_id uuid primary key references board_records (id),
  board_id uuid not null references boards (id),
  jurisdiction_id uuid not null references jurisdictions (id),
  incident_id uuid references incidents (id),
  template_key text not null,
  template_version integer not null,
  state_key text not null,
  state_revision integer not null default 0 check (state_revision >= 0),
  transition_key text,
  transitioned_at timestamptz not null default now(),
  due_at timestamptz,
  due_status text not null default 'none' check (due_status in ('none', 'scheduled', 'missing')),
  assignment_kind text check (assignment_kind in ('position', 'incident_participant')),
  assignment_position_id uuid references positions (id),
  assignment_participant_id uuid references incident_participants (id),
  assignment_snapshot jsonb,
  pending_transition_key text,
  pending_to_state text,
  pending_requested_by uuid references persons (id),
  pending_assignment_request jsonb,
  pending_assignment_snapshot jsonb,
  pending_started_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (template_key, template_version) references board_templates (key, version),
  check (
    (assignment_kind is null and assignment_position_id is null and assignment_participant_id is null)
    or (assignment_kind = 'position' and assignment_position_id is not null and assignment_participant_id is null)
    or (assignment_kind = 'incident_participant' and assignment_position_id is null and assignment_participant_id is not null)
  ),
  check (
    (pending_transition_key is null and pending_to_state is null and pending_requested_by is null
      and pending_assignment_request is null and pending_assignment_snapshot is null
      and pending_started_at is null)
    or (pending_transition_key is not null and pending_to_state is not null
      and pending_requested_by is not null and pending_started_at is not null)
  ),
  check ((pending_assignment_request is null) = (pending_assignment_snapshot is null))
);
create index board_workflow_instances_board on board_workflow_instances (board_id, state_key);
create index board_workflow_instances_incident on board_workflow_instances (incident_id)
  where incident_id is not null;

create table board_workflow_history (
  id uuid primary key default gen_random_uuid(),
  sequence bigint generated always as identity unique,
  record_id uuid not null references board_workflow_instances (record_id),
  board_id uuid not null references boards (id),
  jurisdiction_id uuid not null references jurisdictions (id),
  incident_id uuid references incidents (id),
  state_revision integer not null check (state_revision >= 0),
  event_kind text not null check (event_kind in (
    'transition_requested', 'approval_recorded', 'transition_completed', 'escalation')),
  event_key text not null,
  from_state text,
  to_state text,
  actor_person_id uuid not null references persons (id),
  actor_position_id uuid references positions (id),
  actor_participation_id uuid references incident_participants (id),
  detail jsonb not null default '{}',
  transaction_id bigint not null default txid_current(),
  created_at timestamptz not null default now()
);
create index board_workflow_history_record
  on board_workflow_history (record_id, created_at, id);
create unique index board_workflow_escalation_once
  on board_workflow_history (record_id, state_revision, event_kind, event_key)
  where event_kind = 'escalation';
create unique index board_workflow_completion_once
  on board_workflow_history (record_id, state_revision, event_kind)
  where event_kind = 'transition_completed';

create table board_workflow_approvals (
  id uuid primary key default gen_random_uuid(),
  record_id uuid not null references board_workflow_instances (record_id),
  board_id uuid not null references boards (id),
  jurisdiction_id uuid not null references jurisdictions (id),
  incident_id uuid references incidents (id),
  state_revision integer not null check (state_revision > 0),
  transition_key text not null,
  rule_key text not null,
  actor_person_id uuid not null references persons (id),
  actor_position_id uuid references positions (id),
  actor_participation_id uuid references incident_participants (id),
  created_at timestamptz not null default now(),
  unique (record_id, state_revision, rule_key, actor_person_id)
);

create table board_workflow_idempotency (
  record_id uuid not null references board_records (id),
  board_id uuid not null references boards (id),
  jurisdiction_id uuid not null references jurisdictions (id),
  incident_id uuid references incidents (id),
  actor_person_id uuid not null references persons (id),
  idempotency_key text not null check (length(idempotency_key) between 1 and 200),
  request_digest text not null check (length(request_digest) = 64),
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (record_id, actor_person_id, idempotency_key)
);

-- Recheck a pending requester's exact source-organization role without
-- exposing another organization's membership rows to an incident partner.
-- The caller must already hold current write authority over this same record.
create function workflow_pending_requester_authorized(rid uuid, required_role text)
returns boolean language sql stable security definer
set search_path = pg_catalog, public, pg_temp as $$
  select required_role in ('admin', 'writer', 'assigned_position') and exists (
    select 1
    from public.board_workflow_instances w
    join public.board_records r on r.id = w.record_id and r.board_id = w.board_id
      and r.incident_id is not distinct from w.incident_id
    join public.boards b on b.id = w.board_id and b.jurisdiction_id = w.jurisdiction_id
    join public.persons p on p.id = w.pending_requested_by and not p.disabled
    join public.jurisdiction_memberships m on m.person_id = p.id
      and m.jurisdiction_id = w.jurisdiction_id
    where w.record_id = rid
      and case required_role when 'admin' then m.role = 'admin'
        else m.role in ('admin', 'member') end
      and (required_role <> 'assigned_position' or (
        w.assignment_kind = 'position'
        and exists (select 1 from public.position_assignments a
          where a.position_id = w.assignment_position_id
            and a.person_id = w.pending_requested_by and a.revoked_at is null)
      ))
      and (public.is_writer_of(w.jurisdiction_id)
        or (w.incident_id is not null
          and public.has_incident_participation(w.incident_id, 'contributor')))
      and (w.incident_id is null or exists (
        select 1 from public.incidents i
        where i.id = w.incident_id and i.closed_at is null))
  )
$$;
revoke all on function workflow_pending_requester_authorized(uuid, text) from public;
grant execute on function workflow_pending_requester_authorized(uuid, text) to app_runtime;

-- Runtime history and approvals are append-only at both privilege and trigger walls.
grant select, insert, update on board_workflow_instances to app_runtime;
grant select, insert on board_workflow_history, board_workflow_approvals,
  board_workflow_idempotency to app_runtime;
grant usage, select on sequence board_workflow_history_sequence_seq to app_runtime;
revoke delete on board_workflow_instances, board_workflow_history,
  board_workflow_approvals, board_workflow_idempotency from app_runtime;
revoke update on board_workflow_history, board_workflow_approvals,
  board_workflow_idempotency from app_runtime;
create trigger board_workflow_history_immutable
  before update or delete on board_workflow_history
  for each row execute function audit_events_immutable();
create trigger board_workflow_approvals_immutable
  before update or delete on board_workflow_approvals
  for each row execute function audit_events_immutable();

alter table board_workflow_instances enable row level security;
alter table board_workflow_history enable row level security;
alter table board_workflow_approvals enable row level security;
alter table board_workflow_idempotency enable row level security;

-- Every policy binds the denormalized scope back to the actual record and
-- keeps current grants decisive.
create policy board_workflow_instances_read on board_workflow_instances for select using (
  exists (
    select 1 from board_records r join boards b on b.id = r.board_id
    where r.id = board_workflow_instances.record_id
      and r.board_id = board_workflow_instances.board_id
      and b.jurisdiction_id = board_workflow_instances.jurisdiction_id
      and r.incident_id is not distinct from board_workflow_instances.incident_id
      and (is_member_of(b.jurisdiction_id)
        or has_guest_scope(b.jurisdiction_id, 'board:' || b.id::text || ':read')
        or (r.incident_id is not null and can_read_incident(r.incident_id)))
  )
);
create policy board_workflow_instances_insert on board_workflow_instances for insert with check (
  exists (
    select 1 from board_records r join boards b on b.id = r.board_id
    where r.id = board_workflow_instances.record_id
      and r.board_id = board_workflow_instances.board_id
      and b.jurisdiction_id = board_workflow_instances.jurisdiction_id
      and r.incident_id is not distinct from board_workflow_instances.incident_id
      and (is_writer_of(b.jurisdiction_id)
        or (r.incident_id is not null and has_incident_participation(r.incident_id, 'contributor')))
  )
);
create policy board_workflow_instances_update on board_workflow_instances for update using (
  exists (
    select 1 from board_records r join boards b on b.id = r.board_id
    where r.id = board_workflow_instances.record_id
      and r.board_id = board_workflow_instances.board_id
      and b.jurisdiction_id = board_workflow_instances.jurisdiction_id
      and r.incident_id is not distinct from board_workflow_instances.incident_id
      and (is_writer_of(b.jurisdiction_id)
        or (r.incident_id is not null and has_incident_participation(r.incident_id, 'contributor')))
  )
);

create policy board_workflow_history_read on board_workflow_history for select using (
  exists (select 1 from board_workflow_instances w
    where w.record_id = board_workflow_history.record_id)
);
create policy board_workflow_history_insert on board_workflow_history for insert with check (
  actor_person_id = current_person()
  and exists (select 1 from board_workflow_instances w
    where w.record_id = board_workflow_history.record_id
      and w.board_id = board_workflow_history.board_id
      and w.jurisdiction_id = board_workflow_history.jurisdiction_id
      and w.incident_id is not distinct from board_workflow_history.incident_id)
);
create policy board_workflow_approvals_read on board_workflow_approvals for select using (
  exists (select 1 from board_workflow_instances w
    where w.record_id = board_workflow_approvals.record_id)
);
create policy board_workflow_approvals_insert on board_workflow_approvals for insert with check (
  actor_person_id = current_person()
  and exists (select 1 from board_workflow_instances w
    where w.record_id = board_workflow_approvals.record_id
      and w.board_id = board_workflow_approvals.board_id
      and w.jurisdiction_id = board_workflow_approvals.jurisdiction_id
      and w.incident_id is not distinct from board_workflow_approvals.incident_id)
);
create policy board_workflow_idempotency_read on board_workflow_idempotency for select using (
  actor_person_id = current_person()
  and exists (select 1 from board_workflow_instances w
    where w.record_id = board_workflow_idempotency.record_id)
);
create policy board_workflow_idempotency_insert on board_workflow_idempotency for insert with check (
  actor_person_id = current_person()
  and exists (select 1 from board_workflow_instances w
    where w.record_id = board_workflow_idempotency.record_id
      and w.board_id = board_workflow_idempotency.board_id
      and w.jurisdiction_id = board_workflow_idempotency.jurisdiction_id
      and w.incident_id is not distinct from board_workflow_idempotency.incident_id)
);

-- A cross-organization approver may insert only the source-owned local
-- notification for the assignment completed by that same transaction.
create policy workflow_notifications_insert on notifications for insert with check (
  channel = 'workflow' and rule_id is null and status = 'delivered'
  and exists (
    select 1
    from board_workflow_instances w
    join board_records r on r.id = w.record_id and r.board_id = w.board_id
      and r.incident_id is not distinct from w.incident_id
    join board_workflow_history h on h.record_id = w.record_id
      and h.state_revision = w.state_revision
      and h.event_kind = 'transition_completed'
      and h.actor_person_id = current_person()
      and h.transaction_id = txid_current()
      and h.id::text = notifications.detail ->> 'historyId'
    where w.record_id::text = notifications.detail ->> 'recordId'
      and w.board_id::text = notifications.detail ->> 'boardId'
      and w.jurisdiction_id = notifications.jurisdiction_id
      and w.jurisdiction_id::text = notifications.detail ->> 'sourceJurisdictionId'
      and coalesce(w.incident_id::text, '') = coalesce(notifications.detail ->> 'incidentId', '')
      and (is_writer_of(w.jurisdiction_id)
        or (w.incident_id is not null
          and has_incident_participation(w.incident_id, 'contributor')))
      and ((w.assignment_kind = 'position'
          and notifications.person_id is null
          and notifications.position_id = w.assignment_position_id)
        or (w.assignment_kind = 'incident_participant'
          and notifications.position_id is null
          and notifications.person_id::text = w.assignment_snapshot ->> 'personId'))
  )
);
create unique index workflow_notification_history_once
  on notifications (channel, ((detail ->> 'historyId')))
  where channel = 'workflow' and detail ? 'historyId';
