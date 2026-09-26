-- A damage report belongs to the incident it was made under, as a Public
-- Assistance line item already does, so an incident's Damage Assessment
-- screen reads its own reports and never another incident's. A report made
-- with no incident selected, and every report made before this, has none and
-- reads under every incident of its organization, labeled as such.
--
-- The public intake is issued for an incident in the same way: the one
-- token an organization holds carries the incident it was issued under, and
-- each report it takes carries that incident.

alter table public.damage_assessments add column incident_id uuid references public.incidents(id);
alter table public.damage_intake add column incident_id uuid references public.incidents(id);

create index damage_assessments_incident_page
  on public.damage_assessments (jurisdiction_id, incident_id, created_at desc, id desc);
create index damage_pa_items_incident_page
  on public.damage_pa_items (jurisdiction_id, incident_id, created_at desc, id desc);
