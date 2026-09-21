-- VEOC-84: authoritative IAP period and creation-time attribution.
-- The stored workflow remains draft/in_approval/approved/complete; UI display
-- states and progress are derived by the service.

alter table iaps
  add column period_revision integer,
  add column prepared_organization_id uuid references jurisdictions (id),
  add column prepared_position_id uuid references positions (id),
  add column prepared_participation_id uuid references incident_participants (id),
  add column prepared_role_key text,
  add column prepared_role_label text,
  add column submitted_by uuid references persons (id),
  add column submitted_at timestamptz;

update iaps i set
  prepared_organization_id = inc.jurisdiction_id,
  prepared_role_key = 'legacy',
  prepared_role_label = 'Legacy preparation'
from incidents inc where inc.id = i.incident_id;

alter table iaps
  alter column prepared_organization_id set not null,
  alter column prepared_role_key set not null,
  alter column prepared_role_label set not null,
  add constraint iaps_period_reference foreign key (incident_id, period_revision)
    references incident_area_revisions (incident_id, revision),
  add constraint iaps_prepared_role_key_valid
    check (length(trim(prepared_role_key)) between 1 and 160),
  add constraint iaps_prepared_role_label_valid
    check (length(trim(prepared_role_label)) between 1 and 160),
  add constraint iaps_submission_complete check (
    (submitted_by is null and submitted_at is null) or
    (submitted_by is not null and submitted_at is not null and isfinite(submitted_at))
  );

create index iaps_workspace_filters
  on iaps (incident_id, prepared_organization_id, prepared_role_key, period_revision, created_at desc);

create function enforce_iap_attribution_and_transition() returns trigger
language plpgsql as $$
declare
  actor uuid := current_person();
  owner_organization uuid;
  owner_writer boolean;
  owner_admin boolean;
  active_participant boolean;
  active_position boolean;
begin
  select jurisdiction_id into owner_organization from incidents where id = new.incident_id;
  if owner_organization is null then raise exception 'incident not found'; end if;
  select is_writer_of(owner_organization), is_admin_of(owner_organization)
    into owner_writer, owner_admin;

  select exists (
    select 1 from incident_participants ip
    where ip.id = new.prepared_participation_id
      and ip.incident_id = new.incident_id
      and ip.organization_id = new.prepared_organization_id
      and ip.person_id = actor and ip.role in ('contributor', 'coordinator')
      and ip.revoked_at is null and ip.expires_at > now()
      and eligible_incident_person(ip.person_id, ip.organization_id)
  ) into active_participant;

  select exists (
    select 1 from positions p
    join position_assignments pa on pa.position_id = p.id
    join auth_sessions s on s.person_id = actor and s.active_position_id = p.id
    where p.id = new.prepared_position_id and p.jurisdiction_id = owner_organization
      and pa.person_id = actor and pa.revoked_at is null
      and s.id is not null and s.ended_at is null
  ) into active_position;

  if tg_op = 'INSERT' then
    if new.prepared_by is distinct from actor or new.status <> 'draft'
      or new.submitted_by is not null or new.approved_by is not null then
      raise exception 'invalid initial IAP attribution';
    end if;
    if new.prepared_participation_id is not null then
      if not active_participant or new.prepared_position_id is not null then
        raise exception 'IAP participant attribution is not current';
      end if;
    elsif new.prepared_organization_id <> owner_organization or not owner_writer
      or (new.prepared_position_id is not null and not active_position) then
      raise exception 'IAP owner attribution is not current';
    end if;
    return new;
  end if;

  if row(new.id, new.incident_id, new.prepared_by, new.prepared_organization_id,
         new.prepared_position_id, new.prepared_participation_id,
         new.prepared_role_key, new.prepared_role_label, new.created_at)
     is distinct from
     row(old.id, old.incident_id, old.prepared_by, old.prepared_organization_id,
         old.prepared_position_id, old.prepared_participation_id,
         old.prepared_role_key, old.prepared_role_label, old.created_at) then
    raise exception 'IAP preparation attribution is immutable';
  end if;
  if row(new.operational_period, new.period_revision) is distinct from
     row(old.operational_period, old.period_revision) then
    raise exception 'IAP period binding is immutable';
  end if;
  if old.submitted_by is not null and
     row(new.submitted_by, new.submitted_at) is distinct from
     row(old.submitted_by, old.submitted_at) then
    raise exception 'IAP submission attribution is immutable';
  end if;
  if old.approved_by is not null and
     row(new.approved_by, new.approved_at) is distinct from
     row(old.approved_by, old.approved_at) then
    raise exception 'IAP approval attribution is immutable';
  end if;

  if new.status = old.status then
    if old.status <> 'draft' and
       row(new.operational_period, new.period_revision, new.form_ids, new.content)
       is distinct from
       row(old.operational_period, old.period_revision, old.form_ids, old.content) then
      raise exception 'submitted or published IAP content is locked';
    end if;
    if row(new.submitted_by, new.submitted_at, new.approved_by, new.approved_at)
       is distinct from
       row(old.submitted_by, old.submitted_at, old.approved_by, old.approved_at) then
      raise exception 'IAP handoff attribution requires a state transition';
    end if;
    return new;
  end if;

  if row(new.operational_period, new.period_revision, new.form_ids, new.content)
     is distinct from
     row(old.operational_period, old.period_revision, old.form_ids, old.content) then
    raise exception 'IAP content cannot change during a state transition';
  end if;

  if old.status = 'draft' and new.status = 'in_approval' then
    select exists (
      select 1 from incident_participants ip
      where ip.id = old.prepared_participation_id and ip.incident_id = old.incident_id
        and ip.person_id = actor and ip.role in ('contributor', 'coordinator')
        and ip.revoked_at is null and ip.expires_at > now()
        and eligible_incident_person(ip.person_id, ip.organization_id)
    ) into active_participant;
    if not owner_writer and not (old.prepared_by = actor and active_participant) then
      raise exception 'IAP submission requires current writer authority';
    end if;
    if new.submitted_by is distinct from actor or new.submitted_at is null then
      raise exception 'IAP submission attribution is required';
    end if;
  elsif old.status in ('draft', 'in_approval') and new.status = 'approved' then
    if not owner_admin then raise exception 'IAP approval requires incident owner admin'; end if;
    if new.approved_by is distinct from actor or new.approved_at is null then
      raise exception 'IAP approval attribution is required';
    end if;
  elsif old.status = 'approved' and new.status = 'complete' then
    if not owner_admin then raise exception 'IAP completion requires incident owner admin'; end if;
  else
    raise exception 'illegal IAP state transition';
  end if;
  return new;
