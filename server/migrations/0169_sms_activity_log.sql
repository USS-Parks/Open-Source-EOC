-- Field activity by text message. A responder texts an activity entry,
-- starting with LOG or #, from a phone number registered to their person
-- record (a contacts directory entry linked to them) that they have confirmed
-- with a code texted to it; the reader of the jurisdiction's SMS gateway files
-- it on the ICS 214 activity log of the incident they hold a position on, as
-- them, tells them in the app, and texts a confirmation back to the
-- registered number. It is off until an administrator turns it on for the
-- gateway.
--
-- A sender number can be forged, so an entry filed this way keeps its channel
-- on the record (received_via) and in its creation audit. A number that is
-- not registered and confirmed gets no reply and nothing is filed. Each text
-- the reader acts on is kept once, by the gateway's id, with what it did and
-- what the phone answered.

alter table public.notification_channels
  add column activity_log_since timestamptz,
  add constraint notification_channels_activity_log_sms check (activity_log_since is null or kind = 'sms');

-- The check is added unvalidated and validated after, in this same
-- transaction, rather than with the column.
alter table public.board_records add column received_via text;
alter table public.board_records
  add constraint board_records_received_via_check check (received_via = 'sms') not valid;
alter table public.board_records validate constraint board_records_received_via_check;

alter table public.sms_replies
  drop constraint sms_replies_outcome_check,
  add constraint sms_replies_outcome_check
    check (outcome in ('acknowledged', 'answered', 'not_an_answer', 'unmatched', 'logged', 'refused')),
  add column refusal text check (refusal in (
    'keyword', 'echo', 'rate_limited', 'shared_number', 'too_long', 'empty',
    'no_assignment', 'choose_incident', 'refused_by_log', 'failed')),
  add column person_id uuid references public.persons(id),
  add column record_id uuid references public.board_records(id) on delete set null,
  -- What the phone texted back, when it did; replies are counted against the hourly limits.
  add column reply text,
  add constraint sms_replies_refusal_given check ((outcome = 'refused') = (refusal is not null)),
  add constraint sms_replies_logged_person check (outcome <> 'logged' or person_id is not null);

create unique index sms_replies_record on public.sms_replies (record_id) where record_id is not null;

-- Whether a record was filed from a text, as this person, on a board of this jurisdiction.
create function public.sms_filed_record(record uuid, jid uuid, person uuid)
  returns boolean
  language sql stable security definer
  set search_path to 'pg_catalog', 'public', 'pg_temp'
  as $$
  select exists (
    select 1 from public.board_records r join public.boards b on b.id = r.board_id
    where r.id = record and r.received_via = 'sms' and r.created_by = person and b.jurisdiction_id = jid)
$$;

-- The reader (an administrator) keeps each text; a filed one only with the
-- texted record it filed as that person.
drop policy sms_replies_insert on public.sms_replies;
create policy sms_replies_insert on public.sms_replies
  for insert with check (
    public.is_admin_of(jurisdiction_id)
    and (outcome <> 'logged' or public.sms_filed_record(record_id, jurisdiction_id, person_id)));

-- Members still read the replies to sends beside their receipts; an activity
-- text holds an entry, so it is read by administrators and its person only.
drop policy sms_replies_read on public.sms_replies;
create policy sms_replies_read on public.sms_replies
  for select using (
    public.is_admin_of(jurisdiction_id)
    or (outcome not in ('logged', 'refused') and public.is_member_of(jurisdiction_id))
    or person_id = public.current_person());

-- A number files activity only once the person it is registered to has
-- entered, while signed in, a code texted to it. Codes are issued and checked
-- only by the two functions below, so no application path writes a code, a
-- count or a confirmation directly, and no application role reads a code.
-- Any change to a contact's numbers, person link or active flag clears what
-- that contact confirmed.
create table public.sms_activity_numbers (
  jurisdiction_id uuid not null references public.jurisdictions(id),
  person_id uuid not null references public.persons(id),
  phone text not null check (length(phone) between 1 and 40),
  -- SHA-256 of the code last texted; cleared once confirmed or locked.
  code_hash text,
  code_expires_at timestamptz,
  code_sent_at timestamptz,
  -- Wrong codes since the number was last locked; a new code does not reset it.
  attempts integer not null default 0,
  locked_until timestamptz,
  confirmed_at timestamptz,
  primary key (jurisdiction_id, person_id, phone)
);

