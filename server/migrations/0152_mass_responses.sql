-- Response options on mass sends (VA8).
--
-- A send may ask a question with up to six answers, such as "Available",
-- "Not available" and "Available later". The acknowledgement link then shows
-- one button per answer, and the answer chosen is kept with the recipient's
-- acknowledgement, so the receipts count each answer. The page still shows
-- nothing about the send but its answers. An acknowledgement in the app
-- records no answer. A recipient may change their answer through the link;
-- the time of their first acknowledgement stands.

create function public.mass_response_options_valid(options text[])
  returns boolean
  language sql immutable
  set search_path to 'pg_catalog', 'public', 'pg_temp'
  as $$
  select cardinality(options) <= 6
    and coalesce((select bool_and(length(o) between 1 and 60) from unnest(options) o), true)
    and cardinality(options) = (select count(distinct o) from unnest(options) o)
$$;

alter table public.mass_notifications
  add column response_options text[] not null default '{}'
    check (public.mass_response_options_valid(response_options));

alter table public.mass_notification_recipients
  add column response text check (length(response) between 1 and 60);

-- The answers a valid, unexpired link offers, and nothing else; null for a
-- link that is not valid, and an empty list for a send that asks nothing.
create function public.mass_token_options(hashed text)
  returns text[]
  language sql stable security definer
  set search_path to 'pg_catalog', 'public', 'pg_temp'
  as $$
  select m.response_options
  from public.mass_notification_recipients r
  join public.mass_notifications m on m.id = r.mass_notification_id
  where r.token_hash = hashed and r.token_expires_at > now()
$$;

-- The link's acknowledgement gains the answer chosen, by its place in the
-- send's list. A send with answers is acknowledged only with one of them.
drop function public.acknowledge_mass_token(text, boolean);
create function public.acknowledge_mass_token(hashed text, record_ack boolean, choice integer default null)
  returns boolean
  language plpgsql security definer
  set search_path to 'pg_catalog', 'public', 'pg_temp'
  as $$
declare
  recipient uuid;
  options text[];
begin
  select r.id, m.response_options into recipient, options
  from public.mass_notification_recipients r
  join public.mass_notifications m on m.id = r.mass_notification_id
  where r.token_hash = hashed and r.token_expires_at > now();
  if recipient is null then return false; end if;
  if record_ack then
    if cardinality(options) > 0 and (choice is null or choice < 0 or choice >= cardinality(options)) then
      return false;
    end if;
    if cardinality(options) > 0 then
      update public.mass_notification_recipients
      set acknowledged_at = coalesce(acknowledged_at, now()),
          acknowledged_via = coalesce(acknowledged_via, 'link'),
          response = options[choice + 1]
      where id = recipient;
    else
      update public.mass_notification_recipients
      set acknowledged_at = now(), acknowledged_via = 'link'
      where id = recipient and acknowledged_at is null;
    end if;
  end if;
  return true;
end $$;

revoke all on function public.mass_token_options(text) from public;
revoke all on function public.acknowledge_mass_token(text, boolean, integer) from public;
grant execute on function public.mass_token_options(text) to app_runtime;
grant execute on function public.acknowledge_mass_token(text, boolean, integer) to app_runtime;
