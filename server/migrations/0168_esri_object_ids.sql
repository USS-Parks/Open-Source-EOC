-- Esri clients (VC-26) address a feature by an integer object id, and the
-- FeatureServer view pages and filters by it. Each board numbers its own
-- records, 1, 2, 3 and on, so an id says nothing about how much any other
-- board or jurisdiction writes. The number is stored, so it holds across
-- restarts, backups and restores; the record's uuid stays its identity
-- everywhere else.
--
-- A trigger takes the next number from the board's counter on every insert,
-- whatever writes the record (the REST routes, the sync hub, imports,
-- federation, exchange by file), overwriting any number a caller gives, and
-- keeps the number through every update. A dump replays records with their
-- numbers: pg_dump creates triggers after it loads the data.

-- The counters are the trigger's alone: the application role cannot read or
-- change them.
create table public.board_record_counters (
  board_id uuid primary key references public.boards(id) on delete cascade,
  last_object_id bigint not null check (last_object_id > 0)
);
revoke all on table public.board_record_counters from app_runtime, public;

-- No default, so adding the column does not rewrite the table. Existing
-- records are numbered per board in the order they were created.
alter table public.board_records add column object_id bigint;

update public.board_records r set object_id = n.object_id
from (
  select id, row_number() over (partition by board_id order by created_at, id) as object_id
  from public.board_records
) n
where r.id = n.id;

insert into public.board_record_counters (board_id, last_object_id)
select board_id, max(object_id) from public.board_records group by board_id;

alter table public.board_records alter column object_id set not null;
create unique index board_records_object_id on public.board_records (board_id, object_id);

create function public.number_board_record() returns trigger
  language plpgsql security definer
  set search_path to 'pg_catalog', 'public', 'pg_temp'
  as $$
begin
  if tg_op = 'UPDATE' and new.board_id = old.board_id then
    new.object_id := old.object_id;
    return new;
  end if;
  insert into public.board_record_counters as c (board_id, last_object_id)
  values (new.board_id, 1)
  on conflict (board_id) do update set last_object_id = c.last_object_id + 1
  returning c.last_object_id into new.object_id;
  return new;
end $$;

revoke all on function public.number_board_record() from public;

create trigger board_records_object_id before insert or update of object_id, board_id on public.board_records
  for each row execute function public.number_board_record();
