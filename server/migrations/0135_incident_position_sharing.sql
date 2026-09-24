-- The incident's positions, shared with every organization on the incident.
--
-- A position the owner attaches to an incident (incident_positions) is read
-- by everyone who can read that incident, with the people who hold it now,
-- so a partner sees who owns a task or a request and whom to name as an
-- action's owner. Like the rest of the incident, this lasts while the
-- partner's grant does, after close included. The rest of the owner's roster,
-- and past holders, stay with the owner's members. Only the incident owner's
-- own positions are shared this way, whatever else incident_positions holds.
--
-- A holder's own assignment is still read through membership alone: a
-- position assigned to someone outside the owning organization does not
-- become one they can sign into because an incident they work in carries it.

create index incident_positions_position on public.incident_positions (position_id, incident_id);

create policy positions_incident_read on public.positions for select
  using (exists (
    select 1 from public.incident_positions ip
    join public.incidents i on i.id = ip.incident_id and i.jurisdiction_id = positions.jurisdiction_id
    where ip.position_id = positions.id and public.can_read_incident(ip.incident_id)));

create policy assignments_incident_read on public.position_assignments for select
  using (revoked_at is null and person_id <> public.current_person() and exists (
    select 1 from public.incident_positions ip
    join public.incidents i on i.id = ip.incident_id
    join public.positions p on p.id = ip.position_id and p.jurisdiction_id = i.jurisdiction_id
    where ip.position_id = position_assignments.position_id and public.can_read_incident(ip.incident_id)));
