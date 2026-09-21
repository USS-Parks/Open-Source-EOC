-- Versioned, incident-scoped operational assessments (VEOC D13). Lifeline
-- condition and ESF activation/capacity are independent facts. Rows are an
-- immutable history; later reports supersede rather than overwrite them.

create table operational_assessments (
  id uuid primary key default gen_random_uuid(),
  domain text not null check (domain in ('lifeline', 'esf')),
  jurisdiction_id uuid not null references jurisdictions (id),
  incident_id uuid references incidents (id),
  framework text not null,
  definition_key text not null,
  definition_version integer not null check (definition_version > 0),
  condition text check (condition in ('stable', 'stabilizing', 'unstable', 'unknown')),
  activation text check (activation in ('unknown', 'not_activated', 'activated', 'demobilizing', 'demobilized')),
  capacity text check (capacity in ('unknown', 'adequate', 'constrained', 'critical')),
  legacy_status text,
  payload jsonb not null,
  assessed_at timestamptz not null check (isfinite(assessed_at)),
  source_kind text not null check (source_kind in ('native', 'legacy_board')),
  supersedes_id uuid references operational_assessments (id),
  legacy_board_id uuid references boards (id),
  legacy_record_id uuid references board_records (id),
  created_by uuid not null references persons (id),
  position_id uuid references positions (id),
  position_title text,
  participation_id uuid references incident_participants (id),
  home_organization_id uuid not null references jurisdictions (id),
  created_at timestamptz not null default now(),
  check ((domain = 'lifeline' and framework = 'fema_community_lifelines'
      and condition is not null and activation is null and capacity is null)
    or (domain = 'esf' and framework in ('federal', 'california')
      and condition is null and activation is not null and capacity is not null)),
  check ((source_kind = 'native' and legacy_board_id is null and legacy_record_id is null)
    or (source_kind = 'legacy_board' and legacy_board_id is not null and legacy_record_id is not null)),
  check (position_title is null or length(trim(position_title)) between 1 and 120)
);
create index operational_assessments_current
  on operational_assessments (incident_id, domain, framework, definition_key, assessed_at desc);
create index operational_assessments_supersedes
  on operational_assessments (supersedes_id) where supersedes_id is not null;
create index operational_assessments_legacy
  on operational_assessments (legacy_record_id, assessed_at desc)
  where legacy_record_id is not null;

create table operational_assessment_decisions (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references incidents (id),
  jurisdiction_id uuid not null references jurisdictions (id),
  domain text not null check (domain in ('lifeline', 'esf')),
  framework text not null,
  definition_key text not null,
  selected_assessment_id uuid not null references operational_assessments (id),
  rationale text not null check (length(trim(rationale)) between 1 and 4000),
  created_by uuid not null references persons (id),
  position_id uuid references positions (id),
  position_title text,
  participation_id uuid references incident_participants (id),
  home_organization_id uuid not null references jurisdictions (id),
  created_at timestamptz not null default now()
);
create index operational_assessment_decisions_current
  on operational_assessment_decisions
    (incident_id, domain, framework, definition_key, created_at desc, id desc);

grant select, insert on operational_assessments, operational_assessment_decisions to app_runtime;
revoke update, delete on operational_assessments, operational_assessment_decisions from app_runtime;
alter table operational_assessments enable row level security;
alter table operational_assessment_decisions enable row level security;

-- Contributors cannot lock the incident row through its owner-only UPDATE
-- policy. This helper exposes only closed_at after rechecking exact write
-- authority, and obtains the shared row lock used by all assessment writers.
create function lock_operational_assessment_incident(iid uuid) returns timestamptz
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare closed timestamptz;
begin
  select i.closed_at into closed from public.incidents i
  where i.id = iid and (public.is_writer_of(i.jurisdiction_id)
    or public.has_incident_participation(i.id, 'contributor'))
  for update;
  if not found then raise exception 'incident assessment write forbidden'; end if;
  return closed;
end $$;
revoke all on function lock_operational_assessment_incident(uuid) from public;
grant execute on function lock_operational_assessment_incident(uuid) to app_runtime;

