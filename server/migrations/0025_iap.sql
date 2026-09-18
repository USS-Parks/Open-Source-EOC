-- Incident Action Plans (VEOC-34, F5). An IAP is a frozen assembly of the
-- operational period's ICS forms, prefilled from live incident data. It
-- carries an approval workflow (draft then approved by command) and the
-- stored content is what the PDF renders, so an approved plan is stable.

create table iaps (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references incidents (id),
  operational_period text not null,
  status text not null default 'draft' check (status in ('draft', 'approved')),
  form_ids text[] not null default '{}',
  content jsonb not null,
  prepared_by uuid not null references persons (id),
  approved_by uuid references persons (id),
  approved_at timestamptz,
  created_at timestamptz not null default now()
);
create index iaps_incident on iaps (incident_id, created_at desc);

grant select, insert, update on iaps to app_runtime;

alter table iaps enable row level security;
create policy iaps_read on iaps for select
  using (exists (select 1 from incidents i where i.id = incident_id
                 and is_member_of(i.jurisdiction_id)));
create policy iaps_write on iaps for insert
  with check (exists (select 1 from incidents i where i.id = incident_id
                      and is_member_of(i.jurisdiction_id)));
create policy iaps_update on iaps for update
  using (exists (select 1 from incidents i where i.id = incident_id
                 and is_member_of(i.jurisdiction_id)));