end $$;

create trigger iap_attribution_transition_guard
before insert or update on iaps
for each row execute function enforce_iap_attribution_and_transition();

drop policy iaps_read on iaps;
create policy iaps_authorized_read on iaps for select
  using (
    exists (select 1 from incidents i where i.id = incident_id
      and is_member_of(i.jurisdiction_id))
    or (prepared_by = current_person() and exists (
      select 1 from incident_participants ip
      where ip.id = prepared_participation_id and ip.incident_id = incident_id
        and ip.person_id = current_person()
        and ip.role in ('contributor', 'coordinator')
        and ip.revoked_at is null and ip.expires_at > now()
        and eligible_incident_person(ip.person_id, ip.organization_id)
    ))
  );

drop policy iaps_write on iaps;
create policy iaps_attributed_insert on iaps for insert with check (
  prepared_by = current_person() and (
    (prepared_participation_id is null and exists (
      select 1 from incidents i where i.id = incident_id
        and prepared_organization_id = i.jurisdiction_id
        and is_writer_of(i.jurisdiction_id)
    )) or exists (
      select 1 from incident_participants ip
      where ip.id = prepared_participation_id and ip.incident_id = incident_id
        and ip.person_id = current_person()
        and ip.organization_id = prepared_organization_id
        and ip.role in ('contributor', 'coordinator')
        and ip.revoked_at is null and ip.expires_at > now()
        and eligible_incident_person(ip.person_id, ip.organization_id)
    )
  )
);

drop policy iaps_update on iaps;
create policy iaps_bounded_transition_update on iaps for update
  using (
    exists (select 1 from incidents i where i.id = incident_id
      and is_writer_of(i.jurisdiction_id))
    or (prepared_by = current_person() and exists (
      select 1 from incident_participants ip
      where ip.id = prepared_participation_id and ip.incident_id = incident_id
        and ip.person_id = current_person()
        and ip.role in ('contributor', 'coordinator')
        and ip.revoked_at is null and ip.expires_at > now()
        and eligible_incident_person(ip.person_id, ip.organization_id)
    ))
  )
  with check (
    exists (select 1 from incidents i where i.id = incident_id
      and is_writer_of(i.jurisdiction_id))
    or (prepared_by = current_person() and exists (
      select 1 from incident_participants ip
      where ip.id = prepared_participation_id and ip.incident_id = incident_id
        and ip.person_id = current_person()
        and ip.role in ('contributor', 'coordinator')
        and ip.revoked_at is null and ip.expires_at > now()
        and eligible_incident_person(ip.person_id, ip.organization_id)
    ))
  );

-- A separate domain-named function appends only the two partner IAP receipts.
-- Existing audit_append remains unchanged for owner-jurisdiction members.
create function append_iap_participant_audit(
  iid uuid, sid uuid, event_category text, event_payload jsonb
) returns uuid language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $$
declare
  actor uuid := public.current_person();
  owner_organization uuid;
  event_id uuid;
begin
  if event_category not in ('iap.assembled', 'iap.submitted') then
    raise exception 'unsupported IAP participant audit category';
  end if;
  select i.jurisdiction_id into owner_organization
  from public.iaps p join public.incidents i on i.id = p.incident_id
  where p.id = sid and p.incident_id = iid
    and public.has_incident_participation(p.incident_id, 'contributor')
    and ((event_category = 'iap.assembled' and p.prepared_by = actor)
      or (event_category = 'iap.submitted' and p.submitted_by = actor));
  if owner_organization is null then
    raise exception 'IAP participant audit authority is not current';
  end if;
  insert into public.audit_events
    (jurisdiction_id, incident_id, person_id, category, subject_table, subject_id, payload)
  values (owner_organization, iid, actor, event_category, 'iaps', sid, event_payload)
  returning id into event_id;
  return event_id;
end $$;
revoke all on function append_iap_participant_audit(uuid, uuid, text, jsonb) from public;
grant execute on function append_iap_participant_audit(uuid, uuid, text, jsonb) to app_runtime;