create function operational_supersedes_matches(
  prior_id uuid, iid uuid, assessment_domain text,
  assessment_framework text, assessment_key text
) returns boolean language sql stable security definer
set search_path = pg_catalog, public, pg_temp as $$
  select exists (select 1 from public.operational_assessments prior
    where prior.id = prior_id and prior.incident_id = iid
      and prior.domain = assessment_domain and prior.framework = assessment_framework
      and prior.definition_key = assessment_key
      and exists (select 1 from public.incidents i where i.id = iid
        and (public.is_writer_of(i.jurisdiction_id)
          or public.has_incident_participation(i.id, 'contributor'))))
$$;
revoke all on function operational_supersedes_matches(uuid, uuid, text, text, text) from public;
grant execute on function operational_supersedes_matches(uuid, uuid, text, text, text)
  to app_runtime;

create policy operational_assessments_read on operational_assessments for select using (
  (incident_id is not null and can_read_incident(incident_id))
  or (incident_id is null and is_member_of(jurisdiction_id))
);
create policy operational_assessments_native_insert on operational_assessments for insert with check (
  source_kind = 'native' and legacy_board_id is null and legacy_record_id is null
  and created_by = current_person() and incident_id is not null
  and exists (select 1 from incidents i where i.id = incident_id
    and i.jurisdiction_id = operational_assessments.jurisdiction_id
    and i.closed_at is null
    and ((is_writer_of(i.jurisdiction_id)
      and home_organization_id = i.jurisdiction_id and participation_id is null
      and ((position_id is null and position_title is null) or exists (
        select 1 from auth_sessions s join positions p on p.id = s.active_position_id
        where s.person_id = current_person() and s.ended_at is null
          and s.active_position_id = operational_assessments.position_id
          and p.jurisdiction_id = i.jurisdiction_id
          and p.title = operational_assessments.position_title)))
    or (position_id is null and exists (
      select 1 from incident_participants ip where ip.id = participation_id
        and ip.incident_id = i.id and ip.person_id = current_person()
        and ip.organization_id = home_organization_id
        and ip.incident_position_title = position_title
        and ip.role in ('contributor', 'coordinator')
        and ip.revoked_at is null and ip.expires_at > now()
        and eligible_incident_person(ip.person_id, ip.organization_id)))))
  and (supersedes_id is null or operational_supersedes_matches(
    supersedes_id, incident_id, domain, framework, definition_key))
);
create policy operational_assessment_decisions_read on operational_assessment_decisions for select using (
  can_read_incident(incident_id)
);
create policy operational_assessment_decisions_insert on operational_assessment_decisions for insert with check (
  created_by = current_person()
  and exists (select 1 from incidents i where i.id = incident_id
    and i.jurisdiction_id = operational_assessment_decisions.jurisdiction_id
    and i.closed_at is null
    and ((is_admin_of(i.jurisdiction_id)
      and home_organization_id = i.jurisdiction_id and participation_id is null
      and ((position_id is null and position_title is null) or exists (
        select 1 from auth_sessions s join positions p on p.id = s.active_position_id
        where s.person_id = current_person() and s.ended_at is null
          and s.active_position_id = operational_assessment_decisions.position_id
          and p.jurisdiction_id = i.jurisdiction_id
          and p.title = operational_assessment_decisions.position_title)))
    or (position_id is null and exists (
      select 1 from incident_participants ip where ip.id = participation_id
        and ip.incident_id = i.id and ip.person_id = current_person()
        and ip.organization_id = home_organization_id
        and ip.incident_position_title = position_title and ip.role = 'coordinator'
        and ip.revoked_at is null and ip.expires_at > now()
        and eligible_incident_person(ip.person_id, ip.organization_id)))))
  and exists (select 1 from operational_assessments a
    where a.id = selected_assessment_id and a.incident_id = operational_assessment_decisions.incident_id
      and a.domain = operational_assessment_decisions.domain
      and a.framework = operational_assessment_decisions.framework
      and a.definition_key = operational_assessment_decisions.definition_key)
);

create trigger operational_assessments_immutable before update or delete on operational_assessments
  for each row execute function audit_events_immutable();
create trigger operational_assessment_decisions_immutable
  before update or delete on operational_assessment_decisions
  for each row execute function audit_events_immutable();

