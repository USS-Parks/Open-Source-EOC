-- Dashboard definitions remain jurisdiction-owned. An active named incident
-- participant may read them only while the server binds the authorized
-- incident to this transaction; dashboard data reads add incident scoping.
drop policy dashboards_read on dashboards;

create policy dashboards_read on dashboards for select using (
  is_member_of(jurisdiction_id)
  or exists (
    select 1 from incidents i
    where i.id::text = current_setting('app.incident_id', true)
      and i.jurisdiction_id = dashboards.jurisdiction_id
      and can_read_incident(i.id)
  )
);
