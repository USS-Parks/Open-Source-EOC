-- Notification engine (VEOC-14, F4). Rules are per-jurisdiction data;
-- deliveries are logged rows, so a failed channel is a visible record,
-- never a silent drop.

create table notification_rules (
  id uuid primary key default gen_random_uuid(),
  jurisdiction_id uuid not null references jurisdictions (id),
  board_id uuid references boards (id),
  event text not null check (event in ('record.created', 'record.updated', 'scheduled')),
  condition jsonb not null default '{}',
  channels jsonb not null,
  webhook_secret text,
  schedule_interval_minutes integer,
  last_fired_at timestamptz,
  enabled boolean not null default true,
  created_by uuid not null references persons (id),
  created_at timestamptz not null default now()
);
create index notification_rules_jurisdiction on notification_rules (jurisdiction_id)
  where enabled;

create table notifications (
  id uuid primary key default gen_random_uuid(),
  jurisdiction_id uuid not null references jurisdictions (id),
  rule_id uuid references notification_rules (id),
  person_id uuid references persons (id),
  position_id uuid references positions (id),
  channel text not null,
  title text not null,
  body text not null default '',
  status text not null check (status in ('delivered', 'failed')),
  detail jsonb not null default '{}',
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index notifications_person on notifications (person_id, created_at desc)
  where person_id is not null;
create index notifications_position on notifications (position_id, created_at desc)
  where position_id is not null;

grant select, insert, update on notification_rules, notifications to app_runtime;

alter table notification_rules enable row level security;
create policy rules_read on notification_rules for select
  using (is_member_of(jurisdiction_id));
create policy rules_write on notification_rules for insert
  with check (is_admin_of(jurisdiction_id));
create policy rules_update on notification_rules for update
  using (is_admin_of(jurisdiction_id) or is_member_of(jurisdiction_id));

alter table notifications enable row level security;
-- The tray: your own notifications, plus those aimed at any position you
-- hold an active assignment for.
create policy notifications_read on notifications for select
  using (
    person_id = current_person()
    or (position_id is not null and exists (
      select 1 from position_assignments a
      where a.position_id = notifications.position_id
        and a.person_id = current_person() and a.revoked_at is null))
    or is_admin_of(jurisdiction_id)
  );
create policy notifications_write on notifications for insert
  with check (is_member_of(jurisdiction_id));
create policy notifications_mark_read on notifications for update
  using (person_id = current_person()
    or (position_id is not null and exists (
      select 1 from position_assignments a
      where a.position_id = notifications.position_id
        and a.person_id = current_person() and a.revoked_at is null)));