-- Preserve the reports already stored by the v1 lifelines and ESF boards.
insert into operational_assessments (
  domain, jurisdiction_id, incident_id, framework, definition_key, definition_version,
  condition, activation, capacity, legacy_status, payload, assessed_at, source_kind,
  legacy_board_id, legacy_record_id, created_by, position_id, position_title,
  participation_id, home_organization_id, created_at
)
select case b.template_key when 'lifelines' then 'lifeline' else 'esf' end,
  b.jurisdiction_id, r.incident_id,
  case b.template_key when 'lifelines' then 'fema_community_lifelines' else 'federal' end,
  case b.template_key when 'lifelines' then r.data->>'lifeline' else r.data->>'esf' end,
  1,
  case when b.template_key = 'lifelines' then r.data->>'status' end,
  case when b.template_key = 'esf_status' then 'unknown' end,
  case when b.template_key = 'esf_status' then 'unknown' end,
  case when b.template_key = 'esf_status' then r.data->>'status' end,
  case when b.template_key = 'lifelines'
    then jsonb_build_object('legacyData', r.data, 'impactStatement', r.data->>'note')
    else jsonb_build_object('legacyData', r.data, 'situation', r.data->>'note') end,
  coalesce(r.updated_at, r.created_at), 'legacy_board', b.id, r.id,
  coalesce(r.updated_by, r.created_by),
  case when r.updated_by is null then r.created_by_position end,
  case when r.updated_by is null then p.title else ip.incident_position_title end,
  ip.id, coalesce(ip.organization_id, b.jurisdiction_id), coalesce(r.updated_at, r.created_at)
from board_records r
join boards b on b.id = r.board_id and b.template_key in ('lifelines', 'esf_status')
left join positions p on p.id = r.created_by_position
left join lateral (
  select x.id, x.organization_id, x.incident_position_title from incident_participants x
  where x.incident_id = r.incident_id and x.person_id = coalesce(r.updated_by, r.created_by)
  order by x.created_at desc limit 1
) ip on true
where (b.template_key = 'lifelines'
    and r.data->>'lifeline' is not null
    and r.data->>'status' in ('stable', 'stabilizing', 'unstable', 'unknown'))
  or (b.template_key = 'esf_status'
    and r.data->>'esf' is not null and r.data->>'status' is not null);

create function capture_legacy_operational_assessment() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  source_board public.boards%rowtype;
  acting_id uuid;
  actor_id uuid;
  actor_position uuid;
  actor_position_title text;
  actor_participation uuid;
  home_org uuid;
  incident_owner uuid;
  previous_id uuid;
  incident_closed timestamptz;
