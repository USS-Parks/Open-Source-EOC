-- IPAWS-OPEN integration, enable-at-will (VEOC-31, R2/F20). One config row
-- per jurisdiction, disabled by default (INV-7, fail closed). Going live is
-- a single administrative act: once a COG's credentials are configured and
-- the MOA is acknowledged, an admin flips `enabled` with no redeploy. The
-- credential secret is never stored in the clear; only an AES-256-GCM
-- envelope and a display fingerprint land in the row. Every transmission
-- is logged for attribution (INV-2).

create table ipaws_config (
  jurisdiction_id uuid primary key references jurisdictions (id),
  enabled boolean not null default false,
  environment text not null default 'test' check (environment in ('test', 'production')),
  cog_id text,
  endpoint_url text,
  credential_envelope text,
  credential_fingerprint text,
  moa_acknowledged boolean not null default false,
  moa_reference text,
  moa_acknowledged_by uuid references persons (id),
  moa_acknowledged_at timestamptz,
  updated_by uuid references persons (id),
  updated_at timestamptz not null default now()
);

create table ipaws_submissions (
  id uuid primary key default gen_random_uuid(),
  jurisdiction_id uuid not null references jurisdictions (id),
  cap_alert_id uuid references cap_alerts (id),
  environment text not null,
  cog_id text,
  accepted boolean not null,
  detail text,
  submitted_by uuid not null references persons (id),
  submitted_at timestamptz not null default now()
);
create index ipaws_submissions_jurisdiction
  on ipaws_submissions (jurisdiction_id, submitted_at desc);

grant select, insert, update on ipaws_config to app_runtime;
grant select, insert on ipaws_submissions to app_runtime;

-- Members see whether IPAWS is configured and live; only admins configure,
-- acknowledge the MOA, or toggle enablement.
alter table ipaws_config enable row level security;
create policy ipaws_config_read on ipaws_config for select
  using (is_member_of(jurisdiction_id));
create policy ipaws_config_insert on ipaws_config for insert
  with check (is_admin_of(jurisdiction_id));
create policy ipaws_config_update on ipaws_config for update
  using (is_admin_of(jurisdiction_id));

alter table ipaws_submissions enable row level security;
create policy ipaws_submissions_read on ipaws_submissions for select
  using (is_member_of(jurisdiction_id));
create policy ipaws_submissions_insert on ipaws_submissions for insert
  with check (is_admin_of(jurisdiction_id));
