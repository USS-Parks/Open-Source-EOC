-- D17: attributed, incident-scoped links between assessment lineages and operational targets.
create table operational_relationships (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references incidents (id) on delete cascade,
  source_domain text not null check (source_domain in ('lifeline', 'esf')),
  source_framework text not null,
  source_definition_key text not null,
  target_kind text not null check (target_kind in ('task', 'resource_request', 'board_record', 'map_feature', 'iap_objective')),
  target_id uuid,
  target_dataset_id uuid references data_pack_datasets (id),
  target_feature_id text,
  target_iap_id uuid references iaps (id),
  target_iap_content_revision integer,
  target_objective_index integer,
  target_iap_objective_label text,
  target_iap_operational_period text,
  created_by uuid not null references persons (id),
  organization_id uuid not null references jurisdictions (id),
  position_id uuid references positions (id),
  position_title text,
  participation_id uuid references incident_participants (id),
  created_at timestamptz not null default now(),
  check (
    (target_kind in ('task', 'resource_request', 'board_record') and target_id is not null
      and target_dataset_id is null and target_feature_id is null and target_iap_id is null
      and target_iap_content_revision is null and target_objective_index is null
      and target_iap_objective_label is null and target_iap_operational_period is null)
    or (target_kind = 'map_feature' and target_id is null and target_dataset_id is not null
      and target_feature_id is not null and target_iap_id is null
      and target_iap_content_revision is null and target_objective_index is null
      and target_iap_objective_label is null and target_iap_operational_period is null)
    or (target_kind = 'iap_objective' and target_id is null and target_dataset_id is null
      and target_feature_id is null and target_iap_id is not null
      and target_iap_content_revision is not null and target_objective_index is not null
      and nullif(btrim(target_iap_objective_label), '') is not null
      and nullif(btrim(target_iap_operational_period), '') is not null)
  ),
  unique (incident_id, source_domain, source_framework, source_definition_key, target_kind,
    target_id, target_dataset_id, target_feature_id, target_iap_id, target_iap_content_revision, target_objective_index)
);
create index operational_relationships_source on operational_relationships
  (incident_id, source_domain, source_framework, source_definition_key);
create unique index operational_relationships_exact_target on operational_relationships
  (incident_id, source_domain, source_framework, source_definition_key, target_kind,
   coalesce(target_id, '00000000-0000-0000-0000-000000000000'::uuid),
   coalesce(target_dataset_id, '00000000-0000-0000-0000-000000000000'::uuid),
   coalesce(target_feature_id, ''),
   coalesce(target_iap_id, '00000000-0000-0000-0000-000000000000'::uuid),
   coalesce(target_iap_content_revision, 0), coalesce(target_objective_index, -1));
grant select, insert on operational_relationships to app_runtime;
alter table operational_relationships enable row level security;
create policy operational_relationships_read on operational_relationships for select using (can_read_incident(incident_id));
create policy operational_relationships_insert on operational_relationships for insert with check (
  can_read_incident(incident_id)
  and exists (select 1 from incidents where id = incident_id and closed_at is null)
  and (is_writer_of(organization_id) or has_incident_participation(incident_id, 'contributor'))
  and created_by = current_person()
);

-- The existing jurisdiction-member audit policy cannot append a partner's
-- receipt to the incident owner's chronology. Permit only that actor's exact
-- persisted relationship receipt; no general cross-jurisdiction audit grant.
create policy audit_operational_relationship_append on audit_events for insert
with check (
  person_id = current_person()
  and category = 'operational.relationship.created'
  and subject_table = 'operational_relationships'
  and can_read_incident(incident_id)
  and exists (
    select 1 from operational_relationships r join incidents i on i.id = r.incident_id
    where r.id = audit_events.subject_id and r.incident_id = audit_events.incident_id
      and i.jurisdiction_id = audit_events.jurisdiction_id
      and r.created_by = current_person()
  )
);
create policy audit_operational_relationship_actor_read on audit_events for select
using (
  person_id = current_person()
  and category = 'operational.relationship.created'
  and subject_table = 'operational_relationships'
  and can_read_incident(incident_id)
  and exists (
    select 1 from operational_relationships r join incidents i on i.id = r.incident_id
    where r.id = audit_events.subject_id and r.incident_id = audit_events.incident_id
      and i.jurisdiction_id = audit_events.jurisdiction_id
      and r.created_by = current_person()
  )
);