-- Each code texted, for the daily caps and the gateway's hourly budget.
create table public.sms_activity_codes (
  jurisdiction_id uuid not null references public.jurisdictions(id),
  person_id uuid not null references public.persons(id),
  phone text not null,
  sent_at timestamptz not null default now()
);
create index sms_activity_codes_recent on public.sms_activity_codes (jurisdiction_id, sent_at desc);

alter table public.sms_activity_numbers enable row level security;
alter table public.sms_activity_codes enable row level security;

create policy sms_activity_numbers_read on public.sms_activity_numbers
  for select using (person_id = public.current_person() or public.is_admin_of(jurisdiction_id));
create policy sms_activity_codes_read on public.sms_activity_codes
  for select using (public.is_admin_of(jurisdiction_id));

-- The schema's default privileges grant select, insert and update on every
-- table; here the application reads everything but the code, and writes nothing.
revoke all on table public.sms_activity_numbers from app_runtime;
revoke all on table public.sms_activity_codes from app_runtime;
grant select (jurisdiction_id, person_id, phone, code_expires_at, code_sent_at, attempts, locked_until, confirmed_at)
  on table public.sms_activity_numbers to app_runtime;
grant select on table public.sms_activity_codes to app_runtime;

-- Issue a code to one of the caller's own numbers: the hash of a code the
-- server made and will text when this answers 'issued'. Refused with
-- 'not_linked' (not on an active contact linked to the caller), 'off' (texted
-- activity logging off), 'confirmed', 'locked' (five wrong codes, for a day),
-- 'too_soon' (a code in the last five minutes), 'daily_cap' (five codes a day
-- to the number, or to the caller), or 'busy' (the gateway has sent its 300
-- replies and codes this hour; contacts/sms-activity.ts keeps the same count).
-- The row is locked while it decides, so parallel requests issue one code.
create function public.issue_sms_activity_code(jid uuid, number text, hash text)
  returns text
  language plpgsql security definer
  set search_path to 'pg_catalog', 'public', 'pg_temp'
  as $$
declare
  me uuid := public.current_person();
  held public.sms_activity_numbers;
begin
  if me is null or hash is null or not exists (
       select 1 from public.contacts c
       where c.jurisdiction_id = jid and c.person_id = me and c.active and number = any(c.phones)) then
    return 'not_linked';
  end if;
  if not public.sms_activity_logging(jid) then return 'off'; end if;
  insert into public.sms_activity_numbers (jurisdiction_id, person_id, phone)
  values (jid, me, number) on conflict do nothing;
  select * into held from public.sms_activity_numbers n
  where n.jurisdiction_id = jid and n.person_id = me and n.phone = number
  for update;
  if held.confirmed_at is not null then return 'confirmed'; end if;
  if held.locked_until > now() then return 'locked'; end if;
  if held.code_sent_at > now() - interval '5 minutes' then return 'too_soon'; end if;
  if (select count(*) from public.sms_activity_codes s
      where s.jurisdiction_id = jid and s.phone = number and s.sent_at > now() - interval '1 day') >= 5
     or (select count(*) from public.sms_activity_codes s
         where s.person_id = me and s.sent_at > now() - interval '1 day') >= 5 then
    return 'daily_cap';
  end if;
  if (select count(*) from public.sms_activity_codes s
      where s.jurisdiction_id = jid and s.sent_at > now() - interval '1 hour')
     + (select count(*) from public.sms_replies r
        where r.jurisdiction_id = jid and r.reply is not null and r.read_at > now() - interval '1 hour') >= 300 then
    return 'busy';
  end if;
  -- A lock that has run out starts a new window of five tries.
  update public.sms_activity_numbers n
  set code_hash = hash, code_expires_at = now() + interval '15 minutes',
      code_sent_at = now(),
      attempts = case when held.locked_until is not null then 0 else n.attempts end, locked_until = null
  where n.jurisdiction_id = jid and n.person_id = me and n.phone = number;
  insert into public.sms_activity_codes (jurisdiction_id, person_id, phone) values (jid, me, number);
  return 'issued';
end $$;

