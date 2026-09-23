-- Keyset pagination for board views and the notification inbox.
--
-- Both lists page newest first by (created_at, id). The board index gains the
-- id tiebreak so a page boundary inside one timestamp stays exact; the audit
-- chronology pages by seq on the existing audit_events_jurisdiction_seq.
--
-- A notification named its incident only inside the detail document, so the
-- inbox joined incidents through a text cast no index could serve. The
-- incident is now a typed column. A trigger fills it from detail on insert,
-- so every writer sets it without code of its own.

create index board_records_board_page
  on public.board_records (board_id, created_at desc, id desc);
drop index public.board_records_board;

create index notifications_page on public.notifications (created_at desc, id desc);

alter table public.notifications add column incident_id uuid;

update public.notifications
set incident_id = (detail ->> 'incidentId')::uuid
where detail ->> 'incidentId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

create index notifications_incident on public.notifications (incident_id)
  where incident_id is not null;

create function public.notifications_incident_from_detail() returns trigger
  language plpgsql
  set search_path to 'pg_catalog', 'public', 'pg_temp'
  as $$
begin
  if new.incident_id is null
     and new.detail ->> 'incidentId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    new.incident_id := (new.detail ->> 'incidentId')::uuid;
  end if;
  return new;
end $$;

create trigger notifications_incident_from_detail before insert on public.notifications
  for each row execute function public.notifications_incident_from_detail();
