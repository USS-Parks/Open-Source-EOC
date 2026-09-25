-- ICS forms as components of an incident's operational period (Veoci and
-- air gap VA37, part one). Each form is stored, edited field by field,
-- attributed and versioned, and marked draft or ready. Most forms are one per
-- period; the ICS 204 (one per assignment), 213 (messages) and 214 (activity
-- logs) may be many, told apart by a label. Every saved version is kept,
-- append-only; the component row holds the current one.
create function public.can_contribute_incident(iid uuid) returns boolean
  language sql stable security definer
  set search_path to 'pg_catalog', 'public', 'pg_temp'
  as $$
  select exists (select 1 from public.incidents i where i.id = iid
    and (public.is_writer_of(i.jurisdiction_id) or public.has_incident_participation(i.id, 'contributor')))
$$;
revoke all on function public.can_contribute_incident(uuid) from public;
grant execute on function public.can_contribute_incident(uuid) to app_runtime;

create table public.ics_form_components (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents (id),
  period_revision integer not null,
  operational_period text not null,
  form_id text not null check (form_id in (
    'ICS-201', 'ICS-202', 'ICS-203', 'ICS-204', 'ICS-205', 'ICS-205A', 'ICS-206', 'ICS-207',
    'ICS-208', 'ICS-209', 'ICS-211', 'ICS-213', 'ICS-214', 'ICS-215', 'ICS-215A')),
  -- What tells several forms of one period apart; empty for a form that is one per period.
  label text not null default '' check (length(label) <= 200),
  edition text not null,
  version integer not null default 1 check (version >= 1),
  status text not null default 'draft' check (status in ('draft', 'ready')),
  field_values jsonb not null,
  prepared_by uuid not null references public.persons (id),
  prepared_role_label text not null,
  prepared_organization_id uuid not null,
  prepared_participation_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (incident_id, period_revision, form_id, label),
  constraint ics_form_components_period_reference foreign key (incident_id, period_revision)
    references public.incident_area_revisions (incident_id, revision)
);
create index ics_form_components_period on public.ics_form_components (incident_id, period_revision);

create table public.ics_form_component_versions (
  component_id uuid not null references public.ics_form_components (id),
  version integer not null,
  status text not null,
  label text not null,
  field_values jsonb not null,
  saved_by uuid not null references public.persons (id),
  saved_role_label text not null,
  saved_at timestamptz not null default now(),
  primary key (component_id, version)
);

create function public.reject_ics_form_component_version_change() returns trigger
  language plpgsql
  as $$
begin
  raise exception 'ICS form component versions are append-only';
end $$;
create trigger ics_form_component_versions_immutable before delete or update on public.ics_form_component_versions
  for each row execute function public.reject_ics_form_component_version_change();

-- Each new component and each new version is kept; a save moves the version by one.
create function public.keep_ics_form_component_version() returns trigger
  language plpgsql security definer
  set search_path to 'pg_catalog', 'public', 'pg_temp'
  as $$
begin
  if tg_op = 'UPDATE' then
    if new.incident_id <> old.incident_id or new.period_revision <> old.period_revision or new.form_id <> old.form_id then
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
create trigger ics_form_component_versions_keep after insert or update on public.ics_form_components
  for each row execute function public.keep_ics_form_component_version();

alter table public.ics_form_components enable row level security;
create policy ics_form_components_read on public.ics_form_components for select
  using (public.can_read_incident(incident_id));
create policy ics_form_components_insert on public.ics_form_components for insert
  with check (prepared_by = public.current_person() and public.can_contribute_incident(incident_id));
create policy ics_form_components_update on public.ics_form_components for update
  using (public.can_contribute_incident(incident_id))
  with check (prepared_by = public.current_person() and public.can_contribute_incident(incident_id));
grant select, insert, update on table public.ics_form_components to app_runtime;

-- A partner organization's contributor writes to the owner's audit trail
-- only through this, for a component they saved last, as for an IAP.
create function public.append_ics_form_participant_audit(component uuid, event_category text, event_payload jsonb)
  returns uuid
  language plpgsql security definer
  set search_path to 'pg_catalog', 'public', 'pg_temp'
  as $$
declare
  actor uuid := public.current_person();
  owner_organization uuid;
  incident uuid;
  event_id uuid;
begin
  if event_category not in ('ics_form.created', 'ics_form.saved') then
    raise exception 'unsupported ICS form participant audit category';
  end if;
  select i.jurisdiction_id, i.id into owner_organization, incident
  from public.ics_form_components c join public.incidents i on i.id = c.incident_id
  where c.id = component and c.prepared_by = actor
    and public.has_incident_participation(c.incident_id, 'contributor');
  if owner_organization is null then
    raise exception 'ICS form participant audit authority is not current';
  end if;
  insert into public.audit_events
    (jurisdiction_id, incident_id, person_id, category, subject_table, subject_id, payload)
  values (owner_organization, incident, actor, event_category, 'ics_form_components', component, event_payload)
  returning id into event_id;
  return event_id;
end $$;
revoke all on function public.append_ics_form_participant_audit(uuid, text, jsonb) from public;
grant execute on function public.append_ics_form_participant_audit(uuid, text, jsonb) to app_runtime;

alter table public.ics_form_component_versions enable row level security;
create policy ics_form_component_versions_read on public.ics_form_component_versions for select
  using (exists (select 1 from public.ics_form_components c
    where c.id = component_id and public.can_read_incident(c.incident_id)));
-- Only the trigger writes a version; the runtime reads them.
revoke insert, update, delete on table public.ics_form_component_versions from app_runtime;
grant select on table public.ics_form_component_versions to app_runtime;
