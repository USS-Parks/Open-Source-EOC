-- Incident-wide message threads.
--
-- A thread's audience is its members (every thread until now) or the whole
-- incident. An incident-wide thread belongs to the incident's owner and is
-- read by everyone who can read the incident: the owner's members and each
-- active participant, viewers included. It has no member rows; access is
-- computed from the live grant on every read and post, so revocation and
-- expiry end it. The owner's writers and the incident's contributors and
-- coordinators post and start such threads while the incident is open (it
-- stays readable after close), by the two SECURITY DEFINER
-- functions below, which set every server-owned value themselves (the
-- owner, the sender, times, and the message.sent audit row in the owner's
-- record when its records policy keeps messages there).

alter table public.threads
  add column audience text not null default 'members'
    constraint threads_audience_check check (audience in ('members', 'incident')),
  add constraint threads_incident_audience check (audience = 'members' or incident_id is not null);

create index threads_incident_audience on public.threads (incident_id, created_at desc, id desc)
  where audience = 'incident';

create policy threads_incident_read on public.threads for select
  using (audience = 'incident' and public.can_read_incident(incident_id));

create policy messages_incident_read on public.messages for select
  using (exists (
    select 1 from public.threads t
    where t.id = messages.thread_id and t.audience = 'incident' and public.can_read_incident(t.incident_id)));

-- Incident-wide threads are made only by create_incident_thread, and carry
-- no member rows, so no member can outlast the grant that admits it.
create policy threads_members_audience on public.threads as restrictive for insert
  with check (audience = 'members');
create policy thread_members_members_audience on public.thread_members as restrictive for insert
  with check (exists (select 1 from public.threads t where t.id = thread_members.thread_id and t.audience = 'members'));

-- The owner's message retention for a thread the caller can read. Partners
-- cannot read the owner's settings, and retention must hide the same
-- messages from them as from the owner's members.
create function public.thread_retention_days(tid uuid) returns integer
  language sql stable security definer
  set search_path to 'pg_catalog', 'public', 'pg_temp'
  as $$
  select s.message_retention_days
  from public.threads t join public.jurisdiction_settings s on s.jurisdiction_id = t.jurisdiction_id
  where t.id = tid and (public.is_thread_participant(t.id) or public.is_member_of(t.jurisdiction_id)
    or (t.audience = 'incident' and public.can_read_incident(t.incident_id)))
$$;
revoke all on function public.thread_retention_days(uuid) from public;
grant execute on function public.thread_retention_days(uuid) to app_runtime;

-- Whether the current person may post in, or start, an incident-wide thread
-- on this incident: a writer of its owner, or an active contributor or
-- coordinator on it.
create function public.can_post_incident_thread(iid uuid) returns boolean
  language sql stable security definer
  set search_path to 'pg_catalog', 'public', 'pg_temp'
  as $$
  select exists (
    select 1 from public.incidents i
    where i.id = iid and public.current_person() is not null
      and (public.is_writer_of(i.jurisdiction_id) or public.has_incident_participation(i.id, 'contributor')))
$$;
revoke all on function public.can_post_incident_thread(uuid) from public;
grant execute on function public.can_post_incident_thread(uuid) to app_runtime;

-- Starts an incident-wide thread and returns its id, or null (creating
-- nothing) when the incident is closed or the caller may not post on it.
-- The share lock on the incident orders this against close and revocation.
create function public.create_incident_thread(iid uuid, thread_title text) returns uuid
  language plpgsql security definer
  set search_path to 'pg_catalog', 'public', 'pg_temp'
  as $$
declare
  owner_organization uuid;
  tid uuid;
begin
  select i.jurisdiction_id into owner_organization from public.incidents i
  where i.id = iid and i.closed_at is null for share;
  if owner_organization is null or not public.can_post_incident_thread(iid) then
    return null;
  end if;
  if length(thread_title) > 200 then
    raise exception 'a thread title is at most 200 characters' using errcode = '22023';
  end if;
  insert into public.threads (jurisdiction_id, kind, incident_id, title, created_by, audience)
  values (owner_organization, 'group', iid, coalesce(thread_title, ''), public.current_person(), 'incident')
  returning id into tid;
  return tid;
end $$;
revoke all on function public.create_incident_thread(uuid, text) from public;
grant execute on function public.create_incident_thread(uuid, text) to app_runtime;

-- Posts to an incident-wide thread and returns the message id, or null
-- (posting nothing) when the incident is closed or the caller may not post
-- there. The sender's position is kept only when it is one of the owner's
-- and the caller holds it now; a partner writes for its grant's organization.
create function public.post_incident_message(
  tid uuid, client_id text, message_body text, sender_position_in uuid) returns uuid
  language plpgsql security definer
  set search_path to 'pg_catalog', 'public', 'pg_temp'
  as $$
declare
  actor uuid := public.current_person();
  thread record;
  held uuid;
  mid uuid;
begin
  select t.id, t.jurisdiction_id, t.incident_id into thread
  from public.threads t where t.id = tid and t.audience = 'incident';
  if thread.id is null then
    return null;
  end if;
  perform 1 from public.incidents i where i.id = thread.incident_id and i.closed_at is null for share;
  if not found or not public.can_post_incident_thread(thread.incident_id) then
    return null;
  end if;
  if message_body is null or length(message_body) = 0 or length(message_body) > 8000
     or length(client_id) > 64 then
    raise exception 'a message is 1 to 8000 characters' using errcode = '22023';
  end if;
  select pa.position_id into held from public.position_assignments pa
  join public.positions p on p.id = pa.position_id and p.jurisdiction_id = thread.jurisdiction_id
  where pa.position_id = sender_position_in and pa.person_id = actor and pa.revoked_at is null
  limit 1;
  insert into public.messages (thread_id, client_message_id, sender_person, sender_position, body)
  values (tid, client_id, actor, held, message_body)
  returning id into mid;
  if coalesce((select s.messages_in_incident_record from public.jurisdiction_settings s
               where s.jurisdiction_id = thread.jurisdiction_id), true) then
    insert into public.audit_events (jurisdiction_id, incident_id, person_id, position_id, category, subject_table, subject_id, payload)
    values (thread.jurisdiction_id, thread.incident_id, actor, held, 'message.sent', 'messages', mid,
      jsonb_build_object('thread', tid, 'length', length(message_body)));
  end if;
  return mid;
end $$;
revoke all on function public.post_incident_message(uuid, text, text, uuid) from public;
grant execute on function public.post_incident_message(uuid, text, text, uuid) to app_runtime;
