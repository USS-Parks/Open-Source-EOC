-- P-TASKS: ordered checklist prerequisites, guarded by incident scope and acyclic links.

create table checklist_task_dependencies (
  task_id uuid not null references checklist_items (id) on delete cascade,
  prerequisite_task_id uuid not null references checklist_items (id) on delete restrict,
  primary key (task_id, prerequisite_task_id),
  check (task_id <> prerequisite_task_id)
);

grant select, insert, delete on checklist_task_dependencies to app_runtime;
alter table checklist_task_dependencies enable row level security;

create policy checklist_task_dependencies_read on checklist_task_dependencies for select using (
  exists (select 1 from checklist_items task where task.id = checklist_task_dependencies.task_id
    and can_read_incident(task.incident_id))
);
create policy checklist_task_dependencies_insert on checklist_task_dependencies for insert with check (
  exists (select 1 from checklist_items task join incidents i on i.id = task.incident_id
    where task.id = checklist_task_dependencies.task_id and is_admin_of(i.jurisdiction_id))
  and exists (select 1 from checklist_items task join checklist_items prerequisite
    on prerequisite.id = checklist_task_dependencies.prerequisite_task_id
    where task.id = checklist_task_dependencies.task_id and task.incident_id = prerequisite.incident_id)
);
create policy checklist_task_dependencies_delete on checklist_task_dependencies for delete using (
  exists (select 1 from checklist_items task join incidents i on i.id = task.incident_id
    where task.id = checklist_task_dependencies.task_id and is_admin_of(i.jurisdiction_id))
);

create function validate_checklist_task_dependency() returns trigger
language plpgsql security invoker set search_path = pg_catalog, public as $$
declare task_incident uuid; prerequisite_incident uuid;
begin
  select incident_id into task_incident from checklist_items where id = new.task_id;
  select incident_id into prerequisite_incident from checklist_items where id = new.prerequisite_task_id;
  if task_incident is null or prerequisite_incident is null or task_incident <> prerequisite_incident then
    raise exception 'task prerequisite must belong to the same incident';
  end if;
  if exists (
    with recursive prerequisites(id) as (
      select prerequisite_task_id from checklist_task_dependencies where task_id = new.prerequisite_task_id
      union
      select d.prerequisite_task_id from checklist_task_dependencies d join prerequisites p on p.id = d.task_id
    ) select 1 from prerequisites where id = new.task_id
  ) then raise exception 'task prerequisite would create a cycle'; end if;
  return new;
end
$$;
revoke all on function validate_checklist_task_dependency() from public;
grant execute on function validate_checklist_task_dependency() to app_runtime;
create trigger checklist_task_dependency_guard before insert or update on checklist_task_dependencies
  for each row execute function validate_checklist_task_dependency();

create function guard_checklist_task_prerequisites() returns trigger
language plpgsql security invoker set search_path = pg_catalog, public as $$
begin
  if new.status = 'completed' and old.status <> 'completed' and exists (
    select 1 from checklist_task_dependencies d join checklist_items prerequisite
      on prerequisite.id = d.prerequisite_task_id
    where d.task_id = old.id and prerequisite.status <> 'completed'
  ) then raise exception 'task prerequisites are incomplete'; end if;
  return new;
end
$$;
revoke all on function guard_checklist_task_prerequisites() from public;
grant execute on function guard_checklist_task_prerequisites() to app_runtime;
create trigger checklist_task_dependency_completion_guard before update of status on checklist_items
  for each row execute function guard_checklist_task_prerequisites();
