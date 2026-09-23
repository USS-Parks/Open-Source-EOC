-- Notification push.
--
-- The web client used to poll its inbox. It now holds a socket that tells it
-- when to refetch. A trigger announces the id of each inserted or updated
-- notification on the notifications_changed channel; NOTIFY is delivered only
-- on commit, so a rolled-back write announces nothing. The payload is the row
-- id alone: no title, body or detail leaves the database this way.
--
-- The server listens as no person, so it cannot read the rows to decide whose
-- sockets to signal. notification_audience returns the people who may read
-- any of the given notifications, mirroring the notifications_read policy:
-- the addressed person, the active holders of the addressed position, and the
-- admins of the jurisdiction. It returns person ids and nothing else.

create function public.notifications_announce() returns trigger
  language plpgsql
  set search_path to 'pg_catalog', 'public', 'pg_temp'
  as $$
begin
  perform pg_notify('notifications_changed', new.id::text);
  return null;
end $$;

create trigger notifications_announce after insert or update on public.notifications
  for each row execute function public.notifications_announce();

create function public.notification_audience(ids uuid[])
  returns setof uuid
  language sql stable security definer
  set search_path to 'pg_catalog', 'public', 'pg_temp'
  as $$
  select n.person_id from public.notifications n
  where n.id = any(notification_audience.ids) and n.person_id is not null
  union
  select a.person_id from public.notifications n
  join public.position_assignments a on a.position_id = n.position_id and a.revoked_at is null
  where n.id = any(notification_audience.ids)
  union
  select m.person_id from public.notifications n
  join public.jurisdiction_memberships m on m.jurisdiction_id = n.jurisdiction_id and m.role = 'admin'
  where n.id = any(notification_audience.ids)
$$;

revoke all on function public.notification_audience(uuid[]) from public;
grant execute on function public.notification_audience(uuid[]) to app_runtime;
