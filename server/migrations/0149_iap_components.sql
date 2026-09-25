-- An IAP assembled from the period's ICS form components (Veoci and air gap
-- VA37, part two). Each plan revision holds the components the planning
-- section chose, each at the version it was assembled with; the plan's stored
-- content is those versions rendered. A draft plan may take a component's
-- newer version, which moves its content revision; once submitted, a plan's
-- components are fixed, and a change after approval makes a new revision.
create table public.iap_components (
  iap_id uuid not null references public.iaps (id),
  component_id uuid not null references public.ics_form_components (id),
  version integer not null,
  ordinal integer not null check (ordinal >= 0),
  primary key (iap_id, component_id),
  unique (iap_id, ordinal),
  constraint iap_components_version_reference foreign key (component_id, version)
    references public.ics_form_component_versions (component_id, version)
);
create index iap_components_component on public.iap_components (component_id);

-- A plan's components belong to its incident and period, and change only while it is a draft.
create function public.guard_iap_components() returns trigger
  language plpgsql security definer
  set search_path to 'pg_catalog', 'public', 'pg_temp'
  as $$
declare
  plan record;
  part record;
begin
  if tg_op = 'DELETE' then
    raise exception 'an IAP keeps the components it was assembled with';
  end if;
  if tg_op = 'UPDATE' and (new.iap_id <> old.iap_id or new.component_id <> old.component_id or new.ordinal <> old.ordinal) then
    raise exception 'an IAP component keeps its plan, form and place';
  end if;
  select status, incident_id, period_revision into plan from public.iaps where id = new.iap_id;
  if plan.status <> 'draft' then
    raise exception 'the components of a submitted or published IAP are fixed';
  end if;
  select incident_id, period_revision into part from public.ics_form_components where id = new.component_id;
  if part.incident_id <> plan.incident_id or part.period_revision is distinct from plan.period_revision then
    raise exception 'an IAP holds only its own period''s ICS forms';
  end if;
  return new;
end $$;
create trigger iap_components_guard before insert or update or delete on public.iap_components
  for each row execute function public.guard_iap_components();

alter table public.iap_components enable row level security;
-- Read with the plan; written by the owner's writers or the plan's preparer under a contributor grant.
create function public.can_write_iap(plan uuid) returns boolean
  language sql stable security definer
  set search_path to 'pg_catalog', 'public', 'pg_temp'
  as $$
  select exists (select 1 from public.iaps i join public.incidents inc on inc.id = i.incident_id
    where i.id = plan and (public.is_writer_of(inc.jurisdiction_id)
      or (i.prepared_by = public.current_person() and public.has_incident_participation(i.incident_id, 'contributor'))))
$$;
revoke all on function public.can_write_iap(uuid) from public;
grant execute on function public.can_write_iap(uuid) to app_runtime;

create policy iap_components_read on public.iap_components for select
  using (exists (select 1 from public.iaps i where i.id = iap_id));
create policy iap_components_insert on public.iap_components for insert
  with check (public.can_write_iap(iap_id));
create policy iap_components_update on public.iap_components for update
  using (public.can_write_iap(iap_id)) with check (public.can_write_iap(iap_id));
revoke delete on table public.iap_components from app_runtime;
grant select, insert, update on table public.iap_components to app_runtime;

-- A partner's contributor records a plan taking a changed form in the owner's trail, as for the other plan events.
create or replace function public.append_iap_participant_audit(iid uuid, sid uuid, event_category text, event_payload jsonb)
  returns uuid
  language plpgsql security definer
  set search_path to 'pg_catalog', 'public', 'pg_temp'
  as $$
declare
  actor uuid := public.current_person();
  owner_organization uuid;
  event_id uuid;
begin
  if event_category not in (
    'iap.assembled', 'iap.submitted', 'iap.ics204.revised', 'iap.revision.created', 'iap.forms.refreshed'
  ) then
    raise exception 'unsupported IAP participant audit category';
  end if;
  select i.jurisdiction_id into owner_organization
  from public.iaps p join public.incidents i on i.id = p.incident_id
  where p.id = sid and p.incident_id = iid
    and public.has_incident_participation(p.incident_id, 'contributor')
    and (
      (event_category = 'iap.submitted' and p.submitted_by = actor)
      or (event_category <> 'iap.submitted' and p.prepared_by = actor)
    );
  if owner_organization is null then
    raise exception 'IAP participant audit authority is not current';
  end if;
  insert into public.audit_events
    (jurisdiction_id, incident_id, person_id, category, subject_table, subject_id, payload)
  values (owner_organization, iid, actor, event_category, 'iaps', sid, event_payload)
  returning id into event_id;
  return event_id;
end $$;