-- Confirm the caller's own number with the hash of the code they entered:
-- 'confirmed', 'wrong' (counted; the fifth locks the number for a day and
-- voids the code), 'locked', or 'expired' when there is no live code or the
-- number is no longer on an active contact linked to them.
create function public.confirm_sms_activity_number(jid uuid, number text, given text)
  returns text
  language plpgsql security definer
  set search_path to 'pg_catalog', 'public', 'pg_temp'
  as $$
declare
  me uuid := public.current_person();
  held public.sms_activity_numbers;
begin
  select * into held from public.sms_activity_numbers n
  where n.jurisdiction_id = jid and n.person_id = me and n.phone = number
  for update;
  if held.person_id is null then return 'expired'; end if;
  if held.locked_until > now() then return 'locked'; end if;
  if held.code_hash is null or held.code_expires_at is null or held.code_expires_at <= now()
     or not exists (
       select 1 from public.contacts c
       where c.jurisdiction_id = jid and c.person_id = me and c.active and number = any(c.phones)) then
    return 'expired';
  end if;
  if given is null or given is distinct from held.code_hash then
    update public.sms_activity_numbers n
    set attempts = n.attempts + 1,
        locked_until = case when n.attempts + 1 >= 5 then now() + interval '1 day' end,
        code_hash = case when n.attempts + 1 >= 5 then null else n.code_hash end
    where n.jurisdiction_id = jid and n.person_id = me and n.phone = number;
    return 'wrong';
  end if;
  update public.sms_activity_numbers n
  set confirmed_at = now(), code_hash = null, code_expires_at = null, attempts = 0
  where n.jurisdiction_id = jid and n.person_id = me and n.phone = number;
  return 'confirmed';
end $$;

create function public.clear_sms_activity_numbers()
  returns trigger
  language plpgsql security definer
  set search_path to 'pg_catalog', 'public', 'pg_temp'
  as $$
declare
  people uuid[] := array[old.person_id];
  numbers text[] := old.phones;
begin
  if tg_op = 'UPDATE' then
    people := people || new.person_id;
    numbers := numbers || new.phones;
  end if;
  delete from public.sms_activity_numbers n
  where n.jurisdiction_id = old.jurisdiction_id and n.person_id = any(people) and n.phone = any(numbers);
  return null;
end $$;

create trigger contacts_clear_sms_activity_update after update on public.contacts
  for each row when (old.phones is distinct from new.phones or old.person_id is distinct from new.person_id
                     or old.active is distinct from new.active)
  execute function public.clear_sms_activity_numbers();
create trigger contacts_clear_sms_activity_delete after delete on public.contacts
  for each row execute function public.clear_sms_activity_numbers();

-- Whether texted activity logging is on for a jurisdiction, so a member can
-- confirm a number; the channel stays unreadable.
create function public.sms_activity_logging(jid uuid)
  returns boolean
  language sql stable security definer
  set search_path to 'pg_catalog', 'public', 'pg_temp'
  as $$
  select public.is_member_of(jid) and exists (
    select 1 from public.notification_channels c
    where c.jurisdiction_id = jid and c.kind = 'sms' and c.settings ->> 'provider' = 'gateway'
      and c.activity_log_since is not null)
$$;

-- The reader also runs while activity logging is on, with no send open.
create or replace function public.sms_reply_readers()
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
      and (c.activity_log_since is not null or exists (
        select 1 from public.mass_notification_recipients r
        join public.mass_notifications s on s.id = r.mass_notification_id
        where r.jurisdiction_id = c.jurisdiction_id and r.phone is not null
          and r.token_expires_at > now() and 'sms' = any(s.channels))))
  order by m.jurisdiction_id, m.created_at, m.person_id
$$;

revoke all on function public.sms_filed_record(uuid, uuid, uuid) from public;
revoke all on function public.issue_sms_activity_code(uuid, text, text) from public;
revoke all on function public.confirm_sms_activity_number(uuid, text, text) from public;
revoke all on function public.clear_sms_activity_numbers() from public;
revoke all on function public.sms_activity_logging(uuid) from public;
grant execute on function public.sms_filed_record(uuid, uuid, uuid) to app_runtime;
grant execute on function public.issue_sms_activity_code(uuid, text, text) to app_runtime;
grant execute on function public.confirm_sms_activity_number(uuid, text, text) to app_runtime;
grant execute on function public.sms_activity_logging(uuid) to app_runtime;
