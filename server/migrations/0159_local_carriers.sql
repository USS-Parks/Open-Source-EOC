-- Local carriers (AG-05): text replies read from an SMS gateway on the site
-- network, and acknowledgements entered from a printed call-down sheet.
--
-- An SMS channel may be a gateway on the site network: an Android phone
-- running SMS Gateway for Android, whose SIM sends each text while a tower
-- stands. The server reads the phone's inbox over the network. A reply from a
-- recipient's number acknowledges the latest send that reached that number;
-- when the send asked a question, a reply of an answer's number or its words
-- records that answer, and anything else is kept and shown but records
-- nothing. Each text read is kept once, by the gateway's id, with what it did.
--
-- A call-down can also go by voice or radio from a printed sheet: whoever
-- runs it enters afterward who was reached, when, and their answer.

alter table public.mass_notification_recipients
  drop constraint mass_notification_recipients_acknowledged_via_check,
  add constraint mass_notification_recipients_acknowledged_via_check
    check (acknowledged_via in ('link', 'app', 'sms', 'sheet'));

create table public.sms_replies (
  id uuid primary key default gen_random_uuid(),
  jurisdiction_id uuid not null references public.jurisdictions(id),
  gateway_message_id text not null check (length(gateway_message_id) between 1 and 200),
  sender text not null check (length(sender) between 1 and 40),
  body text not null check (length(body) <= 1600),
  -- By the gateway's clock.
  received_at timestamptz not null,
  read_at timestamptz not null default now(),
  recipient_id uuid references public.mass_notification_recipients(id) on delete set null,
  outcome text not null check (outcome in ('acknowledged', 'answered', 'not_an_answer', 'unmatched')),
  unique (jurisdiction_id, gateway_message_id)
);

create index sms_replies_recent on public.sms_replies (jurisdiction_id, read_at desc);
create index sms_replies_recipient on public.sms_replies (recipient_id) where recipient_id is not null;

alter table public.sms_replies enable row level security;

-- Members read a send's replies beside its receipts; the reader acts as an
-- administrator, as the scheduler's jobs do.
create policy sms_replies_read on public.sms_replies
  for select using (public.is_member_of(jurisdiction_id));
create policy sms_replies_insert on public.sms_replies
  for insert with check (public.is_admin_of(jurisdiction_id));

grant select, insert on table public.sms_replies to app_runtime;

-- Record an acknowledgement given by text reply or on a printed call-down
-- sheet. A writer of the send's jurisdiction may. The time is kept between
-- the send and now; the first acknowledgement's time and way stand. A send
-- that asks a question takes an answer by its place in the list, which a
-- later reply or entry may change, as on the link. A call-down contact not
-- yet called counts as called at that time.
create function public.record_mass_acknowledgement(recipient uuid, via text, choice integer, at timestamptz)
  returns boolean
  language plpgsql security definer
  set search_path to 'pg_catalog', 'public', 'pg_temp'
  as $$
declare
  target record;
  stamp timestamptz;
begin
  if via not in ('sms', 'sheet') then
    raise exception 'unknown acknowledgement way %', via;
  end if;
  select r.id, r.jurisdiction_id, r.notified_at, m.created_at, m.response_options into target
  from public.mass_notification_recipients r
  join public.mass_notifications m on m.id = r.mass_notification_id
  where r.id = recipient;
  if target.id is null or not public.is_writer_of(target.jurisdiction_id) then return false; end if;
  if cardinality(target.response_options) > 0
     and (choice is null or choice < 0 or choice >= cardinality(target.response_options)) then
    return false;
  end if;
  stamp := least(greatest(coalesce(at, now()), target.notified_at, target.created_at), now());
  update public.mass_notification_recipients
  set acknowledged_at = coalesce(acknowledged_at, stamp),
      acknowledged_via = coalesce(acknowledged_via, via),
      notified_at = coalesce(notified_at, stamp),
      response = case when cardinality(target.response_options) > 0
                      then target.response_options[choice + 1] else response end
  where id = recipient;
  return true;
end $$;

-- Whether texts from this jurisdiction can be answered by reply, so a send
-- tells its recipients how. Members may ask; the channel stays unreadable.
create function public.sms_reads_replies(jid uuid)
  returns boolean
  language sql stable security definer
  set search_path to 'pg_catalog', 'public', 'pg_temp'
  as $$
  select public.is_member_of(jid) and exists (
    select 1 from public.notification_channels c
    where c.jurisdiction_id = jid and c.kind = 'sms' and c.settings ->> 'provider' = 'gateway')
$$;

-- The jurisdictions whose gateway has replies to read: a gateway is set and a
-- text sent to someone can still be answered. Each comes with an
-- administrator the reader acts as, the longest-standing one.
create function public.sms_reply_readers()
  returns table (jurisdiction_id uuid, person_id uuid)
  language sql stable security definer
  set search_path to 'pg_catalog', 'public', 'pg_temp'
  as $$
  select distinct on (m.jurisdiction_id) m.jurisdiction_id, m.person_id
  from public.jurisdiction_memberships m
  join public.persons p on p.id = m.person_id and not p.disabled
  where m.role = 'admin' and m.jurisdiction_id in (
    select c.jurisdiction_id from public.notification_channels c
    where c.kind = 'sms' and c.settings ->> 'provider' = 'gateway'
      and exists (
        select 1 from public.mass_notification_recipients r
        join public.mass_notifications s on s.id = r.mass_notification_id
        where r.jurisdiction_id = c.jurisdiction_id and r.phone is not null
          and r.token_expires_at > now() and 'sms' = any(s.channels)))
  order by m.jurisdiction_id, m.created_at, m.person_id
$$;

revoke all on function public.record_mass_acknowledgement(uuid, text, integer, timestamptz) from public;
revoke all on function public.sms_reads_replies(uuid) from public;
revoke all on function public.sms_reply_readers() from public;
grant execute on function public.record_mass_acknowledgement(uuid, text, integer, timestamptz) to app_runtime;
grant execute on function public.sms_reads_replies(uuid) to app_runtime;
grant execute on function public.sms_reply_readers() to app_runtime;
