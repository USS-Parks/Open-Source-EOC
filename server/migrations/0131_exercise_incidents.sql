-- Exercises as an incident kind.
--
-- An exercise runs the same activation machinery as a real incident, the way
-- daily operations and planned events already do, and says so wherever the
-- incident is named. Existing incidents keep their kind.

alter table public.incidents drop constraint incidents_kind_check;
alter table public.incidents
  add constraint incidents_kind_check
    check (kind = any (array['incident', 'daily_ops', 'planned_event', 'exercise']));
