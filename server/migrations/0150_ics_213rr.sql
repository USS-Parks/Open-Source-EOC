-- The ICS 213RR as a form component of the period (Veoci and air gap VA38).
-- A 213RR is started from one of the incident's resource requests and stays
-- tied to it; no other form names a request.
alter table public.ics_form_components drop constraint ics_form_components_form_id_check;
alter table public.ics_form_components add constraint ics_form_components_form_id_check check (form_id in (
  'ICS-201', 'ICS-202', 'ICS-203', 'ICS-204', 'ICS-205', 'ICS-205A', 'ICS-206', 'ICS-207',
  'ICS-208', 'ICS-209', 'ICS-211', 'ICS-213', 'ICS-213RR', 'ICS-214', 'ICS-215', 'ICS-215A'));
alter table public.ics_form_components
  add column resource_request_id uuid references public.resource_requests (id),
  add constraint ics_form_components_request_names_213rr
    check ((form_id = 'ICS-213RR') = (resource_request_id is not null));

-- A component keeps its request, as it keeps its incident, period and form.
create or replace function public.keep_ics_form_component_version() returns trigger
  language plpgsql security definer
  set search_path to 'pg_catalog', 'public', 'pg_temp'
  as $$
begin
  if tg_op = 'UPDATE' then
    if new.incident_id <> old.incident_id or new.period_revision <> old.period_revision or new.form_id <> old.form_id
      or new.resource_request_id is distinct from old.resource_request_id then
      raise exception 'an ICS form component keeps its incident, period and form';
    end if;
    if new.version = old.version then
      if new.field_values is distinct from old.field_values or new.status is distinct from old.status
        or new.label is distinct from old.label then
        raise exception 'saving an ICS form component moves its version';
      end if;
      return new;
    end if;
    if new.version <> old.version + 1 then
      raise exception 'an ICS form component version moves by one';
    end if;
  end if;
  insert into public.ics_form_component_versions
    (component_id, version, status, label, field_values, saved_by, saved_role_label)
  values (new.id, new.version, new.status, new.label, new.field_values, new.prepared_by, new.prepared_role_label);
  return new;
end $$;
