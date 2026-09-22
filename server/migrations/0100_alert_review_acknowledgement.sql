-- D28: acknowledgement is separate from read state. CAP review is an
-- append-only attribution log; stored CAP alert content remains immutable.
alter table notifications
  add column acknowledged_at timestamptz,
  add column acknowledged_by uuid references persons (id);

create table cap_alert_reviews (
  id uuid primary key default gen_random_uuid(),
  alert_id uuid not null references cap_alerts (id),
  jurisdiction_id uuid not null references jurisdictions (id),
  revision integer not null check (revision > 0),
  state text not null check (state in ('draft', 'in_review', 'approved')),
  actor_person_id uuid not null references persons (id),
  created_at timestamptz not null default now(),
  unique (alert_id, revision)
);
create index cap_alert_reviews_latest
  on cap_alert_reviews (alert_id, revision desc);
create index notifications_unacknowledged
  on notifications (person_id, created_at desc)
  where acknowledged_at is null;

grant select, insert on cap_alert_reviews to app_runtime;
alter table cap_alert_reviews enable row level security;
create policy cap_alert_reviews_read on cap_alert_reviews for select
  using (is_member_of(jurisdiction_id));
create policy cap_alert_reviews_insert on cap_alert_reviews for insert
  with check (is_writer_of(jurisdiction_id)
    and actor_person_id = current_person()
    and exists (select 1 from cap_alerts a
      where a.id = alert_id and a.jurisdiction_id = cap_alert_reviews.jurisdiction_id));
