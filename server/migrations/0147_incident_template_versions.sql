-- Incident templates authored and versioned on screen. A template row holds
-- its current version; every version, whoever saved it and whichever path
-- inserted it (the screen, the standard or scenario seeding, an import), is
-- kept in incident_template_versions, which is append-only. An incident
-- records the version it was activated from.
alter table public.incident_templates
  add column version integer not null default 1,
  add column updated_by uuid references public.persons (id),
  add column updated_at timestamptz not null default now();

create table public.incident_template_versions (
  key text not null references public.incident_templates (key),
  version integer not null check (version >= 1),
  title text not null,
  definition jsonb not null,
  created_by uuid references public.persons (id),
  created_at timestamptz not null default now(),
  primary key (key, version)
);

insert into public.incident_template_versions (key, version, title, definition, created_at)
select key, 1, title, definition, created_at from public.incident_templates;

create function public.reject_incident_template_version_change() returns trigger
  language plpgsql
  as $$
begin
  raise exception 'incident template versions are append-only';
end $$;
create trigger incident_template_versions_immutable before delete or update on public.incident_template_versions
  for each row execute function public.reject_incident_template_version_change();

-- A change to a template's title or definition is its next version, whoever
-- makes it: one that leaves the version alone (an edit made directly in the
-- database, say) gets the next number here, and one that sets the version
-- must move it by exactly one. The key never changes.
create function public.number_incident_template_version() returns trigger
  language plpgsql
  as $$
begin
  if new.key <> old.key then
    raise exception 'an incident template keeps its key';
  end if;
  if new.version = old.version then
    if new.definition is distinct from old.definition or new.title is distinct from old.title then
      new.version := old.version + 1;
      new.updated_at := now();
    end if;
  elsif new.version <> old.version + 1 then
    raise exception 'an incident template version moves by one';
  end if;
  return new;
end $$;
create trigger incident_template_versions_number before update on public.incident_templates
  for each row execute function public.number_incident_template_version();

-- Each insert of a template, and each new version, is kept.
create function public.keep_incident_template_version() returns trigger
  language plpgsql security definer
  set search_path to 'pg_catalog', 'public', 'pg_temp'
  as $$
begin
  if tg_op = 'UPDATE' and new.version = old.version then
    return new;
  end if;
  insert into public.incident_template_versions (key, version, title, definition, created_by)
  values (new.key, new.version, new.title, new.definition, new.updated_by);
  return new;
end $$;
create trigger incident_template_versions_keep after insert or update on public.incident_templates
  for each row execute function public.keep_incident_template_version();

create policy incident_templates_update on public.incident_templates for update
  using (public.is_instance_admin()) with check (public.is_instance_admin());

alter table public.incident_template_versions enable row level security;
create policy incident_template_versions_read on public.incident_template_versions for select
  using (public.current_person() is not null);
grant select on table public.incident_template_versions to app_runtime;

alter table public.incidents add column template_version integer;
