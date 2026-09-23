-- Contacts directory and mass notification.
--
-- Each jurisdiction keeps a directory of people to reach, which its members
-- read and its admins maintain, and named groups of them in call-down order.
-- A mass notification sends one message to a group or a list of contacts by
-- email, SMS and in-app notice, either to everyone at once or as a
-- call-down: one contact at a time in group order, moving to the next when
-- the current one has not acknowledged within the interval, until enough
-- have acknowledged. Each contact and channel is one notification and, for
-- email and SMS, one delivery row, so the delivery worker's retries, dead
-- letters and receipts apply unchanged. Email and SMS recipients acknowledge
-- through a link carrying a per-recipient token; only its hash is stored.
-- In-app recipients acknowledge the notification itself.

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  jurisdiction_id uuid not null references public.jurisdictions(id),
  name text not null check (length(name) between 1 and 200),
  organization text check (length(organization) <= 200),
  title text check (length(title) <= 200),
  emails text[] not null default '{}' check (cardinality(emails) <= 5),
  phones text[] not null default '{}' check (cardinality(phones) <= 5),
  person_id uuid references public.persons(id),
  position_id uuid references public.positions(id),
  notes text check (length(notes) <= 2000),
  active boolean not null default true,
  updated_by uuid not null references public.persons(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, jurisdiction_id)
);

create index contacts_directory on public.contacts (jurisdiction_id, name, id);

