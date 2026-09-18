-- Instance federation, store-and-forward (VEOC-30, F3). Mutually
-- authenticated peers, per-board sharing agreements, and an outbox that
-- holds updates through a partition. Delivery is asynchronous: a peer
-- applies forwarded Yjs updates via the VEOC-13 reconciliation, so there
-- is no synchronous dual-commit and every jurisdiction keeps its data.

create table peers (
  id uuid primary key default gen_random_uuid(),
  jurisdiction_id uuid not null references jurisdictions (id),
  name text not null,
  token_hash text not null unique,
  created_by uuid not null references persons (id),
  created_at timestamptz not null default now()
);
create index peers_jurisdiction on peers (jurisdiction_id);

create table sharing_agreements (
  id uuid primary key default gen_random_uuid(),
  peer_id uuid not null references peers (id),
  board_id uuid not null references boards (id),
  can_read boolean not null default true,
  can_write boolean not null default false,
  created_by uuid not null references persons (id),
  created_at timestamptz not null default now(),
  unique (peer_id, board_id)
);

create table federation_outbox (
  id uuid primary key default gen_random_uuid(),
  peer_id uuid not null references peers (id),
  board_id uuid not null references boards (id),
  update_data bytea not null,
  created_at timestamptz not null default now(),
  delivered_at timestamptz
);
create index federation_outbox_pending
  on federation_outbox (peer_id, created_at) where delivered_at is null;

grant select, insert, update on peers to app_runtime;
grant select, insert, update on sharing_agreements to app_runtime;
grant select, insert, update on federation_outbox to app_runtime;

alter table peers enable row level security;
-- Members read peers; the token-authenticated receive lane (no person
-- context) must also resolve a peer by its token hash.
create policy peers_read on peers for select
  using (is_member_of(jurisdiction_id) or current_person() is null);
create policy peers_write on peers for insert with check (is_admin_of(jurisdiction_id));

alter table sharing_agreements enable row level security;
create policy agreements_read on sharing_agreements for select
  using (
    exists (select 1 from peers p where p.id = peer_id and is_member_of(p.jurisdiction_id))
    or current_person() is null
  );
create policy agreements_write on sharing_agreements for insert
  with check (exists (select 1 from peers p where p.id = peer_id and is_admin_of(p.jurisdiction_id)));

alter table federation_outbox enable row level security;
create policy outbox_read on federation_outbox for select
  using (exists (select 1 from peers p where p.id = peer_id and is_member_of(p.jurisdiction_id)));
create policy outbox_write on federation_outbox for insert
  with check (exists (select 1 from peers p where p.id = peer_id and is_writer_of(p.jurisdiction_id)));
create policy outbox_update on federation_outbox for update
  using (exists (select 1 from peers p where p.id = peer_id and is_writer_of(p.jurisdiction_id)));
