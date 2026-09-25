-- VA11: signed solution packages (package v2).
--
-- Report and rule templates are instance-wide definitions, keyed and
-- versioned like board and dashboard templates. Each names the board template
-- it applies to by key, so it travels between instances; a jurisdiction's
-- live reports and notification rules, which name its own boards, groups and
-- positions by id, are made from them. Like the other templates they are
-- read by anyone signed in, inserted by an instance administrator and never
-- updated: a change is a new version.
--
-- solution_packages records every signed package imported: who published it,
-- which key signed it, the digest of what was signed, and what the import
-- created, found already held, or kept as the instance had it.

create table public.report_templates (
  key text not null check (key ~ '^[a-z][a-z0-9_]*$'),
  version integer not null check (version > 0),
  title text not null,
  definition jsonb not null,
  created_at timestamptz not null default now(),
  primary key (key, version)
);

create table public.rule_templates (
  key text not null check (key ~ '^[a-z][a-z0-9_]*$'),
  version integer not null check (version > 0),
  title text not null,
  definition jsonb not null,
  created_at timestamptz not null default now(),
  primary key (key, version)
);

create table public.solution_packages (
  id uuid primary key default gen_random_uuid(),
  publisher text not null,
  name text not null,
  version text not null,
  published_at timestamptz not null,
  key_fingerprint text not null,
  digest text not null,
  jurisdiction_id uuid not null references public.jurisdictions(id),
  summary jsonb not null,
  imported_by uuid not null references public.persons(id),
  imported_at timestamptz not null default now()
);

alter table public.report_templates enable row level security;
alter table public.rule_templates enable row level security;
alter table public.solution_packages enable row level security;

create policy report_templates_read on public.report_templates for select using (public.current_person() is not null);
create policy report_templates_write on public.report_templates for insert with check (public.is_instance_admin());
create policy rule_templates_read on public.rule_templates for select using (public.current_person() is not null);
create policy rule_templates_write on public.rule_templates for insert with check (public.is_instance_admin());
create policy solution_packages_read on public.solution_packages for select using (public.is_instance_admin());
create policy solution_packages_write on public.solution_packages for insert with check (public.is_instance_admin());

grant select, insert on table public.report_templates to app_runtime;
grant select, insert on table public.rule_templates to app_runtime;
grant select, insert on table public.solution_packages to app_runtime;