create table public.contact_groups (
  id uuid primary key default gen_random_uuid(),
  jurisdiction_id uuid not null references public.jurisdictions(id),
  name text not null check (length(name) between 1 and 200),
  updated_by uuid not null references public.persons(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (jurisdiction_id, name),
  unique (id, jurisdiction_id)
);

-- Members in call-down order, lowest priority first. Both keys carry the
-- jurisdiction, so a group can hold only its own jurisdiction's contacts.
create table public.contact_group_members (
  group_id uuid not null,
  contact_id uuid not null,
  jurisdiction_id uuid not null,
  priority integer not null check (priority >= 1),
  primary key (group_id, contact_id),
  foreign key (group_id, jurisdiction_id)
    references public.contact_groups(id, jurisdiction_id) on delete cascade,
  foreign key (contact_id, jurisdiction_id)
    references public.contacts(id, jurisdiction_id) on delete cascade
);

create index contact_group_members_contact on public.contact_group_members (contact_id);

alter table public.contacts enable row level security;
alter table public.contact_groups enable row level security;
alter table public.contact_group_members enable row level security;

create policy contacts_read on public.contacts
  for select using (public.is_member_of(jurisdiction_id));
create policy contacts_insert on public.contacts
  for insert with check (public.is_admin_of(jurisdiction_id));
create policy contacts_update on public.contacts
  for update using (public.is_admin_of(jurisdiction_id));
create policy contacts_delete on public.contacts
  for delete using (public.is_admin_of(jurisdiction_id));

create policy contact_groups_read on public.contact_groups
  for select using (public.is_member_of(jurisdiction_id));
create policy contact_groups_insert on public.contact_groups
  for insert with check (public.is_admin_of(jurisdiction_id));
create policy contact_groups_update on public.contact_groups
  for update using (public.is_admin_of(jurisdiction_id));
create policy contact_groups_delete on public.contact_groups
  for delete using (public.is_admin_of(jurisdiction_id));

create policy contact_group_members_read on public.contact_group_members
  for select using (public.is_member_of(jurisdiction_id));
create policy contact_group_members_insert on public.contact_group_members
  for insert with check (public.is_admin_of(jurisdiction_id));
create policy contact_group_members_delete on public.contact_group_members
  for delete using (public.is_admin_of(jurisdiction_id));

grant select, insert, update, delete on table public.contacts to app_runtime;
grant select, insert, update, delete on table public.contact_groups to app_runtime;
grant select, insert, delete on table public.contact_group_members to app_runtime;

-- One send. The link base is the address acknowledgement links point at,
-- fixed at send time so later call-down steps use the same one.
create table public.mass_notifications (
  id uuid primary key default gen_random_uuid(),
  jurisdiction_id uuid not null references public.jurisdictions(id),
  subject text not null check (length(subject) between 1 and 200),
  message text not null check (length(message) between 1 and 2000),
  group_id uuid references public.contact_groups(id) on delete set null,
  group_name text,
  channels text[] not null
    check (cardinality(channels) >= 1 and channels <@ array['email', 'sms', 'inapp']),
  mode text not null check (mode in ('broadcast', 'calldown')),
  interval_minutes integer check (interval_minutes between 1 and 1440),
  acknowledgements_needed integer not null default 1 check (acknowledgements_needed between 1 and 500),
  link_base text not null,
  sent_by uuid not null references public.persons(id),
  created_at timestamptz not null default now(),
  -- Set when a call-down stops: enough acknowledgements, or no one left to call.
  completed_at timestamptz,
  check (mode = 'broadcast' or interval_minutes is not null),
  unique (id, jurisdiction_id)
);

create index mass_notifications_recent
  on public.mass_notifications (jurisdiction_id, created_at desc, id desc);
create index mass_notifications_calling on public.mass_notifications (jurisdiction_id)
  where mode = 'calldown' and completed_at is null;

-- Each contact the send reaches, with the addresses it had when sent. A
-- call-down contact not yet called has no notified_at and no token.
create table public.mass_notification_recipients (
  id uuid primary key default gen_random_uuid(),
  mass_notification_id uuid not null,
  jurisdiction_id uuid not null,
  priority integer not null check (priority >= 1),
  contact_id uuid references public.contacts(id) on delete set null,
  name text not null,
  email text,
  phone text,
  person_id uuid references public.persons(id),
  position_id uuid references public.positions(id),
  notified_at timestamptz,
  token_hash text unique,
  token_expires_at timestamptz,
  acknowledged_at timestamptz,
  acknowledged_via text check (acknowledged_via in ('link', 'app')),
  foreign key (mass_notification_id, jurisdiction_id)
    references public.mass_notifications(id, jurisdiction_id),
  unique (mass_notification_id, priority)
);

alter table public.mass_notifications enable row level security;
alter table public.mass_notification_recipients enable row level security;

create policy mass_notifications_read on public.mass_notifications
  for select using (public.is_member_of(jurisdiction_id));
create policy mass_notifications_insert on public.mass_notifications
  for insert with check (public.is_writer_of(jurisdiction_id) and sent_by = public.current_person());
create policy mass_notifications_update on public.mass_notifications
  for update using (public.is_writer_of(jurisdiction_id));

create policy mass_notification_recipients_read on public.mass_notification_recipients
  for select using (public.is_member_of(jurisdiction_id));
create policy mass_notification_recipients_insert on public.mass_notification_recipients
  for insert with check (public.is_writer_of(jurisdiction_id));
create policy mass_notification_recipients_update on public.mass_notification_recipients
  for update using (public.is_writer_of(jurisdiction_id));

-- Acknowledgement is written only by the functions below, never by a route:
-- the schema's default table update grant is narrowed to the columns sending
-- and escalation write.
revoke update on table public.mass_notifications, public.mass_notification_recipients from app_runtime;
grant select, insert on table public.mass_notifications to app_runtime;
grant update (completed_at) on table public.mass_notifications to app_runtime;
grant select, insert on table public.mass_notification_recipients to app_runtime;
grant update (notified_at, token_hash, token_expires_at)
  on table public.mass_notification_recipients to app_runtime;

alter table public.notifications
  add column mass_recipient_id uuid references public.mass_notification_recipients(id);
create index notifications_mass_recipient on public.notifications (mass_recipient_id)
  where mass_recipient_id is not null;

-- An in-app notice acknowledged in the app acknowledges its recipient, when
-- the notice is addressed to that recipient's person or position.
create function public.mass_recipient_acknowledged() returns trigger
  language plpgsql security definer
  set search_path to 'pg_catalog', 'public', 'pg_temp'
  as $$
begin
  update public.mass_notification_recipients r
  set acknowledged_at = new.acknowledged_at, acknowledged_via = 'app'
  where r.id = old.mass_recipient_id and r.acknowledged_at is null
    and ((new.person_id is not null and new.person_id = r.person_id)
         or (new.person_id is null and new.position_id = r.position_id));
  return null;
end $$;

create trigger notifications_mass_acknowledged after update of acknowledged_at on public.notifications
  for each row
  when (old.mass_recipient_id is not null and new.mass_recipient_id = old.mass_recipient_id
        and old.acknowledged_at is null and new.acknowledged_at is not null)
  execute function public.mass_recipient_acknowledged();

-- The public acknowledgement link. Given the hash of a link's token, says
-- whether the link is valid and unexpired and, when asked to, records the
-- acknowledgement of that one recipient. It returns nothing else.
create function public.acknowledge_mass_token(hashed text, record_ack boolean)
  returns boolean
  language plpgsql security definer
  set search_path to 'pg_catalog', 'public', 'pg_temp'
  as $$
declare
  recipient uuid;
begin
  select r.id into recipient from public.mass_notification_recipients r
  where r.token_hash = hashed and r.token_expires_at > now();
  if recipient is null then return false; end if;
  if record_ack then
    update public.mass_notification_recipients
    set acknowledged_at = now(), acknowledged_via = 'link'
    where id = recipient and acknowledged_at is null;
  end if;
  return true;
end $$;

-- Delivery status for a send's receipts. Members who send may not read the
-- notification list or the delivery queue under row-level security, so this
-- returns, for a send in a jurisdiction the caller belongs to, each
-- notification with its delivery's state, error and receipt, and nothing more.
create function public.mass_notification_deliveries(mass_id uuid)
  returns table (recipient_id uuid, channel text, address text, status text,
                 attempts integer, error text, receipt jsonb, updated_at timestamptz)
  language sql stable security definer
  set search_path to 'pg_catalog', 'public', 'pg_temp'
  as $$
  select n.mass_recipient_id, n.channel, d.target,
         coalesce(d.status, n.status), coalesce(d.attempts, 0), d.last_error, d.receipt,
         coalesce(d.delivered_at, n.created_at)
  from public.mass_notifications m
  join public.mass_notification_recipients r on r.mass_notification_id = m.id
  join public.notifications n on n.mass_recipient_id = r.id
  left join public.delivery_outbox d on d.notification_id = n.id
  where m.id = mass_notification_deliveries.mass_id and public.is_member_of(m.jurisdiction_id)
  order by r.priority, n.channel
$$;

revoke all on function public.acknowledge_mass_token(text, boolean) from public;
revoke all on function public.mass_notification_deliveries(uuid) from public;
grant execute on function public.acknowledge_mass_token(text, boolean) to app_runtime;
grant execute on function public.mass_notification_deliveries(uuid) to app_runtime;

-- Scheduler work discovery gains call-downs: a jurisdiction is due when one of
-- its open call-downs has had its current contact acknowledge, or has waited
-- the interval on that contact. The other kinds of work are unchanged.
create or replace function public.scheduler_due(work text, due_at timestamptz)
  returns table (jurisdiction_id uuid, person_id uuid)
  language sql stable security definer
  set search_path to 'pg_catalog', 'public', 'pg_temp'
  as $$
  with due as (
    select r.jurisdiction_id, r.created_by
    from public.notification_rules r
    where scheduler_due.work = 'rules'
      and r.enabled and r.event = 'scheduled' and r.schedule_interval_minutes is not null
      and (r.last_fired_at is null
           or r.last_fired_at <= scheduler_due.due_at - make_interval(mins => r.schedule_interval_minutes))
    union all
    select i.jurisdiction_id, b.created_by
    from public.briefings b
    join public.incidents i on i.id = b.incident_id
    where scheduler_due.work = 'briefings'
      and i.closed_at is null and b.notified_at is null and b.scheduled_at <= scheduler_due.due_at
    union all
    select m.jurisdiction_id, m.sent_by
    from public.mass_notifications m
    cross join lateral (
      select r.notified_at, r.acknowledged_at from public.mass_notification_recipients r
      where r.mass_notification_id = m.id and r.notified_at is not null
      order by r.priority desc limit 1) latest
    where scheduler_due.work = 'calldowns'
      and m.mode = 'calldown' and m.completed_at is null
      and (latest.acknowledged_at is not null
           or latest.notified_at <= scheduler_due.due_at - make_interval(mins => m.interval_minutes))
  )
  select distinct on (m.jurisdiction_id) m.jurisdiction_id, m.person_id
  from public.jurisdiction_memberships m
  join public.persons p on p.id = m.person_id and not p.disabled
  where m.role = 'admin' and m.jurisdiction_id in (select d.jurisdiction_id from due d)
  order by m.jurisdiction_id,
    exists (select 1 from due d
            where d.jurisdiction_id = m.jurisdiction_id and d.created_by = m.person_id) desc,
    m.created_at, m.person_id
$$;
