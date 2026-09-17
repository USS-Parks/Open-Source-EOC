-- Real-time sync substrate (VEOC-13, ADR-0003).
-- sync_updates is the durable CRDT update log per board: append-only under
-- the same three walls as the audit stream. board_records remains the
-- queryable truth; the hub checkpoints validated record state into it.

create table sync_updates (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  board_id uuid not null references boards (id),
  update_data bytea not null,
  origin_person uuid not null references persons (id),
  origin_position uuid references positions (id),
  created_at timestamptz not null default now()
);
create index sync_updates_board_seq on sync_updates (board_id, seq);

grant select, insert on sync_updates to app_runtime;
revoke update, delete on sync_updates from app_runtime;

create trigger sync_updates_no_update
  before update or delete on sync_updates
  for each row execute function audit_events_immutable();

alter table sync_updates enable row level security;
create policy sync_updates_read on sync_updates for select
  using (exists (select 1 from boards b where b.id = board_id
                 and is_member_of(b.jurisdiction_id)));
create policy sync_updates_append on sync_updates for insert
  with check (origin_person = current_person()
              and exists (select 1 from boards b where b.id = board_id
                          and is_writer_of(b.jurisdiction_id)));

-- Where CRDT semantics cannot express intent, the loser's edit surfaces
-- here, never silently (ADR-0003).
create table sync_conflicts (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references boards (id),
  record_id uuid not null,
  reason text not null,
  rejected_data jsonb not null,
  origin_person uuid not null references persons (id),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references persons (id)
);
grant select, insert, update on sync_conflicts to app_runtime;
alter table sync_conflicts enable row level security;
create policy sync_conflicts_read on sync_conflicts for select
  using (exists (select 1 from boards b where b.id = board_id
                 and is_member_of(b.jurisdiction_id)));
create policy sync_conflicts_append on sync_conflicts for insert
  with check (exists (select 1 from boards b where b.id = board_id
                      and is_member_of(b.jurisdiction_id)));
create policy sync_conflicts_resolve on sync_conflicts for update
  using (exists (select 1 from boards b where b.id = board_id
                 and is_admin_of(b.jurisdiction_id)));
