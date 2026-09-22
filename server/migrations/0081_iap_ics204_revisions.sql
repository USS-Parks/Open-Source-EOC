-- IAP-row revision lineage and draft content compare-and-swap.
-- Existing IAP workflow states remain authoritative. A revision is a new IAP
-- draft that supersedes one approved row; the approved source never changes.

alter table iaps
  add column revision_root_id uuid,
  add column revision_number integer,
  add column supersedes_iap_id uuid,
  add column content_revision integer;

update iaps set
  revision_root_id = id,
  revision_number = 1,
  content_revision = 1;

alter table iaps
  alter column revision_root_id set not null,
  alter column revision_number set not null,
  alter column content_revision set not null,
  add constraint iaps_revision_root_fk foreign key (revision_root_id) references iaps (id),
  add constraint iaps_supersedes_fk foreign key (supersedes_iap_id) references iaps (id),
  add constraint iaps_revision_number_valid check (revision_number > 0),
  add constraint iaps_content_revision_valid check (content_revision > 0),
  add constraint iaps_revision_identity unique (revision_root_id, revision_number),
  add constraint iaps_one_successor unique (supersedes_iap_id),
  add constraint iaps_revision_shape check (
    (revision_number = 1 and revision_root_id = id and supersedes_iap_id is null)
    or (revision_number > 1 and revision_root_id <> id and supersedes_iap_id is not null)
  );

create index iaps_revision_lineage
  on iaps (revision_root_id, revision_number desc);

create function enforce_iap_revision_lineage() returns trigger
language plpgsql as $$
declare
  parent record;
  content_changed boolean;
begin
  if tg_op = 'INSERT' then
    if new.revision_number = 1 then
      if new.revision_root_id <> new.id or new.supersedes_iap_id is not null
        or new.content_revision <> 1 then
        raise exception 'invalid initial IAP revision lineage';
      end if;
      return new;
    end if;
    select id, incident_id, operational_period, period_revision, status,
      revision_root_id, revision_number
    into parent from iaps where id = new.supersedes_iap_id for update;
    if not found or parent.status <> 'approved'
      or parent.incident_id <> new.incident_id
      or parent.operational_period <> new.operational_period
      or parent.period_revision is distinct from new.period_revision
      or parent.revision_root_id <> new.revision_root_id
      or parent.revision_number + 1 <> new.revision_number
      or new.content_revision <> 1 then
      raise exception 'invalid IAP revision source';
    end if;
    return new;
  end if;

  if row(new.revision_root_id, new.revision_number, new.supersedes_iap_id)
     is distinct from
     row(old.revision_root_id, old.revision_number, old.supersedes_iap_id) then
    raise exception 'IAP revision lineage is immutable';
  end if;
  content_changed := row(new.content, new.form_ids) is distinct from row(old.content, old.form_ids);
  if content_changed then
    if old.status <> 'draft' or new.status <> 'draft'
      or new.content_revision <> old.content_revision + 1 then
      raise exception 'IAP draft content revision is invalid';
    end if;
  elsif new.content_revision <> old.content_revision then
    raise exception 'IAP content revision cannot change without content';
  end if;
  return new;
end $$;

create trigger iap_revision_lineage_guard
before insert or update on iaps
for each row execute function enforce_iap_revision_lineage();

-- Extend the existing narrow partner receipt function with revision
-- categories. It still validates the exact IAP and current named grant.
create or replace function append_iap_participant_audit(
  iid uuid, sid uuid, event_category text, event_payload jsonb
) returns uuid language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $$
declare
  actor uuid := public.current_person();
  owner_organization uuid;
  event_id uuid;
begin
  if event_category not in (
    'iap.assembled', 'iap.submitted', 'iap.ics204.revised', 'iap.revision.created'
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