begin
  select * into source_board from public.boards where id = new.board_id;
  if source_board.template_key not in ('lifelines', 'esf_status') then return new; end if;
  if tg_op = 'UPDATE' and new.data is not distinct from old.data
      and new.incident_id is not distinct from old.incident_id then return new; end if;
  acting_id := public.current_person();
  actor_id := coalesce(new.updated_by, new.created_by);
  if session_user = 'app_runtime' and acting_id is null then
    raise exception 'legacy operational assessment requires person context';
  end if;
  if acting_id is not null and actor_id is distinct from acting_id then
    raise exception 'legacy operational assessment attribution mismatch';
  end if;
  if new.incident_id is null then
    if acting_id is null then
      actor_position := case when new.updated_by is null then new.created_by_position end;
      select title into actor_position_title from public.positions where id = actor_position;
      home_org := source_board.jurisdiction_id;
    else
      select m.jurisdiction_id into home_org
      from public.jurisdiction_memberships m join public.persons person on person.id = m.person_id
      where m.person_id = acting_id and m.jurisdiction_id = source_board.jurisdiction_id
        and m.role in ('admin', 'member') and not person.disabled
      for share of m, person;
      if not found then raise exception 'legacy operational assessment write forbidden'; end if;
      select s.active_position_id, pos.title into actor_position, actor_position_title
      from public.auth_sessions s join public.positions pos on pos.id = s.active_position_id
      where s.person_id = acting_id and s.ended_at is null and s.access_expires_at > now()
        and pos.jurisdiction_id = home_org
      order by coalesce(s.resumed_at, s.created_at) desc, s.id desc limit 1
      for share of s, pos;
    end if;
  else
    if not exists (select 1 from public.incident_boards ib
      where ib.incident_id = new.incident_id and ib.board_id = new.board_id) then
      raise exception 'legacy operational assessment incident scope invalid';
    end if;
    if acting_id is null then
      select i.jurisdiction_id, i.closed_at into incident_owner, incident_closed
        from public.incidents i
        where i.id = new.incident_id for update;
      actor_position := case when new.updated_by is null then new.created_by_position end;
      select title into actor_position_title from public.positions where id = actor_position;
      select ip.id, ip.organization_id, ip.incident_position_title
        into actor_participation, home_org, actor_position_title
      from public.incident_participants ip
      where ip.incident_id = new.incident_id and ip.person_id = actor_id
      order by ip.created_at desc limit 1;
      home_org := coalesce(home_org, incident_owner);
    else
      select public.lock_operational_assessment_incident(new.incident_id)
        into incident_closed;
      select i.jurisdiction_id into incident_owner from public.incidents i
        where i.id = new.incident_id;
      select m.jurisdiction_id into home_org
      from public.jurisdiction_memberships m join public.persons person on person.id = m.person_id
      where m.person_id = acting_id and m.jurisdiction_id = incident_owner
        and m.role in ('admin', 'member') and not person.disabled
      for share of m, person;
      if found then
        actor_participation := null;
        select s.active_position_id, pos.title into actor_position, actor_position_title
        from public.auth_sessions s join public.positions pos on pos.id = s.active_position_id
        where s.person_id = acting_id and s.ended_at is null and s.access_expires_at > now()
          and pos.jurisdiction_id = incident_owner
        order by coalesce(s.resumed_at, s.created_at) desc, s.id desc limit 1
        for share of s, pos;
      else
        select ip.id, ip.organization_id, ip.incident_position_title
          into actor_participation, home_org, actor_position_title
        from public.incident_participants ip
        join public.jurisdiction_memberships m on m.person_id = ip.person_id
          and m.jurisdiction_id = ip.organization_id
        join public.persons person on person.id = ip.person_id
        where ip.incident_id = new.incident_id and ip.person_id = acting_id
          and ip.role in ('contributor', 'coordinator') and ip.revoked_at is null
          and ip.expires_at > now() and not person.disabled
        for share of ip, m, person;
        if not found then
          raise exception 'legacy operational assessment write forbidden';
        end if;
        actor_position := null;
      end if;
    end if;
    if incident_closed is not null then
      raise exception 'incident is closed';
    end if;
  end if;
  select id into previous_id from public.operational_assessments
    where legacy_record_id = new.id order by assessed_at desc, created_at desc, id desc limit 1;

  if source_board.template_key = 'lifelines'
      and new.data->>'lifeline' is not null
      and new.data->>'status' in ('stable', 'stabilizing', 'unstable', 'unknown') then
    insert into public.operational_assessments (
      domain, jurisdiction_id, incident_id, framework, definition_key, definition_version,
      condition, payload, assessed_at, source_kind, supersedes_id, legacy_board_id,
      legacy_record_id, created_by, position_id, position_title, participation_id,
      home_organization_id, created_at)
    values ('lifeline', source_board.jurisdiction_id, new.incident_id,
      'fema_community_lifelines', new.data->>'lifeline', 1, new.data->>'status',
      jsonb_build_object('legacyData', new.data, 'impactStatement', new.data->>'note'),
      coalesce(new.updated_at, new.created_at), 'legacy_board', previous_id, new.board_id,
      new.id, actor_id, actor_position, actor_position_title, actor_participation, home_org,
      coalesce(new.updated_at, new.created_at));
  elsif source_board.template_key = 'esf_status'
      and new.data->>'esf' is not null and new.data->>'status' is not null then
    insert into public.operational_assessments (
      domain, jurisdiction_id, incident_id, framework, definition_key, definition_version,
      activation, capacity, legacy_status, payload, assessed_at, source_kind,
      supersedes_id, legacy_board_id, legacy_record_id, created_by, position_id,
      position_title, participation_id, home_organization_id, created_at)
    values ('esf', source_board.jurisdiction_id, new.incident_id, 'federal',
      new.data->>'esf', 1, 'unknown', 'unknown', new.data->>'status',
      jsonb_build_object('legacyData', new.data, 'situation', new.data->>'note'),
      coalesce(new.updated_at, new.created_at), 'legacy_board', previous_id, new.board_id,
      new.id, actor_id, actor_position, actor_position_title, actor_participation, home_org,
      coalesce(new.updated_at, new.created_at));
  end if;
  return new;
end $$;
revoke all on function capture_legacy_operational_assessment() from public;
create trigger board_records_operational_assessment
  after insert or update on board_records
  for each row execute function capture_legacy_operational_assessment();
