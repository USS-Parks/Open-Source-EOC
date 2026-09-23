-- Open Source EOC pre-release schema baseline.
-- Generated from a fresh database migrated through 0101, with schema_migrations excluded.
-- No static seed rows exist in the retired chain; standard templates are seeded by application services.
-- Default privileges intentionally apply to the current migration owner rather than the dump-time role.

do $openeoc$
begin
  if not exists (select from pg_roles where rolname = 'app_runtime') then
    create role app_runtime login;
  end if;
end
$openeoc$;
--
-- PostgreSQL database dump
--


-- Dumped from database version 16.15
-- Dumped by pg_dump version 16.15

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: postgis; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public;


--
-- Name: EXTENSION postgis; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION postgis IS 'PostGIS geometry and geography spatial types and functions';


--
-- Name: append_iap_participant_audit(uuid, uuid, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.append_iap_participant_audit(iid uuid, sid uuid, event_category text, event_payload jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
declare
  actor uuid := public.current_person();
  owner_organization uuid;
  event_id uuid;
begin
  if event_category not in (
    'iap.assembled', 'iap.submitted', 'iap.ics204.revised', 'iap.revision.created'
  ) then
    raise exception 'unsupported IAP participant audit category';
  end if;
  select i.jurisdiction_id into owner_organization
  from public.iaps p join public.incidents i on i.id = p.incident_id
  where p.id = sid and p.incident_id = iid
    and public.has_incident_participation(p.incident_id, 'contributor')
    and (
      (event_category = 'iap.submitted' and p.submitted_by = actor)
      or (event_category <> 'iap.submitted' and p.prepared_by = actor)
    );
  if owner_organization is null then
    raise exception 'IAP participant audit authority is not current';
  end if;
  insert into public.audit_events
    (jurisdiction_id, incident_id, person_id, category, subject_table, subject_id, payload)
  values (owner_organization, iid, actor, event_category, 'iaps', sid, event_payload)
  returning id into event_id;
  return event_id;
end $$;


--
-- Name: audit_events_immutable(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.audit_events_immutable() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  raise exception 'audit_events is append-only: % is not permitted', tg_op;
end $$;


--
-- Name: can_read_incident(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_read_incident(iid uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
  select exists (select 1 from public.incidents i where i.id = iid
    and (public.is_member_of(i.jurisdiction_id) or
         public.has_incident_participation(i.id)))
$$;


--
-- Name: can_revise_incident_area(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_revise_incident_area(iid uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
  select exists (select 1 from public.incidents i where i.id = iid
    and (public.is_admin_of(i.jurisdiction_id) or
         public.has_incident_participation(i.id, 'coordinator')))
$$;


--
-- Name: capture_legacy_operational_assessment(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.capture_legacy_operational_assessment() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
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


--
-- Name: check_incident_area_append(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_incident_area_append() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
declare
  incident_closed timestamptz;
  next_revision integer;
begin
  select closed_at into incident_closed from incidents
    where id = new.incident_id for update;
  if not found then raise exception 'incident not found'; end if;
  if incident_closed is not null then raise exception 'incident is closed'; end if;
  select coalesce(max(revision), 0) + 1 into next_revision
    from incident_area_revisions where incident_id = new.incident_id;
  if new.revision <> next_revision then
    raise exception 'incident area revision out of sequence';
  end if;
  new.created_at := now();
  return new;
end $$;


--
-- Name: check_incident_participant_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_incident_participant_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if tg_op = 'DELETE' then
    raise exception 'participation grants are append-only';
  end if;
  if tg_op = 'INSERT' then
    if new.expires_at <= now() then raise exception 'grant must expire in the future'; end if;
    new.created_at := now();
    return new;
  end if;
  if row(old.id, old.incident_id, old.organization_id, old.person_id,
         old.incident_position_title, old.role, old.expires_at, old.reason,
         old.created_by, old.created_at, old.revoked_at, old.revoked_by, old.revoke_reason)
     is distinct from
     row(new.id, new.incident_id, new.organization_id, new.person_id,
         new.incident_position_title, new.role, new.expires_at, new.reason,
         new.created_by, new.created_at, old.revoked_at, old.revoked_by, old.revoke_reason)
     or old.revoked_at is not null or new.revoked_at is null
     or new.revoked_by is distinct from current_person()
     or new.revoke_reason is null or length(trim(new.revoke_reason)) not between 1 and 1000 then
    raise exception 'participation grants are immutable except revocation';
  end if;
  new.revoked_at := now();
  return new;
end $$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: checklist_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.checklist_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    incident_id uuid NOT NULL,
    position_id uuid,
    item text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    completed_at timestamp with time zone,
    completed_by uuid,
    completed_by_position uuid,
    category text DEFAULT 'general'::text NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    due_at timestamp with time zone,
    assigned_participant_id uuid,
    revision integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_by_organization_id uuid,
    completed_by_participation_id uuid,
    completed_as_title text,
    CONSTRAINT checklist_completion_shape CHECK ((((status <> 'completed'::text) AND (completed_at IS NULL) AND (completed_by IS NULL) AND (completed_by_position IS NULL) AND (completed_by_organization_id IS NULL) AND (completed_by_participation_id IS NULL) AND (completed_as_title IS NULL)) OR ((status = 'completed'::text) AND (completed_at IS NOT NULL) AND (completed_by IS NOT NULL) AND (completed_by_organization_id IS NOT NULL) AND (completed_as_title IS NOT NULL) AND (num_nonnulls(completed_by_position, completed_by_participation_id) = 1)))),
    CONSTRAINT checklist_items_category_check CHECK ((category ~ '^[a-z][a-z0-9_]{0,79}$'::text)),
    CONSTRAINT checklist_items_completed_as_title_check CHECK (((completed_as_title IS NULL) OR ((length(TRIM(BOTH FROM completed_as_title)) >= 1) AND (length(TRIM(BOTH FROM completed_as_title)) <= 160)))),
    CONSTRAINT checklist_items_revision_check CHECK ((revision > 0)),
    CONSTRAINT checklist_items_status_check CHECK ((status = ANY (ARRAY['open'::text, 'in_progress'::text, 'completed'::text]))),
    CONSTRAINT checklist_one_assignment CHECK ((num_nonnulls(position_id, assigned_participant_id) <= 1))
);


--
-- Name: checklist_actor_can_update(public.checklist_items); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.checklist_actor_can_update(task public.checklist_items) RETURNS boolean
    LANGUAGE sql STABLE
    SET search_path TO 'pg_catalog', 'public'
    AS $$
  select exists (
    select 1 from incidents i
    where i.id = task.incident_id and i.closed_at is null and (
      is_admin_of(i.jurisdiction_id)
      or (task.position_id is not null and is_writer_of(i.jurisdiction_id) and exists (
        select 1 from auth_sessions s
        join position_assignments a on a.position_id = s.active_position_id
          and a.person_id = s.person_id and a.revoked_at is null
        where s.person_id = current_person() and s.ended_at is null
          and s.active_position_id = task.position_id
      ))
      or (task.assigned_participant_id is not null and exists (
        select 1 from incident_participants ip
        where ip.id = task.assigned_participant_id and ip.incident_id = task.incident_id
          and ip.person_id = current_person() and ip.revoked_at is null
          and ip.expires_at > now()
          and ip.role in ('contributor', 'coordinator')
          and eligible_incident_person(ip.person_id, ip.organization_id)
      ))
    )
  )
$$;


--
-- Name: create_auth_session(uuid, text, text, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_auth_session(pid uuid, access_hash text, resume_hash text, access_expires_at timestamp with time zone) RETURNS uuid
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
  insert into public.auth_sessions (person_id, access_hash, resume_hash, access_expires_at)
  values (pid, access_hash, resume_hash, access_expires_at)
  returning id
$$;


--
-- Name: current_person(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.current_person() RETURNS uuid
    LANGUAGE sql STABLE
    AS $$
  select nullif(current_setting('app.person_id', true), '')::uuid
$$;


--
-- Name: eligible_incident_person(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.eligible_incident_person(pid uuid, oid uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
  select exists (select 1 from public.persons p
    join public.jurisdiction_memberships m on m.person_id = p.id
    where p.id = pid and not p.disabled and m.jurisdiction_id = oid)
$$;


--
-- Name: enforce_corrective_action_revision(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_corrective_action_revision() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
declare
  assigned_person boolean;
begin
  if new.revision <> old.revision + 1 then
    raise exception 'corrective action revision must advance by one' using errcode = '40001';
  end if;

  if old.completed_at is not null and
      (new.completed_at is distinct from old.completed_at
       or new.completed_by is distinct from old.completed_by) then
    raise exception 'first completion attribution is immutable';
  end if;
  if old.completed_at is null and new.completed_at is not null and
      (new.status <> 'complete' or new.completed_by is distinct from current_person()) then
    raise exception 'completion must be attributed to the current person';
  end if;
  if new.status = 'complete' and new.completed_at is null then
    raise exception 'completed action requires completion attribution';
  end if;

  if is_writer_of(old.jurisdiction_id) then
    return new;
  end if;

  select exists (
    select 1 from incident_participants ip
    where ip.id = old.owner_participant and ip.incident_id = old.incident_id
      and ip.person_id = current_person()
      and ip.revoked_at is null and ip.expires_at > now()
      and eligible_incident_person(ip.person_id, ip.organization_id)
  ) into assigned_person;
  if not assigned_person then
    raise exception 'corrective action update is not authorized' using errcode = '42501';
  end if;

  if row(new.jurisdiction_id, new.incident_id, new.operational_period_revision,
         new.capability, new.capability_element, new.recommendation, new.priority,
         new.owner_position, new.owner_person, new.owner_participant,
         new.assignment_snapshot, new.due_date, new.created_by, new.created_at)
     is distinct from
     row(old.jurisdiction_id, old.incident_id, old.operational_period_revision,
         old.capability, old.capability_element, old.recommendation, old.priority,
         old.owner_position, old.owner_person, old.owner_participant,
         old.assignment_snapshot, old.due_date, old.created_by, old.created_at) then
    raise exception 'assigned participant may update status only' using errcode = '42501';
  end if;
  return new;
end $$;


--
-- Name: enforce_iap_attribution_and_transition(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_iap_attribution_and_transition() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
declare
  actor uuid := current_person();
  owner_organization uuid;
  owner_writer boolean;
  owner_admin boolean;
  active_participant boolean;
  active_position boolean;
begin
  select jurisdiction_id into owner_organization from incidents where id = new.incident_id;
  if owner_organization is null then raise exception 'incident not found'; end if;
  select is_writer_of(owner_organization), is_admin_of(owner_organization)
    into owner_writer, owner_admin;

  select exists (
    select 1 from incident_participants ip
    where ip.id = new.prepared_participation_id
      and ip.incident_id = new.incident_id
      and ip.organization_id = new.prepared_organization_id
      and ip.person_id = actor and ip.role in ('contributor', 'coordinator')
      and ip.revoked_at is null and ip.expires_at > now()
      and eligible_incident_person(ip.person_id, ip.organization_id)
  ) into active_participant;

  select exists (
    select 1 from positions p
    join position_assignments pa on pa.position_id = p.id
    join auth_sessions s on s.person_id = actor and s.active_position_id = p.id
    where p.id = new.prepared_position_id and p.jurisdiction_id = owner_organization
      and pa.person_id = actor and pa.revoked_at is null
      and s.id is not null and s.ended_at is null
  ) into active_position;

  if tg_op = 'INSERT' then
    if new.prepared_by is distinct from actor or new.status <> 'draft'
      or new.submitted_by is not null or new.approved_by is not null then
      raise exception 'invalid initial IAP attribution';
    end if;
    if new.prepared_participation_id is not null then
      if not active_participant or new.prepared_position_id is not null then
        raise exception 'IAP participant attribution is not current';
      end if;
    elsif new.prepared_organization_id <> owner_organization or not owner_writer
      or (new.prepared_position_id is not null and not active_position) then
      raise exception 'IAP owner attribution is not current';
    end if;
    return new;
  end if;

  if row(new.id, new.incident_id, new.prepared_by, new.prepared_organization_id,
         new.prepared_position_id, new.prepared_participation_id,
         new.prepared_role_key, new.prepared_role_label, new.created_at)
     is distinct from
     row(old.id, old.incident_id, old.prepared_by, old.prepared_organization_id,
         old.prepared_position_id, old.prepared_participation_id,
         old.prepared_role_key, old.prepared_role_label, old.created_at) then
    raise exception 'IAP preparation attribution is immutable';
  end if;
  if row(new.operational_period, new.period_revision) is distinct from
     row(old.operational_period, old.period_revision) then
    raise exception 'IAP period binding is immutable';
  end if;
  if old.submitted_by is not null and
     row(new.submitted_by, new.submitted_at) is distinct from
     row(old.submitted_by, old.submitted_at) then
    raise exception 'IAP submission attribution is immutable';
  end if;
  if old.approved_by is not null and
     row(new.approved_by, new.approved_at) is distinct from
     row(old.approved_by, old.approved_at) then
    raise exception 'IAP approval attribution is immutable';
  end if;

  if new.status = old.status then
    if old.status <> 'draft' and
       row(new.operational_period, new.period_revision, new.form_ids, new.content)
       is distinct from
       row(old.operational_period, old.period_revision, old.form_ids, old.content) then
      raise exception 'submitted or published IAP content is locked';
    end if;
    if row(new.submitted_by, new.submitted_at, new.approved_by, new.approved_at)
       is distinct from
       row(old.submitted_by, old.submitted_at, old.approved_by, old.approved_at) then
      raise exception 'IAP handoff attribution requires a state transition';
    end if;
    return new;
  end if;

  if row(new.operational_period, new.period_revision, new.form_ids, new.content)
     is distinct from
     row(old.operational_period, old.period_revision, old.form_ids, old.content) then
    raise exception 'IAP content cannot change during a state transition';
  end if;

  if old.status = 'draft' and new.status = 'in_approval' then
    select exists (
      select 1 from incident_participants ip
      where ip.id = old.prepared_participation_id and ip.incident_id = old.incident_id
        and ip.person_id = actor and ip.role in ('contributor', 'coordinator')
        and ip.revoked_at is null and ip.expires_at > now()
        and eligible_incident_person(ip.person_id, ip.organization_id)
    ) into active_participant;
    if not owner_writer and not (old.prepared_by = actor and active_participant) then
      raise exception 'IAP submission requires current writer authority';
    end if;
    if new.submitted_by is distinct from actor or new.submitted_at is null then
      raise exception 'IAP submission attribution is required';
    end if;
  elsif old.status in ('draft', 'in_approval') and new.status = 'approved' then
    if not owner_admin then raise exception 'IAP approval requires incident owner admin'; end if;
    if new.approved_by is distinct from actor or new.approved_at is null then
      raise exception 'IAP approval attribution is required';
    end if;
  elsif old.status = 'approved' and new.status = 'complete' then
    if not owner_admin then raise exception 'IAP completion requires incident owner admin'; end if;
  else
    raise exception 'illegal IAP state transition';
  end if;
  return new;
end $$;


--
-- Name: enforce_iap_revision_lineage(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_iap_revision_lineage() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
declare
  parent record;
  content_changed boolean;
begin
  if tg_op = 'INSERT' then
    if new.revision_number = 1 then
      if new.revision_root_id <> new.id or new.supersedes_iap_id is not null
        or new.content_revision <> 1 then
        raise exception 'invalid initial IAP revision lineage';
      end if;
      return new;
    end if;
    select id, incident_id, operational_period, period_revision, status,
      revision_root_id, revision_number
    into parent from iaps where id = new.supersedes_iap_id for update;
    if not found or parent.status <> 'approved'
      or parent.incident_id <> new.incident_id
      or parent.operational_period <> new.operational_period
      or parent.period_revision is distinct from new.period_revision
      or parent.revision_root_id <> new.revision_root_id
      or parent.revision_number + 1 <> new.revision_number
      or new.content_revision <> 1 then
      raise exception 'invalid IAP revision source';
    end if;
    return new;
  end if;

  if row(new.revision_root_id, new.revision_number, new.supersedes_iap_id)
     is distinct from
     row(old.revision_root_id, old.revision_number, old.supersedes_iap_id) then
    raise exception 'IAP revision lineage is immutable';
  end if;
  content_changed := row(new.content, new.form_ids) is distinct from row(old.content, old.form_ids);
  if content_changed then
    if old.status <> 'draft' or new.status <> 'draft'
      or new.content_revision <> old.content_revision + 1 then
      raise exception 'IAP draft content revision is invalid';
    end if;
  elsif new.content_revision <> old.content_revision then
    raise exception 'IAP content revision cannot change without content';
  end if;
  return new;
end $$;


--
-- Name: find_person_by_email(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.find_person_by_email(addr text) RETURNS TABLE(id uuid, password_hash text, disabled boolean)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
  -- Columns are alias-qualified so they resolve to the table, not the
  -- same-named RETURNS TABLE output parameters (which would be ambiguous).
  select p.id, p.password_hash, p.disabled from public.persons p where lower(p.email) = lower(addr)
$$;


--
-- Name: guard_checklist_task_prerequisites(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.guard_checklist_task_prerequisites() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public'
    AS $$
begin
  if new.status = 'completed' and old.status <> 'completed' and exists (
    select 1 from checklist_task_dependencies d join checklist_items prerequisite
      on prerequisite.id = d.prerequisite_task_id
    where d.task_id = old.id and prerequisite.status <> 'completed'
  ) then raise exception 'task prerequisites are incomplete'; end if;
  return new;
end
$$;


--
-- Name: has_guest_scope(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.has_guest_scope(jid uuid, wanted text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1 from guest_grants
    where person_id = current_person() and jurisdiction_id = jid
      and revoked_at is null and expires_at > now()
      and wanted = any (scopes))
$$;


--
-- Name: has_incident_participation(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.has_incident_participation(iid uuid, minimum_role text DEFAULT 'viewer'::text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
  select exists (select 1 from public.incident_participants ip
    join public.jurisdiction_memberships m on m.person_id = ip.person_id
      and m.jurisdiction_id = ip.organization_id
    join public.persons p on p.id = ip.person_id
    where ip.incident_id = iid and ip.person_id = public.current_person()
      and not p.disabled and ip.revoked_at is null and ip.expires_at > now()
      and case minimum_role
        when 'viewer' then true
        when 'contributor' then ip.role in ('contributor', 'coordinator')
        when 'coordinator' then ip.role = 'coordinator'
        else false end)
$$;


--
-- Name: is_admin_of(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_admin_of(jid uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1 from jurisdiction_memberships
    where person_id = current_person() and jurisdiction_id = jid and role = 'admin')
$$;


--
-- Name: is_instance_admin(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_instance_admin() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select coalesce(
    (select is_instance_admin from persons where id = current_person()), false)
$$;


--
-- Name: is_member_of(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_member_of(jid uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1 from jurisdiction_memberships
    where person_id = current_person() and jurisdiction_id = jid)
$$;


--
-- Name: is_thread_participant(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_thread_participant(tid uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1 from thread_members m
    where m.thread_id = tid and m.removed_at is null
      and ((m.member_kind = 'person' and m.person_id = current_person())
        or (m.member_kind = 'position' and exists (
              select 1 from position_assignments a
              where a.position_id = m.position_id
                and a.person_id = current_person() and a.revoked_at is null))))
$$;


--
-- Name: is_writer_of(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_writer_of(jid uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1 from jurisdiction_memberships
    where person_id = current_person() and jurisdiction_id = jid
      and role in ('admin', 'member'))
$$;


--
-- Name: link_identity(uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.link_identity(pid uuid, iss text, sub text) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
  insert into public.person_identities (person_id, issuer, subject) values (pid, iss, sub)
$$;


--
-- Name: lock_incident_area(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.lock_incident_area(iid uuid) RETURNS timestamp with time zone
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
declare closed timestamptz;
begin
  if not public.can_revise_incident_area(iid) then
    raise exception 'incident area revision forbidden';
  end if;
  select closed_at into closed from public.incidents where id = iid for update;
  if not found then raise exception 'incident not found'; end if;
  return closed;
end $$;


--
-- Name: lock_operational_assessment_incident(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.lock_operational_assessment_incident(iid uuid) RETURNS timestamp with time zone
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
declare closed timestamptz;
begin
  select i.closed_at into closed from public.incidents i
  where i.id = iid and (public.is_writer_of(i.jurisdiction_id)
    or public.has_incident_participation(i.id, 'contributor'))
  for update;
  if not found then raise exception 'incident assessment write forbidden'; end if;
  return closed;
end $$;


--
-- Name: operational_supersedes_matches(uuid, uuid, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.operational_supersedes_matches(prior_id uuid, iid uuid, assessment_domain text, assessment_framework text, assessment_key text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
  select exists (select 1 from public.operational_assessments prior
    where prior.id = prior_id and prior.incident_id = iid
      and prior.domain = assessment_domain and prior.framework = assessment_framework
      and prior.definition_key = assessment_key
      and exists (select 1 from public.incidents i where i.id = iid
        and (public.is_writer_of(i.jurisdiction_id)
          or public.has_incident_participation(i.id, 'contributor'))))
$$;


--
-- Name: reject_incident_area_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reject_incident_area_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  raise exception 'incident area revisions are append-only';
end $$;


--
-- Name: resolve_auth_session(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.resolve_auth_session(access_hash_in text) RETURNS TABLE(session_id uuid, access_expires_at timestamp with time zone, active_position_id uuid, person_id uuid, email text, display_name text, disabled boolean)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
  select s.id, s.access_expires_at, s.active_position_id,
         p.id, p.email, p.display_name, p.disabled
  from public.auth_sessions s
  join public.persons p on p.id = s.person_id
  where s.access_hash = access_hash_in and s.ended_at is null
$$;


--
-- Name: resolve_identity(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.resolve_identity(iss text, sub text) RETURNS uuid
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
  select person_id from public.person_identities where issuer = iss and subject = sub
$$;


--
-- Name: resume_auth_session(text, text, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.resume_auth_session(resume_hash_in text, new_access_hash text, access_expires_at_in timestamp with time zone) RETURNS uuid
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
  update public.auth_sessions
  set access_hash = new_access_hash, access_expires_at = access_expires_at_in, resumed_at = now()
  where resume_hash = resume_hash_in and ended_at is null
  returning id
$$;


--
-- Name: validate_checklist_task_dependency(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_checklist_task_dependency() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public'
    AS $$
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


--
-- Name: validate_checklist_task_update(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_checklist_task_update() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public'
    AS $$
declare
  owner_id uuid;
  actor_position uuid;
  actor_title text;
  participant incident_participants%rowtype;
  metadata_changed boolean;
begin
  if new.id is distinct from old.id or new.created_at is distinct from old.created_at
    or new.incident_id <> old.incident_id or new.sort_order <> old.sort_order then
    raise exception 'checklist task scope is immutable';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(old.incident_id::text, 82::bigint));
  select i.jurisdiction_id into owner_id from incidents i
  where i.id = old.incident_id and i.closed_at is null;
  if owner_id is null then raise exception 'incident is closed'; end if;

  metadata_changed := row(new.item, new.category, new.due_at, new.position_id,
    new.assigned_participant_id) is distinct from row(old.item, old.category, old.due_at,
    old.position_id, old.assigned_participant_id);
  if metadata_changed and not is_admin_of(owner_id) then
    raise exception 'task metadata requires incident owner admin';
  end if;
  if new.position_id is not null and not exists (
    select 1 from incident_positions ip join positions p on p.id = ip.position_id
    where ip.incident_id = old.incident_id and ip.position_id = new.position_id
      and p.jurisdiction_id = owner_id
  ) then raise exception 'assigned position is not attached to the incident'; end if;
  if new.assigned_participant_id is not null then
    select * into participant from incident_participants ip
    where ip.id = new.assigned_participant_id and ip.incident_id = old.incident_id
      and ip.organization_id <> owner_id and ip.revoked_at is null and ip.expires_at > now()
      and ip.role in ('contributor', 'coordinator')
      and eligible_incident_person(ip.person_id, ip.organization_id);
    if not found then raise exception 'assigned participant is not active for this incident'; end if;
  end if;

  if old.status = 'completed' and row(new.status, new.completed_at, new.completed_by,
    new.completed_by_position, new.completed_by_organization_id,
    new.completed_by_participation_id, new.completed_as_title) is distinct from
    row(old.status, old.completed_at, old.completed_by, old.completed_by_position,
    old.completed_by_organization_id, old.completed_by_participation_id,
    old.completed_as_title) then
    raise exception 'task completion attribution is immutable';
  end if;

  if new.status = 'completed' and old.status <> 'completed' then
    if new.position_id is not null then
      select s.active_position_id, p.title into actor_position, actor_title
      from auth_sessions s
      join positions p on p.id = s.active_position_id
      join position_assignments a on a.position_id = s.active_position_id
        and a.person_id = s.person_id and a.revoked_at is null
      where s.person_id = current_person() and s.ended_at is null
        and s.active_position_id = new.position_id and p.jurisdiction_id = owner_id
      limit 1;
      if actor_position is null then raise exception 'task requires its assigned position'; end if;
      new.completed_by_position := actor_position;
      new.completed_by_participation_id := null;
      new.completed_by_organization_id := owner_id;
      new.completed_as_title := actor_title;
    elsif new.assigned_participant_id is not null and participant.person_id = current_person() then
      new.completed_by_position := null;
      new.completed_by_participation_id := participant.id;
      new.completed_by_organization_id := participant.organization_id;
      new.completed_as_title := participant.incident_position_title;
    else
      raise exception 'task has no current assignee';
    end if;
    new.completed_at := now();
    new.completed_by := current_person();
  elsif new.status is distinct from old.status and not (
    is_admin_of(owner_id) or checklist_actor_can_update(old)
  ) then
    raise exception 'task status requires the current assignee';
  end if;

  new.revision := old.revision + 1;
  new.updated_at := now();
  return new;
end
$$;


--
-- Name: workflow_pending_requester_authorized(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.workflow_pending_requester_authorized(rid uuid, required_role text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
  select required_role in ('admin', 'writer', 'assigned_position') and exists (
    select 1
    from public.board_workflow_instances w
    join public.board_records r on r.id = w.record_id and r.board_id = w.board_id
      and r.incident_id is not distinct from w.incident_id
    join public.boards b on b.id = w.board_id and b.jurisdiction_id = w.jurisdiction_id
    join public.persons p on p.id = w.pending_requested_by and not p.disabled
    join public.jurisdiction_memberships m on m.person_id = p.id
      and m.jurisdiction_id = w.jurisdiction_id
    where w.record_id = rid
      and case required_role when 'admin' then m.role = 'admin'
        else m.role in ('admin', 'member') end
      and (required_role <> 'assigned_position' or (
        w.assignment_kind = 'position'
        and exists (select 1 from public.position_assignments a
          where a.position_id = w.assignment_position_id
            and a.person_id = w.pending_requested_by and a.revoked_at is null)
      ))
      and (public.is_writer_of(w.jurisdiction_id)
        or (w.incident_id is not null
          and public.has_incident_participation(w.incident_id, 'contributor')))
      and (w.incident_id is null or exists (
        select 1 from public.incidents i
        where i.id = w.incident_id and i.closed_at is null))
  )
$$;


--
-- Name: aar_observations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aar_observations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    jurisdiction_id uuid NOT NULL,
    incident_id uuid NOT NULL,
    capability text NOT NULL,
    kind text NOT NULL,
    observation text NOT NULL,
    recommendation text,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    capability_element text DEFAULT 'none'::text NOT NULL,
    operational_period_revision integer,
    CONSTRAINT aar_observations_kind_check CHECK ((kind = ANY (ARRAY['strength'::text, 'improvement'::text])))
);


--
-- Name: aars; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aars (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    jurisdiction_id uuid NOT NULL,
    incident_id uuid NOT NULL,
    title text NOT NULL,
    content jsonb NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: audit_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    seq bigint NOT NULL,
    jurisdiction_id uuid NOT NULL,
    incident_id uuid,
    person_id uuid NOT NULL,
    position_id uuid,
    category text NOT NULL,
    subject_table text,
    subject_id uuid,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    corrects uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: audit_events_seq_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.audit_events ALTER COLUMN seq ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.audit_events_seq_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: auth_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auth_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    person_id uuid NOT NULL,
    access_hash text NOT NULL,
    resume_hash text NOT NULL,
    access_expires_at timestamp with time zone NOT NULL,
    active_position_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    resumed_at timestamp with time zone,
    ended_at timestamp with time zone
);


--
-- Name: badges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.badges (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    jurisdiction_id uuid NOT NULL,
    person_id uuid NOT NULL,
    token_hash text NOT NULL,
    label text,
    issued_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone
);


--
-- Name: board_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.board_records (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    board_id uuid NOT NULL,
    data jsonb NOT NULL,
    created_by uuid NOT NULL,
    created_by_position uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid,
    updated_at timestamp with time zone,
    geom public.geometry(Geometry,4326),
    incident_id uuid
);


--
-- Name: board_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.board_templates (
    key text NOT NULL,
    version integer NOT NULL,
    title text NOT NULL,
    definition jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: board_workflow_approvals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.board_workflow_approvals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    record_id uuid NOT NULL,
    board_id uuid NOT NULL,
    jurisdiction_id uuid NOT NULL,
    incident_id uuid,
    state_revision integer NOT NULL,
    transition_key text NOT NULL,
    rule_key text NOT NULL,
    actor_person_id uuid NOT NULL,
    actor_position_id uuid,
    actor_participation_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT board_workflow_approvals_state_revision_check CHECK ((state_revision > 0))
);


--
-- Name: board_workflow_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.board_workflow_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sequence bigint NOT NULL,
    record_id uuid NOT NULL,
    board_id uuid NOT NULL,
    jurisdiction_id uuid NOT NULL,
    incident_id uuid,
    state_revision integer NOT NULL,
    event_kind text NOT NULL,
    event_key text NOT NULL,
    from_state text,
    to_state text,
    actor_person_id uuid NOT NULL,
    actor_position_id uuid,
    actor_participation_id uuid,
    detail jsonb DEFAULT '{}'::jsonb NOT NULL,
    transaction_id bigint DEFAULT txid_current() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT board_workflow_history_event_kind_check CHECK ((event_kind = ANY (ARRAY['transition_requested'::text, 'approval_recorded'::text, 'transition_completed'::text, 'escalation'::text]))),
    CONSTRAINT board_workflow_history_state_revision_check CHECK ((state_revision >= 0))
);


--
-- Name: board_workflow_history_sequence_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.board_workflow_history ALTER COLUMN sequence ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.board_workflow_history_sequence_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: board_workflow_idempotency; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.board_workflow_idempotency (
    record_id uuid NOT NULL,
    board_id uuid NOT NULL,
    jurisdiction_id uuid NOT NULL,
    incident_id uuid,
    actor_person_id uuid NOT NULL,
    idempotency_key text NOT NULL,
    request_digest text NOT NULL,
    result jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT board_workflow_idempotency_idempotency_key_check CHECK (((length(idempotency_key) >= 1) AND (length(idempotency_key) <= 200))),
    CONSTRAINT board_workflow_idempotency_request_digest_check CHECK ((length(request_digest) = 64))
);


--
-- Name: board_workflow_instances; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.board_workflow_instances (
    record_id uuid NOT NULL,
    board_id uuid NOT NULL,
    jurisdiction_id uuid NOT NULL,
    incident_id uuid,
    template_key text NOT NULL,
    template_version integer NOT NULL,
    state_key text NOT NULL,
    state_revision integer DEFAULT 0 NOT NULL,
    transition_key text,
    transitioned_at timestamp with time zone DEFAULT now() NOT NULL,
    due_at timestamp with time zone,
    due_status text DEFAULT 'none'::text NOT NULL,
    assignment_kind text,
    assignment_position_id uuid,
    assignment_participant_id uuid,
    assignment_snapshot jsonb,
    pending_transition_key text,
    pending_to_state text,
    pending_requested_by uuid,
    pending_assignment_request jsonb,
    pending_assignment_snapshot jsonb,
    pending_started_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT board_workflow_instances_assignment_kind_check CHECK ((assignment_kind = ANY (ARRAY['position'::text, 'incident_participant'::text]))),
    CONSTRAINT board_workflow_instances_check CHECK ((((assignment_kind IS NULL) AND (assignment_position_id IS NULL) AND (assignment_participant_id IS NULL)) OR ((assignment_kind = 'position'::text) AND (assignment_position_id IS NOT NULL) AND (assignment_participant_id IS NULL)) OR ((assignment_kind = 'incident_participant'::text) AND (assignment_position_id IS NULL) AND (assignment_participant_id IS NOT NULL)))),
    CONSTRAINT board_workflow_instances_check1 CHECK ((((pending_transition_key IS NULL) AND (pending_to_state IS NULL) AND (pending_requested_by IS NULL) AND (pending_assignment_request IS NULL) AND (pending_assignment_snapshot IS NULL) AND (pending_started_at IS NULL)) OR ((pending_transition_key IS NOT NULL) AND (pending_to_state IS NOT NULL) AND (pending_requested_by IS NOT NULL) AND (pending_started_at IS NOT NULL)))),
    CONSTRAINT board_workflow_instances_check2 CHECK (((pending_assignment_request IS NULL) = (pending_assignment_snapshot IS NULL))),
    CONSTRAINT board_workflow_instances_due_status_check CHECK ((due_status = ANY (ARRAY['none'::text, 'scheduled'::text, 'missing'::text]))),
    CONSTRAINT board_workflow_instances_state_revision_check CHECK ((state_revision >= 0))
);


--
-- Name: boards; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.boards (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    jurisdiction_id uuid NOT NULL,
    template_key text NOT NULL,
    template_version integer NOT NULL,
    title text NOT NULL,
    local_fields jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_at timestamp with time zone
);


--
-- Name: briefings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.briefings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    incident_id uuid NOT NULL,
    title text NOT NULL,
    section text,
    scheduled_at timestamp with time zone NOT NULL,
    notified_at timestamp with time zone,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: cap_alert_reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cap_alert_reviews (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    alert_id uuid NOT NULL,
    jurisdiction_id uuid NOT NULL,
    revision integer NOT NULL,
    state text NOT NULL,
    actor_person_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT cap_alert_reviews_revision_check CHECK ((revision > 0)),
    CONSTRAINT cap_alert_reviews_state_check CHECK ((state = ANY (ARRAY['draft'::text, 'in_review'::text, 'approved'::text])))
);


--
-- Name: cap_alerts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cap_alerts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    jurisdiction_id uuid NOT NULL,
    incident_id uuid,
    identifier text NOT NULL,
    origin text NOT NULL,
    status text NOT NULL,
    msg_type text NOT NULL,
    scope text NOT NULL,
    ipaws_eligible boolean DEFAULT false NOT NULL,
    alert jsonb NOT NULL,
    xml text NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT cap_alerts_origin_check CHECK ((origin = ANY (ARRAY['authored'::text, 'ingested'::text])))
);


--
-- Name: checklist_completion_operations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.checklist_completion_operations (
    operation_id uuid NOT NULL,
    task_id uuid NOT NULL,
    incident_id uuid NOT NULL,
    actor_person_id uuid NOT NULL,
    request_digest text NOT NULL,
    receipt jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT checklist_completion_operations_request_digest_check CHECK ((length(request_digest) = 64))
);


--
-- Name: checklist_task_dependencies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.checklist_task_dependencies (
    task_id uuid NOT NULL,
    prerequisite_task_id uuid NOT NULL,
    CONSTRAINT checklist_task_dependencies_check CHECK ((task_id <> prerequisite_task_id))
);


--
-- Name: collab_backends; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.collab_backends (
    jurisdiction_id uuid NOT NULL,
    kind text NOT NULL,
    base_url text NOT NULL,
    token_envelope text,
    homeserver text,
    enabled boolean DEFAULT false NOT NULL,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT collab_backends_kind_check CHECK ((kind = ANY (ARRAY['mattermost'::text, 'matrix'::text])))
);


--
-- Name: collab_channel_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.collab_channel_members (
    channel_id uuid NOT NULL,
    person_id uuid NOT NULL,
    added_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: collab_channels; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.collab_channels (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    space_id uuid NOT NULL,
    section text NOT NULL,
    name text NOT NULL,
    remote_channel_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: collab_spaces; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.collab_spaces (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    incident_id uuid NOT NULL,
    backend_kind text NOT NULL,
    remote_space_id text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_at timestamp with time zone,
    CONSTRAINT collab_spaces_status_check CHECK ((status = ANY (ARRAY['active'::text, 'archived'::text])))
);


--
-- Name: corrective_actions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.corrective_actions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    jurisdiction_id uuid NOT NULL,
    incident_id uuid,
    capability text NOT NULL,
    recommendation text NOT NULL,
    owner_position uuid,
    owner_person uuid,
    due_date date,
    status text DEFAULT 'open'::text NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    capability_element text DEFAULT 'none'::text NOT NULL,
    operational_period_revision integer,
    priority text DEFAULT 'unspecified'::text NOT NULL,
    revision integer DEFAULT 0 NOT NULL,
    owner_participant uuid,
    assignment_snapshot jsonb,
    completed_by uuid,
    CONSTRAINT corrective_actions_one_owner CHECK ((num_nonnulls(owner_position, owner_person, owner_participant) <= 1)),
    CONSTRAINT corrective_actions_period_requires_incident CHECK (((operational_period_revision IS NULL) OR (incident_id IS NOT NULL))),
    CONSTRAINT corrective_actions_priority_check CHECK ((priority = ANY (ARRAY['unspecified'::text, 'low'::text, 'medium'::text, 'high'::text, 'critical'::text]))),
    CONSTRAINT corrective_actions_revision_check CHECK ((revision >= 0)),
    CONSTRAINT corrective_actions_status_check CHECK ((status = ANY (ARRAY['open'::text, 'in_progress'::text, 'complete'::text])))
);


--
-- Name: damage_assessments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.damage_assessments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    jurisdiction_id uuid NOT NULL,
    baseline_id uuid,
    address text NOT NULL,
    structure_type text NOT NULL,
    degree text NOT NULL,
    ownership text,
    insured boolean,
    estimated_loss numeric(14,2) DEFAULT 0 NOT NULL,
    source text NOT NULL,
    status text NOT NULL,
    notes text,
    geom public.geometry(Point,4326),
    reporter_contact text,
    assessed_by uuid,
    moderated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    moderated_at timestamp with time zone,
    CONSTRAINT damage_assessments_source_check CHECK ((source = ANY (ARRAY['official'::text, 'public'::text]))),
    CONSTRAINT damage_assessments_status_check CHECK ((status = ANY (ARRAY['submitted'::text, 'approved'::text, 'rejected'::text])))
);


--
-- Name: damage_baselines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.damage_baselines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    jurisdiction_id uuid NOT NULL,
    parcel_id text NOT NULL,
    address text NOT NULL,
    structure_type text NOT NULL,
    replacement_value numeric(14,2) DEFAULT 0 NOT NULL,
    geom public.geometry(Point,4326),
    imported_at timestamp with time zone DEFAULT now() NOT NULL,
    imported_by uuid NOT NULL
);


--
-- Name: damage_intake; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.damage_intake (
    jurisdiction_id uuid NOT NULL,
    token_hash text NOT NULL,
    owner_person uuid NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: dashboard_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dashboard_templates (
    key text NOT NULL,
    version integer NOT NULL,
    title text NOT NULL,
    definition jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: dashboards; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dashboards (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    jurisdiction_id uuid NOT NULL,
    template_key text NOT NULL,
    template_version integer NOT NULL,
    title text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_at timestamp with time zone
);


--
-- Name: data_pack_datasets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.data_pack_datasets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    pack_id uuid NOT NULL,
    key text NOT NULL,
    name text NOT NULL,
    kind text NOT NULL,
    url text,
    field_mapping jsonb NOT NULL,
    coverage public.geometry(Geometry,4326),
    stale_after_seconds integer DEFAULT 3600 NOT NULL,
    last_success_at timestamp with time zone,
    last_error text,
    item_count integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_received integer,
    last_rejected integer,
    CONSTRAINT data_pack_datasets_item_count_check CHECK (((item_count IS NULL) OR (item_count >= 0))),
    CONSTRAINT data_pack_datasets_key_check CHECK ((key ~ '^[a-z][a-z0-9_]*$'::text)),
    CONSTRAINT data_pack_datasets_kind_check CHECK ((kind = ANY (ARRAY['geojson'::text, 'cap'::text, 'georss'::text, 'cot'::text, 'table'::text]))),
    CONSTRAINT data_pack_datasets_last_received_check CHECK (((last_received IS NULL) OR (last_received >= 0))),
    CONSTRAINT data_pack_datasets_last_rejected_check CHECK (((last_rejected IS NULL) OR (last_rejected >= 0))),
    CONSTRAINT data_pack_datasets_name_check CHECK (((length(TRIM(BOTH FROM name)) >= 1) AND (length(TRIM(BOTH FROM name)) <= 200))),
    CONSTRAINT data_pack_datasets_stale_after_seconds_check CHECK (((stale_after_seconds >= 60) AND (stale_after_seconds <= 604800))),
    CONSTRAINT item_count_follows_success CHECK (((last_success_at IS NULL) = (item_count IS NULL)))
);


--
-- Name: data_pack_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.data_pack_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    dataset_id uuid NOT NULL,
    incident_id uuid NOT NULL,
    source_id text NOT NULL,
    data jsonb NOT NULL,
    geom public.geometry(Geometry,4326),
    first_loaded_at timestamp with time zone DEFAULT now() NOT NULL,
    last_loaded_at timestamp with time zone DEFAULT now() NOT NULL,
    loaded_by uuid NOT NULL,
    CONSTRAINT data_pack_items_source_id_check CHECK (((length(source_id) >= 1) AND (length(source_id) <= 512)))
);


--
-- Name: data_packs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.data_packs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    incident_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT data_packs_description_check CHECK (((description IS NULL) OR (length(description) <= 1000))),
    CONSTRAINT data_packs_name_check CHECK (((length(TRIM(BOTH FROM name)) >= 1) AND (length(TRIM(BOTH FROM name)) <= 200)))
);


--
-- Name: facilities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.facilities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    jurisdiction_id uuid NOT NULL,
    name text NOT NULL,
    kind text NOT NULL,
    contact text,
    geom public.geometry(Point,4326),
    stale_after_seconds integer DEFAULT 3600 NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: facility_status_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.facility_status_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    facility_id uuid NOT NULL,
    jurisdiction_id uuid NOT NULL,
    operating_status text NOT NULL,
    ems_traffic text,
    beds jsonb DEFAULT '[]'::jsonb NOT NULL,
    capabilities jsonb DEFAULT '[]'::jsonb NOT NULL,
    note text,
    reported_by uuid NOT NULL,
    reported_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: federation_outbox; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.federation_outbox (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    peer_id uuid NOT NULL,
    board_id uuid NOT NULL,
    update_data bytea NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    delivered_at timestamp with time zone
);


--
-- Name: feed_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.feed_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    feed_id uuid NOT NULL,
    external_id text NOT NULL,
    title text,
    severity text,
    geom public.geometry(Geometry,4326),
    properties jsonb DEFAULT '{}'::jsonb NOT NULL,
    track jsonb DEFAULT '[]'::jsonb NOT NULL,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: feeds; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.feeds (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    jurisdiction_id uuid NOT NULL,
    name text NOT NULL,
    kind text NOT NULL,
    url text,
    poll_interval_seconds integer,
    ingest_token_hash text,
    stale_after_seconds integer DEFAULT 900 NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    last_polled_at timestamp with time zone,
    last_success_at timestamp with time zone,
    last_error text,
    consecutive_failures integer DEFAULT 0 NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT feeds_check CHECK (((url IS NOT NULL) OR (ingest_token_hash IS NOT NULL))),
    CONSTRAINT feeds_kind_check CHECK ((kind = ANY (ARRAY['cap'::text, 'geojson'::text, 'georss'::text, 'cot'::text])))
);


--
-- Name: files; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.files (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    jurisdiction_id uuid NOT NULL,
    name text NOT NULL,
    content_type text NOT NULL,
    size bigint NOT NULL,
    sha256 text NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    supersedes uuid,
    attached_kind text DEFAULT 'none'::text NOT NULL,
    attached_id uuid,
    uploaded_by uuid NOT NULL,
    uploaded_by_position uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT files_attached_kind_check CHECK ((attached_kind = ANY (ARRAY['none'::text, 'board'::text, 'record'::text, 'incident'::text, 'library'::text])))
);


--
-- Name: form_definitions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.form_definitions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    jurisdiction_id uuid NOT NULL,
    key text NOT NULL,
    version integer NOT NULL,
    title text NOT NULL,
    board_template text,
    definition jsonb NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: guest_grants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.guest_grants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    jurisdiction_id uuid NOT NULL,
    person_id uuid NOT NULL,
    scopes text[] NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone,
    revoked_by uuid
);


--
-- Name: iaps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.iaps (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    incident_id uuid NOT NULL,
    operational_period text NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    form_ids text[] DEFAULT '{}'::text[] NOT NULL,
    content jsonb NOT NULL,
    prepared_by uuid NOT NULL,
    approved_by uuid,
    approved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    period_revision integer,
    prepared_organization_id uuid NOT NULL,
    prepared_position_id uuid,
    prepared_participation_id uuid,
    prepared_role_key text NOT NULL,
    prepared_role_label text NOT NULL,
    submitted_by uuid,
    submitted_at timestamp with time zone,
    revision_root_id uuid NOT NULL,
    revision_number integer NOT NULL,
    supersedes_iap_id uuid,
    content_revision integer NOT NULL,
    CONSTRAINT iaps_content_revision_valid CHECK ((content_revision > 0)),
    CONSTRAINT iaps_prepared_role_key_valid CHECK (((length(TRIM(BOTH FROM prepared_role_key)) >= 1) AND (length(TRIM(BOTH FROM prepared_role_key)) <= 160))),
    CONSTRAINT iaps_prepared_role_label_valid CHECK (((length(TRIM(BOTH FROM prepared_role_label)) >= 1) AND (length(TRIM(BOTH FROM prepared_role_label)) <= 160))),
    CONSTRAINT iaps_revision_number_valid CHECK ((revision_number > 0)),
    CONSTRAINT iaps_revision_shape CHECK ((((revision_number = 1) AND (revision_root_id = id) AND (supersedes_iap_id IS NULL)) OR ((revision_number > 1) AND (revision_root_id <> id) AND (supersedes_iap_id IS NOT NULL)))),
    CONSTRAINT iaps_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'in_approval'::text, 'approved'::text, 'complete'::text]))),
    CONSTRAINT iaps_submission_complete CHECK ((((submitted_by IS NULL) AND (submitted_at IS NULL)) OR ((submitted_by IS NOT NULL) AND (submitted_at IS NOT NULL) AND isfinite(submitted_at))))
);


--
-- Name: incident_area_revisions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.incident_area_revisions (
    incident_id uuid NOT NULL,
    revision integer NOT NULL,
    geometry public.geometry(Geometry,4326),
    period_label text,
    period_starts_at timestamp with time zone,
    period_ends_at timestamp with time zone,
    reason text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid NOT NULL,
    position_id uuid,
    home_organization_id uuid,
    incident_position_title text,
    participation_id uuid,
    CONSTRAINT area_valid CHECK (((geometry IS NULL) OR ((public.geometrytype(geometry) = ANY (ARRAY['POLYGON'::text, 'MULTIPOLYGON'::text])) AND (NOT public.st_isempty(geometry)) AND public.st_isvalid(geometry) AND (public.st_ndims(geometry) = 2) AND (public.st_npoints(geometry) <= 10000) AND (public.st_xmin((geometry)::public.box3d) >= ('-180'::integer)::double precision) AND (public.st_xmax((geometry)::public.box3d) <= (180)::double precision) AND (public.st_ymin((geometry)::public.box3d) >= ('-90'::integer)::double precision) AND (public.st_ymax((geometry)::public.box3d) <= (90)::double precision) AND (public.st_area(geometry) > (0)::double precision)))),
    CONSTRAINT incident_area_revisions_incident_position_title_check CHECK (((incident_position_title IS NULL) OR ((length(TRIM(BOTH FROM incident_position_title)) >= 1) AND (length(TRIM(BOTH FROM incident_position_title)) <= 120)))),
    CONSTRAINT incident_area_revisions_reason_check CHECK (((length(TRIM(BOTH FROM reason)) >= 1) AND (length(TRIM(BOTH FROM reason)) <= 1000))),
    CONSTRAINT incident_area_revisions_revision_check CHECK ((revision > 0)),
    CONSTRAINT period_valid CHECK ((((period_label IS NULL) AND (period_starts_at IS NULL) AND (period_ends_at IS NULL)) OR ((period_label IS NOT NULL) AND ((length(TRIM(BOTH FROM period_label)) >= 1) AND (length(TRIM(BOTH FROM period_label)) <= 120)) AND (period_starts_at IS NOT NULL) AND (period_ends_at IS NOT NULL) AND isfinite(period_starts_at) AND isfinite(period_ends_at) AND (period_ends_at > period_starts_at))))
);


--
-- Name: incident_boards; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.incident_boards (
    incident_id uuid NOT NULL,
    board_id uuid NOT NULL
);


--
-- Name: incident_libraries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.incident_libraries (
    incident_id uuid NOT NULL,
    library_id uuid NOT NULL
);


--
-- Name: incident_participants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.incident_participants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    incident_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    person_id uuid NOT NULL,
    incident_position_title text NOT NULL,
    role text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    reason text NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone,
    revoked_by uuid,
    revoke_reason text,
    CONSTRAINT incident_participants_expires_at_check CHECK (isfinite(expires_at)),
    CONSTRAINT incident_participants_incident_position_title_check CHECK (((length(TRIM(BOTH FROM incident_position_title)) >= 1) AND (length(TRIM(BOTH FROM incident_position_title)) <= 120))),
    CONSTRAINT incident_participants_reason_check CHECK (((length(TRIM(BOTH FROM reason)) >= 1) AND (length(TRIM(BOTH FROM reason)) <= 1000))),
    CONSTRAINT incident_participants_role_check CHECK ((role = ANY (ARRAY['viewer'::text, 'contributor'::text, 'coordinator'::text]))),
    CONSTRAINT revocation_complete CHECK ((((revoked_at IS NULL) AND (revoked_by IS NULL) AND (revoke_reason IS NULL)) OR ((revoked_at IS NOT NULL) AND (revoked_by IS NOT NULL) AND (revoke_reason IS NOT NULL) AND ((length(TRIM(BOTH FROM revoke_reason)) >= 1) AND (length(TRIM(BOTH FROM revoke_reason)) <= 1000)))))
);


--
-- Name: incident_positions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.incident_positions (
    incident_id uuid NOT NULL,
    position_id uuid NOT NULL
);


--
-- Name: incident_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.incident_templates (
    key text NOT NULL,
    title text NOT NULL,
    definition jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: incidents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.incidents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    jurisdiction_id uuid NOT NULL,
    template_key text,
    name text NOT NULL,
    kind text NOT NULL,
    collab_requested boolean DEFAULT true NOT NULL,
    activated_at timestamp with time zone DEFAULT now() NOT NULL,
    activated_by uuid NOT NULL,
    closed_at timestamp with time zone,
    closed_by uuid,
    CONSTRAINT incidents_kind_check CHECK ((kind = ANY (ARRAY['incident'::text, 'daily_ops'::text, 'planned_event'::text])))
);


--
-- Name: ipaws_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ipaws_config (
    jurisdiction_id uuid NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    environment text DEFAULT 'test'::text NOT NULL,
    cog_id text,
    endpoint_url text,
    credential_envelope text,
    credential_fingerprint text,
    moa_acknowledged boolean DEFAULT false NOT NULL,
    moa_reference text,
    moa_acknowledged_by uuid,
    moa_acknowledged_at timestamp with time zone,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ipaws_config_environment_check CHECK ((environment = ANY (ARRAY['test'::text, 'production'::text])))
);


--
-- Name: ipaws_submissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ipaws_submissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    jurisdiction_id uuid NOT NULL,
    cap_alert_id uuid,
    environment text NOT NULL,
    cog_id text,
    accepted boolean NOT NULL,
    detail text,
    submitted_by uuid NOT NULL,
    submitted_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: jurisdiction_memberships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.jurisdiction_memberships (
    person_id uuid NOT NULL,
    jurisdiction_id uuid NOT NULL,
    role text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT jurisdiction_memberships_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'member'::text, 'viewer'::text])))
);


--
-- Name: jurisdiction_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.jurisdiction_settings (
    jurisdiction_id uuid NOT NULL,
    message_retention_days integer,
    messages_in_incident_record boolean DEFAULT true NOT NULL,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: jurisdictions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.jurisdictions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: libraries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.libraries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    jurisdiction_id uuid NOT NULL,
    title text NOT NULL,
    kind text NOT NULL,
    for_template text,
    body text DEFAULT ''::text NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT libraries_kind_check CHECK ((kind = ANY (ARRAY['scenario'::text, 'plan'::text, 'reference'::text])))
);


--
-- Name: media_inquiries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.media_inquiries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    jurisdiction_id uuid NOT NULL,
    incident_id uuid,
    outlet text NOT NULL,
    subject text NOT NULL,
    question text NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    assigned_position uuid,
    response_release_id uuid,
    answered_by uuid,
    answered_at timestamp with time zone,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT media_inquiries_status_check CHECK ((status = ANY (ARRAY['open'::text, 'assigned'::text, 'answered'::text])))
);


--
-- Name: meeting_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.meeting_config (
    jurisdiction_id uuid NOT NULL,
    base_url text NOT NULL,
    app_id text,
    secret_envelope text,
    enabled boolean DEFAULT false NOT NULL,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: meetings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.meetings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    incident_id uuid NOT NULL,
    section text DEFAULT 'incident'::text NOT NULL,
    room text NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    seq bigint NOT NULL,
    thread_id uuid NOT NULL,
    client_message_id text,
    sender_person uuid NOT NULL,
    sender_position uuid,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: messages_seq_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.messages ALTER COLUMN seq ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.messages_seq_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: notification_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    jurisdiction_id uuid NOT NULL,
    board_id uuid,
    event text NOT NULL,
    condition jsonb DEFAULT '{}'::jsonb NOT NULL,
    channels jsonb NOT NULL,
    webhook_secret text,
    schedule_interval_minutes integer,
    last_fired_at timestamp with time zone,
    enabled boolean DEFAULT true NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT notification_rules_event_check CHECK ((event = ANY (ARRAY['record.created'::text, 'record.updated'::text, 'scheduled'::text])))
);


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    jurisdiction_id uuid NOT NULL,
    rule_id uuid,
    person_id uuid,
    position_id uuid,
    channel text NOT NULL,
    title text NOT NULL,
    body text DEFAULT ''::text NOT NULL,
    status text NOT NULL,
    detail jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    read_at timestamp with time zone,
    acknowledged_at timestamp with time zone,
    acknowledged_by uuid,
    CONSTRAINT notifications_status_check CHECK ((status = ANY (ARRAY['delivered'::text, 'failed'::text])))
);


--
-- Name: operational_assessment_decisions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.operational_assessment_decisions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    incident_id uuid NOT NULL,
    jurisdiction_id uuid NOT NULL,
    domain text NOT NULL,
    framework text NOT NULL,
    definition_key text NOT NULL,
    selected_assessment_id uuid NOT NULL,
    rationale text NOT NULL,
    created_by uuid NOT NULL,
    position_id uuid,
    position_title text,
    participation_id uuid,
    home_organization_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT operational_assessment_decisions_domain_check CHECK ((domain = ANY (ARRAY['lifeline'::text, 'esf'::text]))),
    CONSTRAINT operational_assessment_decisions_rationale_check CHECK (((length(TRIM(BOTH FROM rationale)) >= 1) AND (length(TRIM(BOTH FROM rationale)) <= 4000)))
);


--
-- Name: operational_assessments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.operational_assessments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    domain text NOT NULL,
    jurisdiction_id uuid NOT NULL,
    incident_id uuid,
    framework text NOT NULL,
    definition_key text NOT NULL,
    definition_version integer NOT NULL,
    condition text,
    activation text,
    capacity text,
    legacy_status text,
    payload jsonb NOT NULL,
    assessed_at timestamp with time zone NOT NULL,
    source_kind text NOT NULL,
    supersedes_id uuid,
    legacy_board_id uuid,
    legacy_record_id uuid,
    created_by uuid NOT NULL,
    position_id uuid,
    position_title text,
    participation_id uuid,
    home_organization_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT operational_assessments_activation_check CHECK ((activation = ANY (ARRAY['unknown'::text, 'not_activated'::text, 'activated'::text, 'demobilizing'::text, 'demobilized'::text]))),
    CONSTRAINT operational_assessments_assessed_at_check CHECK (isfinite(assessed_at)),
    CONSTRAINT operational_assessments_capacity_check CHECK ((capacity = ANY (ARRAY['unknown'::text, 'adequate'::text, 'constrained'::text, 'critical'::text]))),
    CONSTRAINT operational_assessments_check CHECK ((((domain = 'lifeline'::text) AND (framework = 'fema_community_lifelines'::text) AND (condition IS NOT NULL) AND (activation IS NULL) AND (capacity IS NULL)) OR ((domain = 'esf'::text) AND (framework = ANY (ARRAY['federal'::text, 'california'::text])) AND (condition IS NULL) AND (activation IS NOT NULL) AND (capacity IS NOT NULL)))),
    CONSTRAINT operational_assessments_check1 CHECK ((((source_kind = 'native'::text) AND (legacy_board_id IS NULL) AND (legacy_record_id IS NULL)) OR ((source_kind = 'legacy_board'::text) AND (legacy_board_id IS NOT NULL) AND (legacy_record_id IS NOT NULL)))),
    CONSTRAINT operational_assessments_condition_check CHECK ((condition = ANY (ARRAY['stable'::text, 'stabilizing'::text, 'unstable'::text, 'unknown'::text]))),
    CONSTRAINT operational_assessments_definition_version_check CHECK ((definition_version > 0)),
    CONSTRAINT operational_assessments_domain_check CHECK ((domain = ANY (ARRAY['lifeline'::text, 'esf'::text]))),
    CONSTRAINT operational_assessments_position_title_check CHECK (((position_title IS NULL) OR ((length(TRIM(BOTH FROM position_title)) >= 1) AND (length(TRIM(BOTH FROM position_title)) <= 120)))),
    CONSTRAINT operational_assessments_source_kind_check CHECK ((source_kind = ANY (ARRAY['native'::text, 'legacy_board'::text])))
);


--
-- Name: operational_relationships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.operational_relationships (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    incident_id uuid NOT NULL,
    source_domain text NOT NULL,
    source_framework text NOT NULL,
    source_definition_key text NOT NULL,
    target_kind text NOT NULL,
    target_id uuid,
    target_dataset_id uuid,
    target_feature_id text,
    target_iap_id uuid,
    target_iap_content_revision integer,
    target_objective_index integer,
    target_iap_objective_label text,
    target_iap_operational_period text,
    created_by uuid NOT NULL,
    organization_id uuid NOT NULL,
    position_id uuid,
    position_title text,
    participation_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT operational_relationships_check CHECK ((((target_kind = ANY (ARRAY['task'::text, 'resource_request'::text, 'board_record'::text])) AND (target_id IS NOT NULL) AND (target_dataset_id IS NULL) AND (target_feature_id IS NULL) AND (target_iap_id IS NULL) AND (target_iap_content_revision IS NULL) AND (target_objective_index IS NULL) AND (target_iap_objective_label IS NULL) AND (target_iap_operational_period IS NULL)) OR ((target_kind = 'map_feature'::text) AND (target_id IS NULL) AND (target_dataset_id IS NOT NULL) AND (target_feature_id IS NOT NULL) AND (target_iap_id IS NULL) AND (target_iap_content_revision IS NULL) AND (target_objective_index IS NULL) AND (target_iap_objective_label IS NULL) AND (target_iap_operational_period IS NULL)) OR ((target_kind = 'iap_objective'::text) AND (target_id IS NULL) AND (target_dataset_id IS NULL) AND (target_feature_id IS NULL) AND (target_iap_id IS NOT NULL) AND (target_iap_content_revision IS NOT NULL) AND (target_objective_index IS NOT NULL) AND (NULLIF(btrim(target_iap_objective_label), ''::text) IS NOT NULL) AND (NULLIF(btrim(target_iap_operational_period), ''::text) IS NOT NULL)))),
    CONSTRAINT operational_relationships_source_domain_check CHECK ((source_domain = ANY (ARRAY['lifeline'::text, 'esf'::text]))),
    CONSTRAINT operational_relationships_target_kind_check CHECK ((target_kind = ANY (ARRAY['task'::text, 'resource_request'::text, 'board_record'::text, 'map_feature'::text, 'iap_objective'::text])))
);


--
-- Name: peers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.peers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    jurisdiction_id uuid NOT NULL,
    name text NOT NULL,
    token_hash text NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: person_identities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.person_identities (
    person_id uuid NOT NULL,
    issuer text NOT NULL,
    subject text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: persons; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.persons (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    display_name text NOT NULL,
    password_hash text NOT NULL,
    disabled boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    is_instance_admin boolean DEFAULT false NOT NULL
);


--
-- Name: position_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.position_assignments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    position_id uuid NOT NULL,
    person_id uuid NOT NULL,
    assigned_by uuid NOT NULL,
    assigned_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone,
    revoked_by uuid
);


--
-- Name: position_signins; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.position_signins (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    person_id uuid NOT NULL,
    position_id uuid NOT NULL,
    signed_in_at timestamp with time zone DEFAULT now() NOT NULL,
    signed_out_at timestamp with time zone
);


--
-- Name: positions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.positions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    jurisdiction_id uuid NOT NULL,
    key text NOT NULL,
    title text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: press_release_approvals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.press_release_approvals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    release_id uuid NOT NULL,
    agency text NOT NULL,
    decision text NOT NULL,
    note text,
    decided_by_person uuid,
    decided_by_peer text,
    decided_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT press_release_approvals_decision_check CHECK ((decision = ANY (ARRAY['approve'::text, 'reject'::text])))
);


--
-- Name: press_release_publications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.press_release_publications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    release_id uuid NOT NULL,
    channel text NOT NULL,
    ref text,
    published_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: press_releases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.press_releases (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    jurisdiction_id uuid NOT NULL,
    incident_id uuid,
    title text NOT NULL,
    body text NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    required_agencies text[] DEFAULT '{}'::text[] NOT NULL,
    cap_alert_id uuid,
    created_by uuid NOT NULL,
    created_by_position uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    submitted_at timestamp with time zone,
    approved_at timestamp with time zone,
    published_at timestamp with time zone,
    CONSTRAINT press_releases_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'pending'::text, 'approved'::text, 'published'::text, 'rejected'::text])))
);


--
-- Name: public_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.public_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    jurisdiction_id uuid NOT NULL,
    release_id uuid,
    title text NOT NULL,
    body text NOT NULL,
    published_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: resource_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.resource_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    jurisdiction_id uuid NOT NULL,
    incident_id uuid,
    origin text NOT NULL,
    item text NOT NULL,
    quantity integer DEFAULT 1 NOT NULL,
    priority text DEFAULT 'routine'::text NOT NULL,
    state text DEFAULT 'submitted'::text NOT NULL,
    needed_by timestamp with time zone,
    notes text,
    requested_by uuid NOT NULL,
    assigned_position uuid,
    source_peer text,
    source_request_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    receiving_organization_id uuid,
    supplying_organization_id uuid,
    assigned_participant_id uuid,
    CONSTRAINT resource_requests_origin_check CHECK ((origin = ANY (ARRAY['field'::text, 'eoc'::text, 'escalated'::text])))
);


--
-- Name: rr_costs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rr_costs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    request_id uuid NOT NULL,
    category text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    amount_cents integer NOT NULL,
    incurred_at date DEFAULT CURRENT_DATE NOT NULL,
    recorded_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: rr_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rr_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    request_id uuid NOT NULL,
    from_state text,
    to_state text NOT NULL,
    note text,
    actor_person uuid,
    actor_peer text,
    at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: saved_states; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.saved_states (
    person_id uuid NOT NULL,
    incident_id uuid NOT NULL,
    kind text NOT NULL,
    state_key text NOT NULL,
    schema_version integer NOT NULL,
    revision integer DEFAULT 1 NOT NULL,
    payload json NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT saved_states_kind_check CHECK ((kind = ANY (ARRAY['workspace_preferences'::text, 'workspace_layout'::text, 'table_view'::text, 'dashboard_config'::text]))),
    CONSTRAINT saved_states_payload_check CHECK (((json_typeof(payload) = 'object'::text) AND (octet_length((payload)::text) <= 65536))),
    CONSTRAINT saved_states_revision_check CHECK (((revision >= 1) AND (revision <= 2147483647))),
    CONSTRAINT saved_states_schema_version_check CHECK (((schema_version >= 1) AND (schema_version <= 2147483647))),
    CONSTRAINT saved_states_state_key_check CHECK (((length(state_key) >= 1) AND (length(state_key) <= 128) AND (state_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'::text)))
);


--
-- Name: sharing_agreements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sharing_agreements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    peer_id uuid NOT NULL,
    board_id uuid NOT NULL,
    can_read boolean DEFAULT true NOT NULL,
    can_write boolean DEFAULT false NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: shifts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shifts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    jurisdiction_id uuid NOT NULL,
    incident_id uuid,
    position_id uuid NOT NULL,
    person_id uuid,
    starts_at timestamp with time zone NOT NULL,
    ends_at timestamp with time zone NOT NULL,
    note text,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT shifts_check CHECK ((ends_at > starts_at))
);


--
-- Name: sitreps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sitreps (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    jurisdiction_id uuid NOT NULL,
    incident_id uuid,
    period text NOT NULL,
    content jsonb NOT NULL,
    composed_by uuid NOT NULL,
    composed_by_position uuid,
    composed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: staff_checkins; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.staff_checkins (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    jurisdiction_id uuid NOT NULL,
    incident_id uuid,
    person_id uuid NOT NULL,
    position_id uuid NOT NULL,
    method text NOT NULL,
    client_checkin_id text,
    checked_in_at timestamp with time zone DEFAULT now() NOT NULL,
    checked_out_at timestamp with time zone,
    checked_in_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT staff_checkins_method_check CHECK ((method = ANY (ARRAY['manual'::text, 'scan'::text])))
);


--
-- Name: status_queries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.status_queries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    jurisdiction_id uuid NOT NULL,
    incident_id uuid,
    prompt text NOT NULL,
    target_kind text,
    due_at timestamp with time zone,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: status_query_targets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.status_query_targets (
    query_id uuid NOT NULL,
    facility_id uuid NOT NULL,
    responded_report uuid,
    responded_at timestamp with time zone
);


--
-- Name: sync_conflicts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sync_conflicts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    board_id uuid NOT NULL,
    record_id uuid NOT NULL,
    reason text NOT NULL,
    rejected_data jsonb NOT NULL,
    origin_person uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone,
    resolved_by uuid,
    incident_id uuid
);


--
-- Name: sync_updates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sync_updates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    seq bigint NOT NULL,
    board_id uuid NOT NULL,
    update_data bytea NOT NULL,
    origin_person uuid NOT NULL,
    origin_position uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    incident_id uuid,
    operation_id uuid,
    request_digest text,
    conflicts integer,
    CONSTRAINT sync_update_receipt_shape CHECK ((((incident_id IS NULL) AND (operation_id IS NULL) AND (request_digest IS NULL) AND (conflicts IS NULL)) OR ((incident_id IS NOT NULL) AND (operation_id IS NOT NULL) AND (request_digest IS NOT NULL) AND (conflicts IS NOT NULL)))),
    CONSTRAINT sync_updates_conflicts_check CHECK (((conflicts IS NULL) OR (conflicts >= 0))),
    CONSTRAINT sync_updates_request_digest_check CHECK (((request_digest IS NULL) OR (length(request_digest) = 64)))
);


--
-- Name: sync_updates_seq_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.sync_updates ALTER COLUMN seq ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.sync_updates_seq_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: thread_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.thread_members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    thread_id uuid NOT NULL,
    member_kind text NOT NULL,
    person_id uuid,
    position_id uuid,
    added_by uuid NOT NULL,
    added_at timestamp with time zone DEFAULT now() NOT NULL,
    removed_at timestamp with time zone,
    CONSTRAINT thread_members_check CHECK (((member_kind = 'person'::text) = (person_id IS NOT NULL))),
    CONSTRAINT thread_members_check1 CHECK (((member_kind = 'position'::text) = (position_id IS NOT NULL))),
    CONSTRAINT thread_members_member_kind_check CHECK ((member_kind = ANY (ARRAY['person'::text, 'position'::text])))
);


--
-- Name: threads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.threads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    jurisdiction_id uuid NOT NULL,
    kind text NOT NULL,
    incident_id uuid,
    title text DEFAULT ''::text NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT threads_kind_check CHECK ((kind = ANY (ARRAY['direct'::text, 'group'::text])))
);


--
-- Name: tracked_objects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tracked_objects (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    jurisdiction_id uuid NOT NULL,
    tag text NOT NULL,
    kind text NOT NULL,
    label text NOT NULL,
    restricted jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: tracking_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tracking_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    object_id uuid NOT NULL,
    jurisdiction_id uuid NOT NULL,
    custody_state text NOT NULL,
    station text,
    agency text,
    location text,
    geom public.geometry(Point,4326),
    note text,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    recorded_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: aar_observations aar_observations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aar_observations
    ADD CONSTRAINT aar_observations_pkey PRIMARY KEY (id);


--
-- Name: aars aars_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aars
    ADD CONSTRAINT aars_pkey PRIMARY KEY (id);


--
-- Name: audit_events audit_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_events
    ADD CONSTRAINT audit_events_pkey PRIMARY KEY (id);


--
-- Name: auth_sessions auth_sessions_access_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_sessions
    ADD CONSTRAINT auth_sessions_access_hash_key UNIQUE (access_hash);


--
-- Name: auth_sessions auth_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_sessions
    ADD CONSTRAINT auth_sessions_pkey PRIMARY KEY (id);


--
-- Name: auth_sessions auth_sessions_resume_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_sessions
    ADD CONSTRAINT auth_sessions_resume_hash_key UNIQUE (resume_hash);


--
-- Name: badges badges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.badges
    ADD CONSTRAINT badges_pkey PRIMARY KEY (id);


--
-- Name: badges badges_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.badges
    ADD CONSTRAINT badges_token_hash_key UNIQUE (token_hash);


--
-- Name: board_records board_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.board_records
    ADD CONSTRAINT board_records_pkey PRIMARY KEY (id);


--
-- Name: board_templates board_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.board_templates
    ADD CONSTRAINT board_templates_pkey PRIMARY KEY (key, version);


--
-- Name: board_workflow_approvals board_workflow_approvals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.board_workflow_approvals
    ADD CONSTRAINT board_workflow_approvals_pkey PRIMARY KEY (id);


--
-- Name: board_workflow_approvals board_workflow_approvals_record_id_state_revision_rule_key__key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.board_workflow_approvals
    ADD CONSTRAINT board_workflow_approvals_record_id_state_revision_rule_key__key UNIQUE (record_id, state_revision, rule_key, actor_person_id);


--
-- Name: board_workflow_history board_workflow_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.board_workflow_history
    ADD CONSTRAINT board_workflow_history_pkey PRIMARY KEY (id);


--
-- Name: board_workflow_history board_workflow_history_sequence_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.board_workflow_history
    ADD CONSTRAINT board_workflow_history_sequence_key UNIQUE (sequence);


--
-- Name: board_workflow_idempotency board_workflow_idempotency_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.board_workflow_idempotency
    ADD CONSTRAINT board_workflow_idempotency_pkey PRIMARY KEY (record_id, actor_person_id, idempotency_key);


--
-- Name: board_workflow_instances board_workflow_instances_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.board_workflow_instances
    ADD CONSTRAINT board_workflow_instances_pkey PRIMARY KEY (record_id);


--
-- Name: boards boards_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.boards
    ADD CONSTRAINT boards_pkey PRIMARY KEY (id);


--
-- Name: briefings briefings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.briefings
    ADD CONSTRAINT briefings_pkey PRIMARY KEY (id);


--
-- Name: cap_alert_reviews cap_alert_reviews_alert_id_revision_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cap_alert_reviews
    ADD CONSTRAINT cap_alert_reviews_alert_id_revision_key UNIQUE (alert_id, revision);


--
-- Name: cap_alert_reviews cap_alert_reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cap_alert_reviews
    ADD CONSTRAINT cap_alert_reviews_pkey PRIMARY KEY (id);


--
-- Name: cap_alerts cap_alerts_jurisdiction_id_identifier_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cap_alerts
    ADD CONSTRAINT cap_alerts_jurisdiction_id_identifier_key UNIQUE (jurisdiction_id, identifier);


--
-- Name: cap_alerts cap_alerts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cap_alerts
    ADD CONSTRAINT cap_alerts_pkey PRIMARY KEY (id);


--
-- Name: checklist_completion_operations checklist_completion_operations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checklist_completion_operations
    ADD CONSTRAINT checklist_completion_operations_pkey PRIMARY KEY (operation_id);


--
-- Name: checklist_items checklist_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checklist_items
    ADD CONSTRAINT checklist_items_pkey PRIMARY KEY (id);


--
-- Name: checklist_task_dependencies checklist_task_dependencies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checklist_task_dependencies
    ADD CONSTRAINT checklist_task_dependencies_pkey PRIMARY KEY (task_id, prerequisite_task_id);


--
-- Name: collab_backends collab_backends_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.collab_backends
    ADD CONSTRAINT collab_backends_pkey PRIMARY KEY (jurisdiction_id);


--
-- Name: collab_channel_members collab_channel_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.collab_channel_members
    ADD CONSTRAINT collab_channel_members_pkey PRIMARY KEY (channel_id, person_id);


--
-- Name: collab_channels collab_channels_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.collab_channels
    ADD CONSTRAINT collab_channels_pkey PRIMARY KEY (id);


--
-- Name: collab_channels collab_channels_space_id_section_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.collab_channels
    ADD CONSTRAINT collab_channels_space_id_section_key UNIQUE (space_id, section);


--
-- Name: collab_spaces collab_spaces_incident_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.collab_spaces
    ADD CONSTRAINT collab_spaces_incident_id_key UNIQUE (incident_id);


--
-- Name: collab_spaces collab_spaces_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.collab_spaces
    ADD CONSTRAINT collab_spaces_pkey PRIMARY KEY (id);


--
-- Name: corrective_actions corrective_actions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.corrective_actions
    ADD CONSTRAINT corrective_actions_pkey PRIMARY KEY (id);


--
-- Name: damage_assessments damage_assessments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.damage_assessments
    ADD CONSTRAINT damage_assessments_pkey PRIMARY KEY (id);


--
-- Name: damage_baselines damage_baselines_jurisdiction_id_parcel_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.damage_baselines
    ADD CONSTRAINT damage_baselines_jurisdiction_id_parcel_id_key UNIQUE (jurisdiction_id, parcel_id);


--
-- Name: damage_baselines damage_baselines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.damage_baselines
    ADD CONSTRAINT damage_baselines_pkey PRIMARY KEY (id);


--
-- Name: damage_intake damage_intake_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.damage_intake
    ADD CONSTRAINT damage_intake_pkey PRIMARY KEY (jurisdiction_id);


--
-- Name: dashboard_templates dashboard_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboard_templates
    ADD CONSTRAINT dashboard_templates_pkey PRIMARY KEY (key, version);


--
-- Name: dashboards dashboards_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboards
    ADD CONSTRAINT dashboards_pkey PRIMARY KEY (id);


--
-- Name: data_pack_datasets data_pack_datasets_pack_id_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.data_pack_datasets
    ADD CONSTRAINT data_pack_datasets_pack_id_key_key UNIQUE (pack_id, key);


--
-- Name: data_pack_datasets data_pack_datasets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.data_pack_datasets
    ADD CONSTRAINT data_pack_datasets_pkey PRIMARY KEY (id);


--
-- Name: data_pack_items data_pack_items_dataset_id_source_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.data_pack_items
    ADD CONSTRAINT data_pack_items_dataset_id_source_id_key UNIQUE (dataset_id, source_id);


--
-- Name: data_pack_items data_pack_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.data_pack_items
    ADD CONSTRAINT data_pack_items_pkey PRIMARY KEY (id);


--
-- Name: data_packs data_packs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.data_packs
    ADD CONSTRAINT data_packs_pkey PRIMARY KEY (id);


--
-- Name: facilities facilities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.facilities
    ADD CONSTRAINT facilities_pkey PRIMARY KEY (id);


--
-- Name: facility_status_reports facility_status_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.facility_status_reports
    ADD CONSTRAINT facility_status_reports_pkey PRIMARY KEY (id);


--
-- Name: federation_outbox federation_outbox_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.federation_outbox
    ADD CONSTRAINT federation_outbox_pkey PRIMARY KEY (id);


--
-- Name: feed_items feed_items_feed_id_external_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feed_items
    ADD CONSTRAINT feed_items_feed_id_external_id_key UNIQUE (feed_id, external_id);


--
-- Name: feed_items feed_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feed_items
    ADD CONSTRAINT feed_items_pkey PRIMARY KEY (id);


--
-- Name: feeds feeds_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feeds
    ADD CONSTRAINT feeds_pkey PRIMARY KEY (id);


--
-- Name: files files_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.files
    ADD CONSTRAINT files_pkey PRIMARY KEY (id);


--
-- Name: form_definitions form_definitions_jurisdiction_id_key_version_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.form_definitions
    ADD CONSTRAINT form_definitions_jurisdiction_id_key_version_key UNIQUE (jurisdiction_id, key, version);


--
-- Name: form_definitions form_definitions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.form_definitions
    ADD CONSTRAINT form_definitions_pkey PRIMARY KEY (id);


--
-- Name: guest_grants guest_grants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guest_grants
    ADD CONSTRAINT guest_grants_pkey PRIMARY KEY (id);


--
-- Name: iaps iaps_one_successor; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.iaps
    ADD CONSTRAINT iaps_one_successor UNIQUE (supersedes_iap_id);


--
-- Name: iaps iaps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.iaps
    ADD CONSTRAINT iaps_pkey PRIMARY KEY (id);


--
-- Name: iaps iaps_revision_identity; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.iaps
    ADD CONSTRAINT iaps_revision_identity UNIQUE (revision_root_id, revision_number);


--
-- Name: incident_area_revisions incident_area_revisions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incident_area_revisions
    ADD CONSTRAINT incident_area_revisions_pkey PRIMARY KEY (incident_id, revision);


--
-- Name: incident_boards incident_boards_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incident_boards
    ADD CONSTRAINT incident_boards_pkey PRIMARY KEY (incident_id, board_id);


--
-- Name: incident_libraries incident_libraries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incident_libraries
    ADD CONSTRAINT incident_libraries_pkey PRIMARY KEY (incident_id, library_id);


--
-- Name: incident_participants incident_participants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incident_participants
    ADD CONSTRAINT incident_participants_pkey PRIMARY KEY (id);


--
-- Name: incident_positions incident_positions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incident_positions
    ADD CONSTRAINT incident_positions_pkey PRIMARY KEY (incident_id, position_id);


--
-- Name: incident_templates incident_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incident_templates
    ADD CONSTRAINT incident_templates_pkey PRIMARY KEY (key);


--
-- Name: incidents incidents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incidents
    ADD CONSTRAINT incidents_pkey PRIMARY KEY (id);


--
-- Name: ipaws_config ipaws_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ipaws_config
    ADD CONSTRAINT ipaws_config_pkey PRIMARY KEY (jurisdiction_id);


--
-- Name: ipaws_submissions ipaws_submissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ipaws_submissions
    ADD CONSTRAINT ipaws_submissions_pkey PRIMARY KEY (id);


--
-- Name: jurisdiction_memberships jurisdiction_memberships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jurisdiction_memberships
    ADD CONSTRAINT jurisdiction_memberships_pkey PRIMARY KEY (person_id, jurisdiction_id);


--
-- Name: jurisdiction_settings jurisdiction_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jurisdiction_settings
    ADD CONSTRAINT jurisdiction_settings_pkey PRIMARY KEY (jurisdiction_id);


--
-- Name: jurisdictions jurisdictions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jurisdictions
    ADD CONSTRAINT jurisdictions_pkey PRIMARY KEY (id);


--
-- Name: jurisdictions jurisdictions_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jurisdictions
    ADD CONSTRAINT jurisdictions_slug_key UNIQUE (slug);


--
-- Name: libraries libraries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.libraries
    ADD CONSTRAINT libraries_pkey PRIMARY KEY (id);


--
-- Name: media_inquiries media_inquiries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media_inquiries
    ADD CONSTRAINT media_inquiries_pkey PRIMARY KEY (id);


--
-- Name: meeting_config meeting_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting_config
    ADD CONSTRAINT meeting_config_pkey PRIMARY KEY (jurisdiction_id);


--
-- Name: meetings meetings_incident_id_section_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meetings
    ADD CONSTRAINT meetings_incident_id_section_key UNIQUE (incident_id, section);


--
-- Name: meetings meetings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meetings
    ADD CONSTRAINT meetings_pkey PRIMARY KEY (id);


--
-- Name: messages messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id);


--
-- Name: notification_rules notification_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_rules
    ADD CONSTRAINT notification_rules_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: operational_assessment_decisions operational_assessment_decisions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operational_assessment_decisions
    ADD CONSTRAINT operational_assessment_decisions_pkey PRIMARY KEY (id);


--
-- Name: operational_assessments operational_assessments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operational_assessments
    ADD CONSTRAINT operational_assessments_pkey PRIMARY KEY (id);


--
-- Name: operational_relationships operational_relationships_incident_id_source_domain_source__key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operational_relationships
    ADD CONSTRAINT operational_relationships_incident_id_source_domain_source__key UNIQUE (incident_id, source_domain, source_framework, source_definition_key, target_kind, target_id, target_dataset_id, target_feature_id, target_iap_id, target_iap_content_revision, target_objective_index);


--
-- Name: operational_relationships operational_relationships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operational_relationships
    ADD CONSTRAINT operational_relationships_pkey PRIMARY KEY (id);


--
-- Name: peers peers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.peers
    ADD CONSTRAINT peers_pkey PRIMARY KEY (id);


--
-- Name: peers peers_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.peers
    ADD CONSTRAINT peers_token_hash_key UNIQUE (token_hash);


--
-- Name: person_identities person_identities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.person_identities
    ADD CONSTRAINT person_identities_pkey PRIMARY KEY (issuer, subject);


--
-- Name: persons persons_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.persons
    ADD CONSTRAINT persons_pkey PRIMARY KEY (id);


--
-- Name: position_assignments position_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.position_assignments
    ADD CONSTRAINT position_assignments_pkey PRIMARY KEY (id);


--
-- Name: position_signins position_signins_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.position_signins
    ADD CONSTRAINT position_signins_pkey PRIMARY KEY (id);


--
-- Name: positions positions_jurisdiction_id_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.positions
    ADD CONSTRAINT positions_jurisdiction_id_key_key UNIQUE (jurisdiction_id, key);


--
-- Name: positions positions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.positions
    ADD CONSTRAINT positions_pkey PRIMARY KEY (id);


--
-- Name: press_release_approvals press_release_approvals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.press_release_approvals
    ADD CONSTRAINT press_release_approvals_pkey PRIMARY KEY (id);


--
-- Name: press_release_approvals press_release_approvals_release_id_agency_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.press_release_approvals
    ADD CONSTRAINT press_release_approvals_release_id_agency_key UNIQUE (release_id, agency);


--
-- Name: press_release_publications press_release_publications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.press_release_publications
    ADD CONSTRAINT press_release_publications_pkey PRIMARY KEY (id);


--
-- Name: press_releases press_releases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.press_releases
    ADD CONSTRAINT press_releases_pkey PRIMARY KEY (id);


--
-- Name: public_messages public_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.public_messages
    ADD CONSTRAINT public_messages_pkey PRIMARY KEY (id);


--
-- Name: resource_requests resource_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resource_requests
    ADD CONSTRAINT resource_requests_pkey PRIMARY KEY (id);


--
-- Name: rr_costs rr_costs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rr_costs
    ADD CONSTRAINT rr_costs_pkey PRIMARY KEY (id);


--
-- Name: rr_events rr_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rr_events
    ADD CONSTRAINT rr_events_pkey PRIMARY KEY (id);


--
-- Name: saved_states saved_states_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saved_states
    ADD CONSTRAINT saved_states_pkey PRIMARY KEY (person_id, incident_id, kind, state_key);


--
-- Name: sharing_agreements sharing_agreements_peer_id_board_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sharing_agreements
    ADD CONSTRAINT sharing_agreements_peer_id_board_id_key UNIQUE (peer_id, board_id);


--
-- Name: sharing_agreements sharing_agreements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sharing_agreements
    ADD CONSTRAINT sharing_agreements_pkey PRIMARY KEY (id);


--
-- Name: shifts shifts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shifts
    ADD CONSTRAINT shifts_pkey PRIMARY KEY (id);


--
-- Name: sitreps sitreps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sitreps
    ADD CONSTRAINT sitreps_pkey PRIMARY KEY (id);


--
-- Name: staff_checkins staff_checkins_jurisdiction_id_client_checkin_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_checkins
    ADD CONSTRAINT staff_checkins_jurisdiction_id_client_checkin_id_key UNIQUE (jurisdiction_id, client_checkin_id);


--
-- Name: staff_checkins staff_checkins_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_checkins
    ADD CONSTRAINT staff_checkins_pkey PRIMARY KEY (id);


--
-- Name: status_queries status_queries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.status_queries
    ADD CONSTRAINT status_queries_pkey PRIMARY KEY (id);


--
-- Name: status_query_targets status_query_targets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.status_query_targets
    ADD CONSTRAINT status_query_targets_pkey PRIMARY KEY (query_id, facility_id);


--
-- Name: sync_conflicts sync_conflicts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sync_conflicts
    ADD CONSTRAINT sync_conflicts_pkey PRIMARY KEY (id);


--
-- Name: sync_updates sync_updates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sync_updates
    ADD CONSTRAINT sync_updates_pkey PRIMARY KEY (id);


--
-- Name: thread_members thread_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.thread_members
    ADD CONSTRAINT thread_members_pkey PRIMARY KEY (id);


--
-- Name: threads threads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.threads
    ADD CONSTRAINT threads_pkey PRIMARY KEY (id);


--
-- Name: tracked_objects tracked_objects_jurisdiction_id_tag_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tracked_objects
    ADD CONSTRAINT tracked_objects_jurisdiction_id_tag_key UNIQUE (jurisdiction_id, tag);


--
-- Name: tracked_objects tracked_objects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tracked_objects
    ADD CONSTRAINT tracked_objects_pkey PRIMARY KEY (id);


--
-- Name: tracking_events tracking_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tracking_events
    ADD CONSTRAINT tracking_events_pkey PRIMARY KEY (id);


--
-- Name: aar_observations_incident; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aar_observations_incident ON public.aar_observations USING btree (incident_id);


--
-- Name: aar_observations_period; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aar_observations_period ON public.aar_observations USING btree (incident_id, operational_period_revision, created_at, id);


--
-- Name: aars_incident; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX aars_incident ON public.aars USING btree (incident_id, created_at DESC);


--
-- Name: audit_events_fts; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_events_fts ON public.audit_events USING gin (to_tsvector('english'::regconfig, ((category || ' '::text) || (payload)::text)));


--
-- Name: audit_events_jurisdiction_seq; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_events_jurisdiction_seq ON public.audit_events USING btree (jurisdiction_id, seq);


--
-- Name: audit_events_position; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_events_position ON public.audit_events USING btree (position_id) WHERE (position_id IS NOT NULL);


--
-- Name: badges_jurisdiction; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX badges_jurisdiction ON public.badges USING btree (jurisdiction_id);


--
-- Name: board_records_board; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX board_records_board ON public.board_records USING btree (board_id, created_at DESC);


--
-- Name: board_records_fts; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX board_records_fts ON public.board_records USING gin (to_tsvector('english'::regconfig, (data)::text));


--
-- Name: board_records_geom; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX board_records_geom ON public.board_records USING gist (geom) WHERE (geom IS NOT NULL);


--
-- Name: board_records_incident; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX board_records_incident ON public.board_records USING btree (incident_id) WHERE (incident_id IS NOT NULL);


--
-- Name: board_workflow_completion_once; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX board_workflow_completion_once ON public.board_workflow_history USING btree (record_id, state_revision, event_kind) WHERE (event_kind = 'transition_completed'::text);


--
-- Name: board_workflow_escalation_once; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX board_workflow_escalation_once ON public.board_workflow_history USING btree (record_id, state_revision, event_kind, event_key) WHERE (event_kind = 'escalation'::text);


--
-- Name: board_workflow_history_record; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX board_workflow_history_record ON public.board_workflow_history USING btree (record_id, created_at, id);


--
-- Name: board_workflow_instances_board; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX board_workflow_instances_board ON public.board_workflow_instances USING btree (board_id, state_key);


--
-- Name: board_workflow_instances_incident; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX board_workflow_instances_incident ON public.board_workflow_instances USING btree (incident_id) WHERE (incident_id IS NOT NULL);


--
-- Name: briefings_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX briefings_due ON public.briefings USING btree (scheduled_at) WHERE (notified_at IS NULL);


--
-- Name: cap_alert_reviews_latest; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cap_alert_reviews_latest ON public.cap_alert_reviews USING btree (alert_id, revision DESC);


--
-- Name: cap_alerts_jurisdiction; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cap_alerts_jurisdiction ON public.cap_alerts USING btree (jurisdiction_id, created_at DESC);


--
-- Name: checklist_completion_operations_task; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX checklist_completion_operations_task ON public.checklist_completion_operations USING btree (task_id, actor_person_id);


--
-- Name: checklist_items_filters; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX checklist_items_filters ON public.checklist_items USING btree (incident_id, status, category, due_at);


--
-- Name: checklist_items_incident; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX checklist_items_incident ON public.checklist_items USING btree (incident_id, position_id);


--
-- Name: checklist_items_participant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX checklist_items_participant ON public.checklist_items USING btree (assigned_participant_id) WHERE (assigned_participant_id IS NOT NULL);


--
-- Name: corrective_actions_assigned_participant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX corrective_actions_assigned_participant ON public.corrective_actions USING btree (owner_participant) WHERE (owner_participant IS NOT NULL);


--
-- Name: corrective_actions_incident_period; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX corrective_actions_incident_period ON public.corrective_actions USING btree (incident_id, operational_period_revision, created_at, id) WHERE (incident_id IS NOT NULL);


--
-- Name: corrective_actions_jurisdiction; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX corrective_actions_jurisdiction ON public.corrective_actions USING btree (jurisdiction_id, status);


--
-- Name: damage_assessments_jurisdiction; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX damage_assessments_jurisdiction ON public.damage_assessments USING btree (jurisdiction_id, status);


--
-- Name: damage_baselines_jurisdiction; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX damage_baselines_jurisdiction ON public.damage_baselines USING btree (jurisdiction_id);


--
-- Name: data_pack_datasets_coverage; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX data_pack_datasets_coverage ON public.data_pack_datasets USING gist (coverage) WHERE (coverage IS NOT NULL);


--
-- Name: data_pack_datasets_pack; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX data_pack_datasets_pack ON public.data_pack_datasets USING btree (pack_id);


--
-- Name: data_pack_items_dataset; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX data_pack_items_dataset ON public.data_pack_items USING btree (dataset_id);


--
-- Name: data_pack_items_geom; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX data_pack_items_geom ON public.data_pack_items USING gist (geom) WHERE (geom IS NOT NULL);


--
-- Name: data_pack_items_incident; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX data_pack_items_incident ON public.data_pack_items USING btree (incident_id);


--
-- Name: data_packs_incident; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX data_packs_incident ON public.data_packs USING btree (incident_id);


--
-- Name: facilities_jurisdiction; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX facilities_jurisdiction ON public.facilities USING btree (jurisdiction_id, kind);


--
-- Name: facility_status_latest; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX facility_status_latest ON public.facility_status_reports USING btree (facility_id, reported_at DESC);


--
-- Name: federation_outbox_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX federation_outbox_pending ON public.federation_outbox USING btree (peer_id, created_at) WHERE (delivered_at IS NULL);


--
-- Name: feed_items_feed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX feed_items_feed ON public.feed_items USING btree (feed_id, fetched_at DESC);


--
-- Name: feed_items_geom; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX feed_items_geom ON public.feed_items USING gist (geom) WHERE (geom IS NOT NULL);


--
-- Name: files_attachment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX files_attachment ON public.files USING btree (attached_kind, attached_id) WHERE (attached_id IS NOT NULL);


--
-- Name: files_fts; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX files_fts ON public.files USING gin (to_tsvector('english'::regconfig, translate(name, '-._/'::text, '    '::text)));


--
-- Name: files_jurisdiction; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX files_jurisdiction ON public.files USING btree (jurisdiction_id, created_at DESC);


--
-- Name: form_definitions_jurisdiction; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX form_definitions_jurisdiction ON public.form_definitions USING btree (jurisdiction_id, key);


--
-- Name: guest_grants_person; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX guest_grants_person ON public.guest_grants USING btree (person_id) WHERE (revoked_at IS NULL);


--
-- Name: iaps_incident; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX iaps_incident ON public.iaps USING btree (incident_id, created_at DESC);


--
-- Name: iaps_revision_lineage; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX iaps_revision_lineage ON public.iaps USING btree (revision_root_id, revision_number DESC);


--
-- Name: iaps_workspace_filters; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX iaps_workspace_filters ON public.iaps USING btree (incident_id, prepared_organization_id, prepared_role_key, period_revision, created_at DESC);


--
-- Name: incident_participants_active_person; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX incident_participants_active_person ON public.incident_participants USING btree (incident_id, person_id) WHERE (revoked_at IS NULL);


--
-- Name: incident_participants_person; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX incident_participants_person ON public.incident_participants USING btree (person_id, incident_id) WHERE (revoked_at IS NULL);


--
-- Name: ipaws_submissions_jurisdiction; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ipaws_submissions_jurisdiction ON public.ipaws_submissions USING btree (jurisdiction_id, submitted_at DESC);


--
-- Name: libraries_fts; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX libraries_fts ON public.libraries USING gin (to_tsvector('english'::regconfig, ((title || ' '::text) || body)));


--
-- Name: media_inquiries_jurisdiction; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX media_inquiries_jurisdiction ON public.media_inquiries USING btree (jurisdiction_id, created_at DESC);


--
-- Name: messages_client_dedupe; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX messages_client_dedupe ON public.messages USING btree (thread_id, sender_person, client_message_id) WHERE (client_message_id IS NOT NULL);


--
-- Name: messages_thread_seq; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX messages_thread_seq ON public.messages USING btree (thread_id, seq);


--
-- Name: notification_rules_jurisdiction; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notification_rules_jurisdiction ON public.notification_rules USING btree (jurisdiction_id) WHERE enabled;


--
-- Name: notifications_person; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notifications_person ON public.notifications USING btree (person_id, created_at DESC) WHERE (person_id IS NOT NULL);


--
-- Name: notifications_position; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notifications_position ON public.notifications USING btree (position_id, created_at DESC) WHERE (position_id IS NOT NULL);


--
-- Name: notifications_unacknowledged; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notifications_unacknowledged ON public.notifications USING btree (person_id, created_at DESC) WHERE (acknowledged_at IS NULL);


--
-- Name: operational_assessment_decisions_current; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX operational_assessment_decisions_current ON public.operational_assessment_decisions USING btree (incident_id, domain, framework, definition_key, created_at DESC, id DESC);


--
-- Name: operational_assessments_current; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX operational_assessments_current ON public.operational_assessments USING btree (incident_id, domain, framework, definition_key, assessed_at DESC);


--
-- Name: operational_assessments_legacy; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX operational_assessments_legacy ON public.operational_assessments USING btree (legacy_record_id, assessed_at DESC) WHERE (legacy_record_id IS NOT NULL);


--
-- Name: operational_assessments_supersedes; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX operational_assessments_supersedes ON public.operational_assessments USING btree (supersedes_id) WHERE (supersedes_id IS NOT NULL);


--
-- Name: operational_relationships_exact_target; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX operational_relationships_exact_target ON public.operational_relationships USING btree (incident_id, source_domain, source_framework, source_definition_key, target_kind, COALESCE(target_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(target_dataset_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(target_feature_id, ''::text), COALESCE(target_iap_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(target_iap_content_revision, 0), COALESCE(target_objective_index, '-1'::integer));


--
-- Name: operational_relationships_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX operational_relationships_source ON public.operational_relationships USING btree (incident_id, source_domain, source_framework, source_definition_key);


--
-- Name: peers_jurisdiction; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX peers_jurisdiction ON public.peers USING btree (jurisdiction_id);


--
-- Name: persons_email_lower; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX persons_email_lower ON public.persons USING btree (lower(email));


--
-- Name: position_assignments_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX position_assignments_active ON public.position_assignments USING btree (position_id, person_id) WHERE (revoked_at IS NULL);


--
-- Name: public_messages_jurisdiction; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX public_messages_jurisdiction ON public.public_messages USING btree (jurisdiction_id, published_at DESC);


--
-- Name: resource_requests_assigned_participant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX resource_requests_assigned_participant ON public.resource_requests USING btree (assigned_participant_id) WHERE (assigned_participant_id IS NOT NULL);


--
-- Name: resource_requests_jurisdiction; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX resource_requests_jurisdiction ON public.resource_requests USING btree (jurisdiction_id, created_at DESC);


--
-- Name: resource_requests_receiving_organization; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX resource_requests_receiving_organization ON public.resource_requests USING btree (receiving_organization_id, created_at DESC);


--
-- Name: resource_requests_supplying_organization; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX resource_requests_supplying_organization ON public.resource_requests USING btree (supplying_organization_id, created_at DESC) WHERE (supplying_organization_id IS NOT NULL);


--
-- Name: rr_costs_request; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX rr_costs_request ON public.rr_costs USING btree (request_id);


--
-- Name: rr_events_request; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX rr_events_request ON public.rr_events USING btree (request_id, at);


--
-- Name: shifts_window; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX shifts_window ON public.shifts USING btree (jurisdiction_id, starts_at, ends_at);


--
-- Name: sitreps_jurisdiction; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sitreps_jurisdiction ON public.sitreps USING btree (jurisdiction_id, composed_at DESC);


--
-- Name: staff_checkins_open; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX staff_checkins_open ON public.staff_checkins USING btree (jurisdiction_id, position_id) WHERE (checked_out_at IS NULL);


--
-- Name: sync_conflicts_incident; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sync_conflicts_incident ON public.sync_conflicts USING btree (incident_id) WHERE (incident_id IS NOT NULL);


--
-- Name: sync_updates_board_seq; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sync_updates_board_seq ON public.sync_updates USING btree (board_id, seq);


--
-- Name: sync_updates_exact_operation; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX sync_updates_exact_operation ON public.sync_updates USING btree (origin_person, operation_id) WHERE (operation_id IS NOT NULL);


--
-- Name: thread_members_thread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX thread_members_thread ON public.thread_members USING btree (thread_id) WHERE (removed_at IS NULL);


--
-- Name: tracked_objects_jurisdiction; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tracked_objects_jurisdiction ON public.tracked_objects USING btree (jurisdiction_id);


--
-- Name: tracking_events_object; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tracking_events_object ON public.tracking_events USING btree (object_id, occurred_at);


--
-- Name: workflow_notification_history_once; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX workflow_notification_history_once ON public.notifications USING btree (channel, ((detail ->> 'historyId'::text))) WHERE ((channel = 'workflow'::text) AND (detail ? 'historyId'::text));


--
-- Name: audit_events audit_events_no_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER audit_events_no_update BEFORE DELETE OR UPDATE ON public.audit_events FOR EACH ROW EXECUTE FUNCTION public.audit_events_immutable();


--
-- Name: board_records board_records_operational_assessment; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER board_records_operational_assessment AFTER INSERT OR UPDATE ON public.board_records FOR EACH ROW EXECUTE FUNCTION public.capture_legacy_operational_assessment();


--
-- Name: board_workflow_approvals board_workflow_approvals_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER board_workflow_approvals_immutable BEFORE DELETE OR UPDATE ON public.board_workflow_approvals FOR EACH ROW EXECUTE FUNCTION public.audit_events_immutable();


--
-- Name: board_workflow_history board_workflow_history_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER board_workflow_history_immutable BEFORE DELETE OR UPDATE ON public.board_workflow_history FOR EACH ROW EXECUTE FUNCTION public.audit_events_immutable();


--
-- Name: checklist_items checklist_task_dependency_completion_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER checklist_task_dependency_completion_guard BEFORE UPDATE OF status ON public.checklist_items FOR EACH ROW EXECUTE FUNCTION public.guard_checklist_task_prerequisites();


--
-- Name: checklist_task_dependencies checklist_task_dependency_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER checklist_task_dependency_guard BEFORE INSERT OR UPDATE ON public.checklist_task_dependencies FOR EACH ROW EXECUTE FUNCTION public.validate_checklist_task_dependency();


--
-- Name: checklist_items checklist_task_update_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER checklist_task_update_guard BEFORE UPDATE ON public.checklist_items FOR EACH ROW EXECUTE FUNCTION public.validate_checklist_task_update();


--
-- Name: corrective_actions corrective_action_revision_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER corrective_action_revision_guard BEFORE UPDATE ON public.corrective_actions FOR EACH ROW EXECUTE FUNCTION public.enforce_corrective_action_revision();


--
-- Name: files files_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER files_immutable BEFORE DELETE OR UPDATE ON public.files FOR EACH ROW EXECUTE FUNCTION public.audit_events_immutable();


--
-- Name: iaps iap_attribution_transition_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER iap_attribution_transition_guard BEFORE INSERT OR UPDATE ON public.iaps FOR EACH ROW EXECUTE FUNCTION public.enforce_iap_attribution_and_transition();


--
-- Name: iaps iap_revision_lineage_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER iap_revision_lineage_guard BEFORE INSERT OR UPDATE ON public.iaps FOR EACH ROW EXECUTE FUNCTION public.enforce_iap_revision_lineage();


--
-- Name: incident_area_revisions incident_area_append; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER incident_area_append BEFORE INSERT ON public.incident_area_revisions FOR EACH ROW EXECUTE FUNCTION public.check_incident_area_append();


--
-- Name: incident_area_revisions incident_area_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER incident_area_immutable BEFORE DELETE OR UPDATE ON public.incident_area_revisions FOR EACH ROW EXECUTE FUNCTION public.reject_incident_area_change();


--
-- Name: messages messages_no_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER messages_no_update BEFORE UPDATE ON public.messages FOR EACH ROW EXECUTE FUNCTION public.audit_events_immutable();


--
-- Name: operational_assessment_decisions operational_assessment_decisions_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER operational_assessment_decisions_immutable BEFORE DELETE OR UPDATE ON public.operational_assessment_decisions FOR EACH ROW EXECUTE FUNCTION public.audit_events_immutable();


--
-- Name: operational_assessments operational_assessments_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER operational_assessments_immutable BEFORE DELETE OR UPDATE ON public.operational_assessments FOR EACH ROW EXECUTE FUNCTION public.audit_events_immutable();


--
-- Name: incident_participants participant_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER participant_immutable BEFORE INSERT OR UPDATE ON public.incident_participants FOR EACH ROW EXECUTE FUNCTION public.check_incident_participant_change();


--
-- Name: incident_participants participant_no_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER participant_no_delete BEFORE DELETE ON public.incident_participants FOR EACH ROW EXECUTE FUNCTION public.check_incident_participant_change();


--
-- Name: sitreps sitreps_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER sitreps_immutable BEFORE DELETE OR UPDATE ON public.sitreps FOR EACH ROW EXECUTE FUNCTION public.audit_events_immutable();


--
-- Name: sync_updates sync_updates_no_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER sync_updates_no_update BEFORE DELETE OR UPDATE ON public.sync_updates FOR EACH ROW EXECUTE FUNCTION public.audit_events_immutable();


--
-- Name: aar_observations aar_observations_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aar_observations
    ADD CONSTRAINT aar_observations_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.persons(id);


--
-- Name: aar_observations aar_observations_incident_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aar_observations
    ADD CONSTRAINT aar_observations_incident_id_fkey FOREIGN KEY (incident_id) REFERENCES public.incidents(id);


--
-- Name: aar_observations aar_observations_jurisdiction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aar_observations
    ADD CONSTRAINT aar_observations_jurisdiction_id_fkey FOREIGN KEY (jurisdiction_id) REFERENCES public.jurisdictions(id);


--
-- Name: aar_observations aar_observations_period_incident_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aar_observations
    ADD CONSTRAINT aar_observations_period_incident_fk FOREIGN KEY (incident_id, operational_period_revision) REFERENCES public.incident_area_revisions(incident_id, revision);


--
-- Name: aars aars_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aars
    ADD CONSTRAINT aars_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.persons(id);


--
-- Name: aars aars_incident_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aars
    ADD CONSTRAINT aars_incident_id_fkey FOREIGN KEY (incident_id) REFERENCES public.incidents(id);


--
-- Name: aars aars_jurisdiction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aars
    ADD CONSTRAINT aars_jurisdiction_id_fkey FOREIGN KEY (jurisdiction_id) REFERENCES public.jurisdictions(id);


--
-- Name: audit_events audit_events_corrects_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_events
    ADD CONSTRAINT audit_events_corrects_fkey FOREIGN KEY (corrects) REFERENCES public.audit_events(id);


--
-- Name: audit_events audit_events_jurisdiction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_events
    ADD CONSTRAINT audit_events_jurisdiction_id_fkey FOREIGN KEY (jurisdiction_id) REFERENCES public.jurisdictions(id);


--
-- Name: audit_events audit_events_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_events
    ADD CONSTRAINT audit_events_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.persons(id);


--
-- Name: audit_events audit_events_position_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_events
    ADD CONSTRAINT audit_events_position_id_fkey FOREIGN KEY (position_id) REFERENCES public.positions(id);


--
-- Name: auth_sessions auth_sessions_active_position_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_sessions
    ADD CONSTRAINT auth_sessions_active_position_id_fkey FOREIGN KEY (active_position_id) REFERENCES public.positions(id);


--
-- Name: auth_sessions auth_sessions_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_sessions
    ADD CONSTRAINT auth_sessions_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.persons(id);


--
-- Name: badges badges_issued_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.badges
    ADD CONSTRAINT badges_issued_by_fkey FOREIGN KEY (issued_by) REFERENCES public.persons(id);


--
-- Name: badges badges_jurisdiction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.badges
    ADD CONSTRAINT badges_jurisdiction_id_fkey FOREIGN KEY (jurisdiction_id) REFERENCES public.jurisdictions(id);


--
-- Name: badges badges_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.badges
    ADD CONSTRAINT badges_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.persons(id);


--
-- Name: board_records board_records_board_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.board_records
    ADD CONSTRAINT board_records_board_id_fkey FOREIGN KEY (board_id) REFERENCES public.boards(id);


--
-- Name: board_records board_records_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.board_records
    ADD CONSTRAINT board_records_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.persons(id);


--
-- Name: board_records board_records_created_by_position_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.board_records
    ADD CONSTRAINT board_records_created_by_position_fkey FOREIGN KEY (created_by_position) REFERENCES public.positions(id);


--
-- Name: board_records board_records_incident_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.board_records
    ADD CONSTRAINT board_records_incident_id_fkey FOREIGN KEY (incident_id) REFERENCES public.incidents(id);


--
-- Name: board_records board_records_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.board_records
    ADD CONSTRAINT board_records_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.persons(id);


--
-- Name: board_workflow_approvals board_workflow_approvals_actor_participation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.board_workflow_approvals
    ADD CONSTRAINT board_workflow_approvals_actor_participation_id_fkey FOREIGN KEY (actor_participation_id) REFERENCES public.incident_participants(id);


--
-- Name: board_workflow_approvals board_workflow_approvals_actor_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.board_workflow_approvals
    ADD CONSTRAINT board_workflow_approvals_actor_person_id_fkey FOREIGN KEY (actor_person_id) REFERENCES public.persons(id);


--
-- Name: board_workflow_approvals board_workflow_approvals_actor_position_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.board_workflow_approvals
    ADD CONSTRAINT board_workflow_approvals_actor_position_id_fkey FOREIGN KEY (actor_position_id) REFERENCES public.positions(id);


--
-- Name: board_workflow_approvals board_workflow_approvals_board_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.board_workflow_approvals
    ADD CONSTRAINT board_workflow_approvals_board_id_fkey FOREIGN KEY (board_id) REFERENCES public.boards(id);


--
-- Name: board_workflow_approvals board_workflow_approvals_incident_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.board_workflow_approvals
    ADD CONSTRAINT board_workflow_approvals_incident_id_fkey FOREIGN KEY (incident_id) REFERENCES public.incidents(id);


--
-- Name: board_workflow_approvals board_workflow_approvals_jurisdiction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.board_workflow_approvals
    ADD CONSTRAINT board_workflow_approvals_jurisdiction_id_fkey FOREIGN KEY (jurisdiction_id) REFERENCES public.jurisdictions(id);


--
-- Name: board_workflow_approvals board_workflow_approvals_record_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.board_workflow_approvals
    ADD CONSTRAINT board_workflow_approvals_record_id_fkey FOREIGN KEY (record_id) REFERENCES public.board_workflow_instances(record_id);


--
-- Name: board_workflow_history board_workflow_history_actor_participation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.board_workflow_history
    ADD CONSTRAINT board_workflow_history_actor_participation_id_fkey FOREIGN KEY (actor_participation_id) REFERENCES public.incident_participants(id);


--
-- Name: board_workflow_history board_workflow_history_actor_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.board_workflow_history
    ADD CONSTRAINT board_workflow_history_actor_person_id_fkey FOREIGN KEY (actor_person_id) REFERENCES public.persons(id);


--
-- Name: board_workflow_history board_workflow_history_actor_position_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.board_workflow_history
    ADD CONSTRAINT board_workflow_history_actor_position_id_fkey FOREIGN KEY (actor_position_id) REFERENCES public.positions(id);


--
-- Name: board_workflow_history board_workflow_history_board_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.board_workflow_history
    ADD CONSTRAINT board_workflow_history_board_id_fkey FOREIGN KEY (board_id) REFERENCES public.boards(id);


--
-- Name: board_workflow_history board_workflow_history_incident_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.board_workflow_history
    ADD CONSTRAINT board_workflow_history_incident_id_fkey FOREIGN KEY (incident_id) REFERENCES public.incidents(id);


--
-- Name: board_workflow_history board_workflow_history_jurisdiction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.board_workflow_history
    ADD CONSTRAINT board_workflow_history_jurisdiction_id_fkey FOREIGN KEY (jurisdiction_id) REFERENCES public.jurisdictions(id);


--
-- Name: board_workflow_history board_workflow_history_record_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.board_workflow_history
    ADD CONSTRAINT board_workflow_history_record_id_fkey FOREIGN KEY (record_id) REFERENCES public.board_workflow_instances(record_id);


--
-- Name: board_workflow_idempotency board_workflow_idempotency_actor_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.board_workflow_idempotency
    ADD CONSTRAINT board_workflow_idempotency_actor_person_id_fkey FOREIGN KEY (actor_person_id) REFERENCES public.persons(id);


--
-- Name: board_workflow_idempotency board_workflow_idempotency_board_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.board_workflow_idempotency
    ADD CONSTRAINT board_workflow_idempotency_board_id_fkey FOREIGN KEY (board_id) REFERENCES public.boards(id);


--
-- Name: board_workflow_idempotency board_workflow_idempotency_incident_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.board_workflow_idempotency
    ADD CONSTRAINT board_workflow_idempotency_incident_id_fkey FOREIGN KEY (incident_id) REFERENCES public.incidents(id);


--
-- Name: board_workflow_idempotency board_workflow_idempotency_jurisdiction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.board_workflow_idempotency
    ADD CONSTRAINT board_workflow_idempotency_jurisdiction_id_fkey FOREIGN KEY (jurisdiction_id) REFERENCES public.jurisdictions(id);


--
-- Name: board_workflow_idempotency board_workflow_idempotency_record_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.board_workflow_idempotency
    ADD CONSTRAINT board_workflow_idempotency_record_id_fkey FOREIGN KEY (record_id) REFERENCES public.board_records(id);


--
-- Name: board_workflow_instances board_workflow_instances_assignment_participant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.board_workflow_instances
    ADD CONSTRAINT board_workflow_instances_assignment_participant_id_fkey FOREIGN KEY (assignment_participant_id) REFERENCES public.incident_participants(id);


--
-- Name: board_workflow_instances board_workflow_instances_assignment_position_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.board_workflow_instances
    ADD CONSTRAINT board_workflow_instances_assignment_position_id_fkey FOREIGN KEY (assignment_position_id) REFERENCES public.positions(id);


--
-- Name: board_workflow_instances board_workflow_instances_board_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.board_workflow_instances
    ADD CONSTRAINT board_workflow_instances_board_id_fkey FOREIGN KEY (board_id) REFERENCES public.boards(id);


--
-- Name: board_workflow_instances board_workflow_instances_incident_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.board_workflow_instances
    ADD CONSTRAINT board_workflow_instances_incident_id_fkey FOREIGN KEY (incident_id) REFERENCES public.incidents(id);


--
-- Name: board_workflow_instances board_workflow_instances_jurisdiction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.board_workflow_instances
    ADD CONSTRAINT board_workflow_instances_jurisdiction_id_fkey FOREIGN KEY (jurisdiction_id) REFERENCES public.jurisdictions(id);


--
-- Name: board_workflow_instances board_workflow_instances_pending_requested_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.board_workflow_instances
    ADD CONSTRAINT board_workflow_instances_pending_requested_by_fkey FOREIGN KEY (pending_requested_by) REFERENCES public.persons(id);


--
-- Name: board_workflow_instances board_workflow_instances_record_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.board_workflow_instances
    ADD CONSTRAINT board_workflow_instances_record_id_fkey FOREIGN KEY (record_id) REFERENCES public.board_records(id);


--
-- Name: board_workflow_instances board_workflow_instances_template_key_template_version_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.board_workflow_instances
    ADD CONSTRAINT board_workflow_instances_template_key_template_version_fkey FOREIGN KEY (template_key, template_version) REFERENCES public.board_templates(key, version);


--
-- Name: boards boards_jurisdiction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.boards
    ADD CONSTRAINT boards_jurisdiction_id_fkey FOREIGN KEY (jurisdiction_id) REFERENCES public.jurisdictions(id);


--
-- Name: boards boards_template_key_template_version_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.boards
    ADD CONSTRAINT boards_template_key_template_version_fkey FOREIGN KEY (template_key, template_version) REFERENCES public.board_templates(key, version);


--
-- Name: briefings briefings_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.briefings
    ADD CONSTRAINT briefings_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.persons(id);


--
-- Name: briefings briefings_incident_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.briefings
    ADD CONSTRAINT briefings_incident_id_fkey FOREIGN KEY (incident_id) REFERENCES public.incidents(id);


--
-- Name: cap_alert_reviews cap_alert_reviews_actor_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cap_alert_reviews
    ADD CONSTRAINT cap_alert_reviews_actor_person_id_fkey FOREIGN KEY (actor_person_id) REFERENCES public.persons(id);


--
-- Name: cap_alert_reviews cap_alert_reviews_alert_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cap_alert_reviews
    ADD CONSTRAINT cap_alert_reviews_alert_id_fkey FOREIGN KEY (alert_id) REFERENCES public.cap_alerts(id);


--
-- Name: cap_alert_reviews cap_alert_reviews_jurisdiction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cap_alert_reviews
    ADD CONSTRAINT cap_alert_reviews_jurisdiction_id_fkey FOREIGN KEY (jurisdiction_id) REFERENCES public.jurisdictions(id);


--
-- Name: cap_alerts cap_alerts_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cap_alerts
    ADD CONSTRAINT cap_alerts_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.persons(id);


--
-- Name: cap_alerts cap_alerts_incident_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cap_alerts
    ADD CONSTRAINT cap_alerts_incident_id_fkey FOREIGN KEY (incident_id) REFERENCES public.incidents(id);


--
-- Name: cap_alerts cap_alerts_jurisdiction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cap_alerts
    ADD CONSTRAINT cap_alerts_jurisdiction_id_fkey FOREIGN KEY (jurisdiction_id) REFERENCES public.jurisdictions(id);


--
-- Name: checklist_completion_operations checklist_completion_operations_actor_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checklist_completion_operations
    ADD CONSTRAINT checklist_completion_operations_actor_person_id_fkey FOREIGN KEY (actor_person_id) REFERENCES public.persons(id);


--
-- Name: checklist_completion_operations checklist_completion_operations_incident_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checklist_completion_operations
    ADD CONSTRAINT checklist_completion_operations_incident_id_fkey FOREIGN KEY (incident_id) REFERENCES public.incidents(id);


--
-- Name: checklist_completion_operations checklist_completion_operations_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checklist_completion_operations
    ADD CONSTRAINT checklist_completion_operations_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.checklist_items(id);


--
-- Name: checklist_items checklist_items_assigned_participant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checklist_items
    ADD CONSTRAINT checklist_items_assigned_participant_id_fkey FOREIGN KEY (assigned_participant_id) REFERENCES public.incident_participants(id);


--
-- Name: checklist_items checklist_items_completed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checklist_items
    ADD CONSTRAINT checklist_items_completed_by_fkey FOREIGN KEY (completed_by) REFERENCES public.persons(id);


--
-- Name: checklist_items checklist_items_completed_by_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checklist_items
    ADD CONSTRAINT checklist_items_completed_by_organization_id_fkey FOREIGN KEY (completed_by_organization_id) REFERENCES public.jurisdictions(id);


--
-- Name: checklist_items checklist_items_completed_by_participation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checklist_items
    ADD CONSTRAINT checklist_items_completed_by_participation_id_fkey FOREIGN KEY (completed_by_participation_id) REFERENCES public.incident_participants(id);


--
-- Name: checklist_items checklist_items_completed_by_position_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checklist_items
    ADD CONSTRAINT checklist_items_completed_by_position_fkey FOREIGN KEY (completed_by_position) REFERENCES public.positions(id);


--
-- Name: checklist_items checklist_items_incident_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checklist_items
    ADD CONSTRAINT checklist_items_incident_id_fkey FOREIGN KEY (incident_id) REFERENCES public.incidents(id);


--
-- Name: checklist_items checklist_items_position_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checklist_items
    ADD CONSTRAINT checklist_items_position_id_fkey FOREIGN KEY (position_id) REFERENCES public.positions(id);


--
-- Name: checklist_task_dependencies checklist_task_dependencies_prerequisite_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checklist_task_dependencies
    ADD CONSTRAINT checklist_task_dependencies_prerequisite_task_id_fkey FOREIGN KEY (prerequisite_task_id) REFERENCES public.checklist_items(id) ON DELETE RESTRICT;


--
-- Name: checklist_task_dependencies checklist_task_dependencies_task_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checklist_task_dependencies
    ADD CONSTRAINT checklist_task_dependencies_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.checklist_items(id) ON DELETE CASCADE;


--
-- Name: collab_backends collab_backends_jurisdiction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.collab_backends
    ADD CONSTRAINT collab_backends_jurisdiction_id_fkey FOREIGN KEY (jurisdiction_id) REFERENCES public.jurisdictions(id);


--
-- Name: collab_backends collab_backends_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.collab_backends
    ADD CONSTRAINT collab_backends_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.persons(id);


--
-- Name: collab_channel_members collab_channel_members_channel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.collab_channel_members
    ADD CONSTRAINT collab_channel_members_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES public.collab_channels(id);


--
-- Name: collab_channel_members collab_channel_members_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.collab_channel_members
    ADD CONSTRAINT collab_channel_members_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.persons(id);


--
-- Name: collab_channels collab_channels_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.collab_channels
    ADD CONSTRAINT collab_channels_space_id_fkey FOREIGN KEY (space_id) REFERENCES public.collab_spaces(id);


--
-- Name: collab_spaces collab_spaces_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.collab_spaces
    ADD CONSTRAINT collab_spaces_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.persons(id);


--
-- Name: collab_spaces collab_spaces_incident_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.collab_spaces
    ADD CONSTRAINT collab_spaces_incident_id_fkey FOREIGN KEY (incident_id) REFERENCES public.incidents(id);


--
-- Name: corrective_actions corrective_actions_completed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.corrective_actions
    ADD CONSTRAINT corrective_actions_completed_by_fkey FOREIGN KEY (completed_by) REFERENCES public.persons(id);


--
-- Name: corrective_actions corrective_actions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.corrective_actions
    ADD CONSTRAINT corrective_actions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.persons(id);


--
-- Name: corrective_actions corrective_actions_incident_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.corrective_actions
    ADD CONSTRAINT corrective_actions_incident_id_fkey FOREIGN KEY (incident_id) REFERENCES public.incidents(id);


--
-- Name: corrective_actions corrective_actions_jurisdiction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.corrective_actions
    ADD CONSTRAINT corrective_actions_jurisdiction_id_fkey FOREIGN KEY (jurisdiction_id) REFERENCES public.jurisdictions(id);


--
-- Name: corrective_actions corrective_actions_owner_participant_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.corrective_actions
    ADD CONSTRAINT corrective_actions_owner_participant_fkey FOREIGN KEY (owner_participant) REFERENCES public.incident_participants(id);


--
-- Name: corrective_actions corrective_actions_owner_person_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.corrective_actions
    ADD CONSTRAINT corrective_actions_owner_person_fkey FOREIGN KEY (owner_person) REFERENCES public.persons(id);


--
-- Name: corrective_actions corrective_actions_owner_position_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.corrective_actions
    ADD CONSTRAINT corrective_actions_owner_position_fkey FOREIGN KEY (owner_position) REFERENCES public.positions(id);


--
-- Name: corrective_actions corrective_actions_period_incident_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.corrective_actions
    ADD CONSTRAINT corrective_actions_period_incident_fk FOREIGN KEY (incident_id, operational_period_revision) REFERENCES public.incident_area_revisions(incident_id, revision);


--
-- Name: damage_assessments damage_assessments_assessed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.damage_assessments
    ADD CONSTRAINT damage_assessments_assessed_by_fkey FOREIGN KEY (assessed_by) REFERENCES public.persons(id);


--
-- Name: damage_assessments damage_assessments_baseline_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.damage_assessments
    ADD CONSTRAINT damage_assessments_baseline_id_fkey FOREIGN KEY (baseline_id) REFERENCES public.damage_baselines(id);


--
-- Name: damage_assessments damage_assessments_jurisdiction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.damage_assessments
    ADD CONSTRAINT damage_assessments_jurisdiction_id_fkey FOREIGN KEY (jurisdiction_id) REFERENCES public.jurisdictions(id);


--
-- Name: damage_assessments damage_assessments_moderated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.damage_assessments
    ADD CONSTRAINT damage_assessments_moderated_by_fkey FOREIGN KEY (moderated_by) REFERENCES public.persons(id);


--
-- Name: damage_baselines damage_baselines_imported_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.damage_baselines
    ADD CONSTRAINT damage_baselines_imported_by_fkey FOREIGN KEY (imported_by) REFERENCES public.persons(id);


--
-- Name: damage_baselines damage_baselines_jurisdiction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.damage_baselines
    ADD CONSTRAINT damage_baselines_jurisdiction_id_fkey FOREIGN KEY (jurisdiction_id) REFERENCES public.jurisdictions(id);


--
-- Name: damage_intake damage_intake_jurisdiction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.damage_intake
    ADD CONSTRAINT damage_intake_jurisdiction_id_fkey FOREIGN KEY (jurisdiction_id) REFERENCES public.jurisdictions(id);


--
-- Name: damage_intake damage_intake_owner_person_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.damage_intake
    ADD CONSTRAINT damage_intake_owner_person_fkey FOREIGN KEY (owner_person) REFERENCES public.persons(id);


--
-- Name: dashboards dashboards_jurisdiction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboards
    ADD CONSTRAINT dashboards_jurisdiction_id_fkey FOREIGN KEY (jurisdiction_id) REFERENCES public.jurisdictions(id);


--
-- Name: dashboards dashboards_template_key_template_version_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dashboards
    ADD CONSTRAINT dashboards_template_key_template_version_fkey FOREIGN KEY (template_key, template_version) REFERENCES public.dashboard_templates(key, version);


--
-- Name: data_pack_datasets data_pack_datasets_pack_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.data_pack_datasets
    ADD CONSTRAINT data_pack_datasets_pack_id_fkey FOREIGN KEY (pack_id) REFERENCES public.data_packs(id);


--
-- Name: data_pack_items data_pack_items_dataset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.data_pack_items
    ADD CONSTRAINT data_pack_items_dataset_id_fkey FOREIGN KEY (dataset_id) REFERENCES public.data_pack_datasets(id) ON DELETE CASCADE;


--
-- Name: data_pack_items data_pack_items_incident_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.data_pack_items
    ADD CONSTRAINT data_pack_items_incident_id_fkey FOREIGN KEY (incident_id) REFERENCES public.incidents(id);


--
-- Name: data_pack_items data_pack_items_loaded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.data_pack_items
    ADD CONSTRAINT data_pack_items_loaded_by_fkey FOREIGN KEY (loaded_by) REFERENCES public.persons(id);


--
-- Name: data_packs data_packs_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.data_packs
    ADD CONSTRAINT data_packs_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.persons(id);


--
-- Name: data_packs data_packs_incident_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.data_packs
    ADD CONSTRAINT data_packs_incident_id_fkey FOREIGN KEY (incident_id) REFERENCES public.incidents(id);


--
-- Name: data_packs data_packs_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.data_packs
    ADD CONSTRAINT data_packs_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.jurisdictions(id);


--
-- Name: facilities facilities_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.facilities
    ADD CONSTRAINT facilities_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.persons(id);


--
-- Name: facilities facilities_jurisdiction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.facilities
    ADD CONSTRAINT facilities_jurisdiction_id_fkey FOREIGN KEY (jurisdiction_id) REFERENCES public.jurisdictions(id);


--
-- Name: facility_status_reports facility_status_reports_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.facility_status_reports
    ADD CONSTRAINT facility_status_reports_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id);


--
-- Name: facility_status_reports facility_status_reports_jurisdiction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.facility_status_reports
    ADD CONSTRAINT facility_status_reports_jurisdiction_id_fkey FOREIGN KEY (jurisdiction_id) REFERENCES public.jurisdictions(id);


--
-- Name: facility_status_reports facility_status_reports_reported_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.facility_status_reports
    ADD CONSTRAINT facility_status_reports_reported_by_fkey FOREIGN KEY (reported_by) REFERENCES public.persons(id);


--
-- Name: federation_outbox federation_outbox_board_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.federation_outbox
    ADD CONSTRAINT federation_outbox_board_id_fkey FOREIGN KEY (board_id) REFERENCES public.boards(id);


--
-- Name: federation_outbox federation_outbox_peer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.federation_outbox
    ADD CONSTRAINT federation_outbox_peer_id_fkey FOREIGN KEY (peer_id) REFERENCES public.peers(id);


--
-- Name: feed_items feed_items_feed_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feed_items
    ADD CONSTRAINT feed_items_feed_id_fkey FOREIGN KEY (feed_id) REFERENCES public.feeds(id);


--
-- Name: feeds feeds_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feeds
    ADD CONSTRAINT feeds_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.persons(id);


--
-- Name: feeds feeds_jurisdiction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feeds
    ADD CONSTRAINT feeds_jurisdiction_id_fkey FOREIGN KEY (jurisdiction_id) REFERENCES public.jurisdictions(id);


--
-- Name: files files_jurisdiction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.files
    ADD CONSTRAINT files_jurisdiction_id_fkey FOREIGN KEY (jurisdiction_id) REFERENCES public.jurisdictions(id);


--
-- Name: files files_supersedes_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.files
    ADD CONSTRAINT files_supersedes_fkey FOREIGN KEY (supersedes) REFERENCES public.files(id);


--
-- Name: files files_uploaded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.files
    ADD CONSTRAINT files_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.persons(id);


--
-- Name: files files_uploaded_by_position_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.files
    ADD CONSTRAINT files_uploaded_by_position_fkey FOREIGN KEY (uploaded_by_position) REFERENCES public.positions(id);


--
-- Name: form_definitions form_definitions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.form_definitions
    ADD CONSTRAINT form_definitions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.persons(id);


--
-- Name: form_definitions form_definitions_jurisdiction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.form_definitions
    ADD CONSTRAINT form_definitions_jurisdiction_id_fkey FOREIGN KEY (jurisdiction_id) REFERENCES public.jurisdictions(id);


--
-- Name: guest_grants guest_grants_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guest_grants
    ADD CONSTRAINT guest_grants_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.persons(id);


--
-- Name: guest_grants guest_grants_jurisdiction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guest_grants
    ADD CONSTRAINT guest_grants_jurisdiction_id_fkey FOREIGN KEY (jurisdiction_id) REFERENCES public.jurisdictions(id);


--
-- Name: guest_grants guest_grants_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guest_grants
    ADD CONSTRAINT guest_grants_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.persons(id);


--
-- Name: guest_grants guest_grants_revoked_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guest_grants
    ADD CONSTRAINT guest_grants_revoked_by_fkey FOREIGN KEY (revoked_by) REFERENCES public.persons(id);


--
-- Name: iaps iaps_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.iaps
    ADD CONSTRAINT iaps_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.persons(id);


--
-- Name: iaps iaps_incident_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.iaps
    ADD CONSTRAINT iaps_incident_id_fkey FOREIGN KEY (incident_id) REFERENCES public.incidents(id);


--
-- Name: iaps iaps_period_reference; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.iaps
    ADD CONSTRAINT iaps_period_reference FOREIGN KEY (incident_id, period_revision) REFERENCES public.incident_area_revisions(incident_id, revision);


--
-- Name: iaps iaps_prepared_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.iaps
    ADD CONSTRAINT iaps_prepared_by_fkey FOREIGN KEY (prepared_by) REFERENCES public.persons(id);


--
-- Name: iaps iaps_prepared_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.iaps
    ADD CONSTRAINT iaps_prepared_organization_id_fkey FOREIGN KEY (prepared_organization_id) REFERENCES public.jurisdictions(id);


--
-- Name: iaps iaps_prepared_participation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.iaps
    ADD CONSTRAINT iaps_prepared_participation_id_fkey FOREIGN KEY (prepared_participation_id) REFERENCES public.incident_participants(id);


--
-- Name: iaps iaps_prepared_position_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.iaps
    ADD CONSTRAINT iaps_prepared_position_id_fkey FOREIGN KEY (prepared_position_id) REFERENCES public.positions(id);


--
-- Name: iaps iaps_revision_root_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.iaps
    ADD CONSTRAINT iaps_revision_root_fk FOREIGN KEY (revision_root_id) REFERENCES public.iaps(id);


--
-- Name: iaps iaps_submitted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.iaps
    ADD CONSTRAINT iaps_submitted_by_fkey FOREIGN KEY (submitted_by) REFERENCES public.persons(id);


--
-- Name: iaps iaps_supersedes_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.iaps
    ADD CONSTRAINT iaps_supersedes_fk FOREIGN KEY (supersedes_iap_id) REFERENCES public.iaps(id);


--
-- Name: incident_area_revisions incident_area_revisions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incident_area_revisions
    ADD CONSTRAINT incident_area_revisions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.persons(id);


--
-- Name: incident_area_revisions incident_area_revisions_home_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incident_area_revisions
    ADD CONSTRAINT incident_area_revisions_home_organization_id_fkey FOREIGN KEY (home_organization_id) REFERENCES public.jurisdictions(id);


--
-- Name: incident_area_revisions incident_area_revisions_incident_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incident_area_revisions
    ADD CONSTRAINT incident_area_revisions_incident_id_fkey FOREIGN KEY (incident_id) REFERENCES public.incidents(id);


--
-- Name: incident_area_revisions incident_area_revisions_participation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incident_area_revisions
    ADD CONSTRAINT incident_area_revisions_participation_id_fkey FOREIGN KEY (participation_id) REFERENCES public.incident_participants(id);


--
-- Name: incident_area_revisions incident_area_revisions_position_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incident_area_revisions
    ADD CONSTRAINT incident_area_revisions_position_id_fkey FOREIGN KEY (position_id) REFERENCES public.positions(id);


--
-- Name: incident_boards incident_boards_board_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incident_boards
    ADD CONSTRAINT incident_boards_board_id_fkey FOREIGN KEY (board_id) REFERENCES public.boards(id);


--
-- Name: incident_boards incident_boards_incident_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incident_boards
    ADD CONSTRAINT incident_boards_incident_id_fkey FOREIGN KEY (incident_id) REFERENCES public.incidents(id);


--
-- Name: incident_libraries incident_libraries_incident_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incident_libraries
    ADD CONSTRAINT incident_libraries_incident_id_fkey FOREIGN KEY (incident_id) REFERENCES public.incidents(id);


--
-- Name: incident_libraries incident_libraries_library_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incident_libraries
    ADD CONSTRAINT incident_libraries_library_id_fkey FOREIGN KEY (library_id) REFERENCES public.libraries(id);


--
-- Name: incident_participants incident_participants_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incident_participants
    ADD CONSTRAINT incident_participants_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.persons(id);


--
-- Name: incident_participants incident_participants_incident_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incident_participants
    ADD CONSTRAINT incident_participants_incident_id_fkey FOREIGN KEY (incident_id) REFERENCES public.incidents(id);


--
-- Name: incident_participants incident_participants_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incident_participants
    ADD CONSTRAINT incident_participants_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.jurisdictions(id);


--
-- Name: incident_participants incident_participants_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incident_participants
    ADD CONSTRAINT incident_participants_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.persons(id);


--
-- Name: incident_participants incident_participants_revoked_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incident_participants
    ADD CONSTRAINT incident_participants_revoked_by_fkey FOREIGN KEY (revoked_by) REFERENCES public.persons(id);


--
-- Name: incident_positions incident_positions_incident_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incident_positions
    ADD CONSTRAINT incident_positions_incident_id_fkey FOREIGN KEY (incident_id) REFERENCES public.incidents(id);


--
-- Name: incident_positions incident_positions_position_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incident_positions
    ADD CONSTRAINT incident_positions_position_id_fkey FOREIGN KEY (position_id) REFERENCES public.positions(id);


--
-- Name: incidents incidents_activated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incidents
    ADD CONSTRAINT incidents_activated_by_fkey FOREIGN KEY (activated_by) REFERENCES public.persons(id);


--
-- Name: incidents incidents_closed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incidents
    ADD CONSTRAINT incidents_closed_by_fkey FOREIGN KEY (closed_by) REFERENCES public.persons(id);


--
-- Name: incidents incidents_jurisdiction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incidents
    ADD CONSTRAINT incidents_jurisdiction_id_fkey FOREIGN KEY (jurisdiction_id) REFERENCES public.jurisdictions(id);


--
-- Name: incidents incidents_template_key_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.incidents
    ADD CONSTRAINT incidents_template_key_fkey FOREIGN KEY (template_key) REFERENCES public.incident_templates(key);


--
-- Name: ipaws_config ipaws_config_jurisdiction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ipaws_config
    ADD CONSTRAINT ipaws_config_jurisdiction_id_fkey FOREIGN KEY (jurisdiction_id) REFERENCES public.jurisdictions(id);


--
-- Name: ipaws_config ipaws_config_moa_acknowledged_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ipaws_config
    ADD CONSTRAINT ipaws_config_moa_acknowledged_by_fkey FOREIGN KEY (moa_acknowledged_by) REFERENCES public.persons(id);


--
-- Name: ipaws_config ipaws_config_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ipaws_config
    ADD CONSTRAINT ipaws_config_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.persons(id);


--
-- Name: ipaws_submissions ipaws_submissions_cap_alert_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ipaws_submissions
    ADD CONSTRAINT ipaws_submissions_cap_alert_id_fkey FOREIGN KEY (cap_alert_id) REFERENCES public.cap_alerts(id);


--
-- Name: ipaws_submissions ipaws_submissions_jurisdiction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ipaws_submissions
    ADD CONSTRAINT ipaws_submissions_jurisdiction_id_fkey FOREIGN KEY (jurisdiction_id) REFERENCES public.jurisdictions(id);


--
-- Name: ipaws_submissions ipaws_submissions_submitted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ipaws_submissions
    ADD CONSTRAINT ipaws_submissions_submitted_by_fkey FOREIGN KEY (submitted_by) REFERENCES public.persons(id);


--
-- Name: jurisdiction_memberships jurisdiction_memberships_jurisdiction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jurisdiction_memberships
    ADD CONSTRAINT jurisdiction_memberships_jurisdiction_id_fkey FOREIGN KEY (jurisdiction_id) REFERENCES public.jurisdictions(id);


--
-- Name: jurisdiction_memberships jurisdiction_memberships_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jurisdiction_memberships
    ADD CONSTRAINT jurisdiction_memberships_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.persons(id);


--
-- Name: jurisdiction_settings jurisdiction_settings_jurisdiction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jurisdiction_settings
    ADD CONSTRAINT jurisdiction_settings_jurisdiction_id_fkey FOREIGN KEY (jurisdiction_id) REFERENCES public.jurisdictions(id);


--
-- Name: jurisdiction_settings jurisdiction_settings_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jurisdiction_settings
    ADD CONSTRAINT jurisdiction_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.persons(id);


--
-- Name: libraries libraries_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.libraries
    ADD CONSTRAINT libraries_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.persons(id);


--
-- Name: libraries libraries_for_template_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.libraries
    ADD CONSTRAINT libraries_for_template_fkey FOREIGN KEY (for_template) REFERENCES public.incident_templates(key);


--
-- Name: libraries libraries_jurisdiction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.libraries
    ADD CONSTRAINT libraries_jurisdiction_id_fkey FOREIGN KEY (jurisdiction_id) REFERENCES public.jurisdictions(id);


--
-- Name: media_inquiries media_inquiries_answered_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media_inquiries
    ADD CONSTRAINT media_inquiries_answered_by_fkey FOREIGN KEY (answered_by) REFERENCES public.persons(id);


--
-- Name: media_inquiries media_inquiries_assigned_position_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media_inquiries
    ADD CONSTRAINT media_inquiries_assigned_position_fkey FOREIGN KEY (assigned_position) REFERENCES public.positions(id);


--
-- Name: media_inquiries media_inquiries_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media_inquiries
    ADD CONSTRAINT media_inquiries_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.persons(id);


--
-- Name: media_inquiries media_inquiries_incident_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media_inquiries
    ADD CONSTRAINT media_inquiries_incident_id_fkey FOREIGN KEY (incident_id) REFERENCES public.incidents(id);


--
-- Name: media_inquiries media_inquiries_jurisdiction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media_inquiries
    ADD CONSTRAINT media_inquiries_jurisdiction_id_fkey FOREIGN KEY (jurisdiction_id) REFERENCES public.jurisdictions(id);


--
-- Name: media_inquiries media_inquiries_response_release_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media_inquiries
    ADD CONSTRAINT media_inquiries_response_release_id_fkey FOREIGN KEY (response_release_id) REFERENCES public.press_releases(id);


--
-- Name: meeting_config meeting_config_jurisdiction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting_config
    ADD CONSTRAINT meeting_config_jurisdiction_id_fkey FOREIGN KEY (jurisdiction_id) REFERENCES public.jurisdictions(id);


--
-- Name: meeting_config meeting_config_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meeting_config
    ADD CONSTRAINT meeting_config_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.persons(id);


--
-- Name: meetings meetings_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meetings
    ADD CONSTRAINT meetings_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.persons(id);


--
-- Name: meetings meetings_incident_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.meetings
    ADD CONSTRAINT meetings_incident_id_fkey FOREIGN KEY (incident_id) REFERENCES public.incidents(id);


--
-- Name: messages messages_sender_person_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_sender_person_fkey FOREIGN KEY (sender_person) REFERENCES public.persons(id);


--
-- Name: messages messages_sender_position_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_sender_position_fkey FOREIGN KEY (sender_position) REFERENCES public.positions(id);


--
-- Name: messages messages_thread_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES public.threads(id);


--
-- Name: notification_rules notification_rules_board_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_rules
    ADD CONSTRAINT notification_rules_board_id_fkey FOREIGN KEY (board_id) REFERENCES public.boards(id);


--
-- Name: notification_rules notification_rules_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_rules
    ADD CONSTRAINT notification_rules_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.persons(id);


--
-- Name: notification_rules notification_rules_jurisdiction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_rules
    ADD CONSTRAINT notification_rules_jurisdiction_id_fkey FOREIGN KEY (jurisdiction_id) REFERENCES public.jurisdictions(id);


--
-- Name: notifications notifications_acknowledged_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_acknowledged_by_fkey FOREIGN KEY (acknowledged_by) REFERENCES public.persons(id);


--
-- Name: notifications notifications_jurisdiction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_jurisdiction_id_fkey FOREIGN KEY (jurisdiction_id) REFERENCES public.jurisdictions(id);


--
-- Name: notifications notifications_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.persons(id);


--
-- Name: notifications notifications_position_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_position_id_fkey FOREIGN KEY (position_id) REFERENCES public.positions(id);


--
-- Name: notifications notifications_rule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_rule_id_fkey FOREIGN KEY (rule_id) REFERENCES public.notification_rules(id);


--
-- Name: operational_assessment_decisions operational_assessment_decisions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operational_assessment_decisions
    ADD CONSTRAINT operational_assessment_decisions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.persons(id);


--
-- Name: operational_assessment_decisions operational_assessment_decisions_home_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operational_assessment_decisions
    ADD CONSTRAINT operational_assessment_decisions_home_organization_id_fkey FOREIGN KEY (home_organization_id) REFERENCES public.jurisdictions(id);


--
-- Name: operational_assessment_decisions operational_assessment_decisions_incident_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operational_assessment_decisions
    ADD CONSTRAINT operational_assessment_decisions_incident_id_fkey FOREIGN KEY (incident_id) REFERENCES public.incidents(id);


--
-- Name: operational_assessment_decisions operational_assessment_decisions_jurisdiction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operational_assessment_decisions
    ADD CONSTRAINT operational_assessment_decisions_jurisdiction_id_fkey FOREIGN KEY (jurisdiction_id) REFERENCES public.jurisdictions(id);


--
-- Name: operational_assessment_decisions operational_assessment_decisions_participation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operational_assessment_decisions
    ADD CONSTRAINT operational_assessment_decisions_participation_id_fkey FOREIGN KEY (participation_id) REFERENCES public.incident_participants(id);


--
-- Name: operational_assessment_decisions operational_assessment_decisions_position_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operational_assessment_decisions
    ADD CONSTRAINT operational_assessment_decisions_position_id_fkey FOREIGN KEY (position_id) REFERENCES public.positions(id);


--
-- Name: operational_assessment_decisions operational_assessment_decisions_selected_assessment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operational_assessment_decisions
    ADD CONSTRAINT operational_assessment_decisions_selected_assessment_id_fkey FOREIGN KEY (selected_assessment_id) REFERENCES public.operational_assessments(id);


--
-- Name: operational_assessments operational_assessments_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operational_assessments
    ADD CONSTRAINT operational_assessments_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.persons(id);


--
-- Name: operational_assessments operational_assessments_home_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operational_assessments
    ADD CONSTRAINT operational_assessments_home_organization_id_fkey FOREIGN KEY (home_organization_id) REFERENCES public.jurisdictions(id);


--
-- Name: operational_assessments operational_assessments_incident_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operational_assessments
    ADD CONSTRAINT operational_assessments_incident_id_fkey FOREIGN KEY (incident_id) REFERENCES public.incidents(id);


--
-- Name: operational_assessments operational_assessments_jurisdiction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operational_assessments
    ADD CONSTRAINT operational_assessments_jurisdiction_id_fkey FOREIGN KEY (jurisdiction_id) REFERENCES public.jurisdictions(id);


--
-- Name: operational_assessments operational_assessments_legacy_board_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operational_assessments
    ADD CONSTRAINT operational_assessments_legacy_board_id_fkey FOREIGN KEY (legacy_board_id) REFERENCES public.boards(id);


--
-- Name: operational_assessments operational_assessments_legacy_record_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operational_assessments
    ADD CONSTRAINT operational_assessments_legacy_record_id_fkey FOREIGN KEY (legacy_record_id) REFERENCES public.board_records(id);


--
-- Name: operational_assessments operational_assessments_participation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operational_assessments
    ADD CONSTRAINT operational_assessments_participation_id_fkey FOREIGN KEY (participation_id) REFERENCES public.incident_participants(id);


--
-- Name: operational_assessments operational_assessments_position_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operational_assessments
    ADD CONSTRAINT operational_assessments_position_id_fkey FOREIGN KEY (position_id) REFERENCES public.positions(id);


--
-- Name: operational_assessments operational_assessments_supersedes_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operational_assessments
    ADD CONSTRAINT operational_assessments_supersedes_id_fkey FOREIGN KEY (supersedes_id) REFERENCES public.operational_assessments(id);


--
-- Name: operational_relationships operational_relationships_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operational_relationships
    ADD CONSTRAINT operational_relationships_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.persons(id);


--
-- Name: operational_relationships operational_relationships_incident_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operational_relationships
    ADD CONSTRAINT operational_relationships_incident_id_fkey FOREIGN KEY (incident_id) REFERENCES public.incidents(id) ON DELETE CASCADE;


--
-- Name: operational_relationships operational_relationships_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operational_relationships
    ADD CONSTRAINT operational_relationships_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.jurisdictions(id);


--
-- Name: operational_relationships operational_relationships_participation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operational_relationships
    ADD CONSTRAINT operational_relationships_participation_id_fkey FOREIGN KEY (participation_id) REFERENCES public.incident_participants(id);


--
-- Name: operational_relationships operational_relationships_position_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operational_relationships
    ADD CONSTRAINT operational_relationships_position_id_fkey FOREIGN KEY (position_id) REFERENCES public.positions(id);


--
-- Name: operational_relationships operational_relationships_target_dataset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operational_relationships
    ADD CONSTRAINT operational_relationships_target_dataset_id_fkey FOREIGN KEY (target_dataset_id) REFERENCES public.data_pack_datasets(id);


--
-- Name: operational_relationships operational_relationships_target_iap_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.operational_relationships
    ADD CONSTRAINT operational_relationships_target_iap_id_fkey FOREIGN KEY (target_iap_id) REFERENCES public.iaps(id);


--
-- Name: peers peers_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.peers
    ADD CONSTRAINT peers_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.persons(id);


--
-- Name: peers peers_jurisdiction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.peers
    ADD CONSTRAINT peers_jurisdiction_id_fkey FOREIGN KEY (jurisdiction_id) REFERENCES public.jurisdictions(id);


--
-- Name: person_identities person_identities_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.person_identities
    ADD CONSTRAINT person_identities_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.persons(id);


--
-- Name: position_assignments position_assignments_assigned_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.position_assignments
    ADD CONSTRAINT position_assignments_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES public.persons(id);


--
-- Name: position_assignments position_assignments_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.position_assignments
    ADD CONSTRAINT position_assignments_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.persons(id);


--
-- Name: position_assignments position_assignments_position_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.position_assignments
    ADD CONSTRAINT position_assignments_position_id_fkey FOREIGN KEY (position_id) REFERENCES public.positions(id);


--
-- Name: position_assignments position_assignments_revoked_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.position_assignments
    ADD CONSTRAINT position_assignments_revoked_by_fkey FOREIGN KEY (revoked_by) REFERENCES public.persons(id);


--
-- Name: position_signins position_signins_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.position_signins
    ADD CONSTRAINT position_signins_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.persons(id);


--
-- Name: position_signins position_signins_position_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.position_signins
    ADD CONSTRAINT position_signins_position_id_fkey FOREIGN KEY (position_id) REFERENCES public.positions(id);


--
-- Name: position_signins position_signins_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.position_signins
    ADD CONSTRAINT position_signins_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.auth_sessions(id);


--
-- Name: positions positions_jurisdiction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.positions
    ADD CONSTRAINT positions_jurisdiction_id_fkey FOREIGN KEY (jurisdiction_id) REFERENCES public.jurisdictions(id);


--
-- Name: press_release_approvals press_release_approvals_decided_by_person_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.press_release_approvals
    ADD CONSTRAINT press_release_approvals_decided_by_person_fkey FOREIGN KEY (decided_by_person) REFERENCES public.persons(id);


--
-- Name: press_release_approvals press_release_approvals_release_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.press_release_approvals
    ADD CONSTRAINT press_release_approvals_release_id_fkey FOREIGN KEY (release_id) REFERENCES public.press_releases(id);


--
-- Name: press_release_publications press_release_publications_release_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.press_release_publications
    ADD CONSTRAINT press_release_publications_release_id_fkey FOREIGN KEY (release_id) REFERENCES public.press_releases(id);


--
-- Name: press_releases press_releases_cap_alert_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.press_releases
    ADD CONSTRAINT press_releases_cap_alert_id_fkey FOREIGN KEY (cap_alert_id) REFERENCES public.cap_alerts(id);


--
-- Name: press_releases press_releases_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.press_releases
    ADD CONSTRAINT press_releases_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.persons(id);


--
-- Name: press_releases press_releases_created_by_position_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.press_releases
    ADD CONSTRAINT press_releases_created_by_position_fkey FOREIGN KEY (created_by_position) REFERENCES public.positions(id);


--
-- Name: press_releases press_releases_incident_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.press_releases
    ADD CONSTRAINT press_releases_incident_id_fkey FOREIGN KEY (incident_id) REFERENCES public.incidents(id);


--
-- Name: press_releases press_releases_jurisdiction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.press_releases
    ADD CONSTRAINT press_releases_jurisdiction_id_fkey FOREIGN KEY (jurisdiction_id) REFERENCES public.jurisdictions(id);


--
-- Name: public_messages public_messages_jurisdiction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.public_messages
    ADD CONSTRAINT public_messages_jurisdiction_id_fkey FOREIGN KEY (jurisdiction_id) REFERENCES public.jurisdictions(id);


--
-- Name: public_messages public_messages_release_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.public_messages
    ADD CONSTRAINT public_messages_release_id_fkey FOREIGN KEY (release_id) REFERENCES public.press_releases(id);


--
-- Name: resource_requests resource_requests_assigned_participant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resource_requests
    ADD CONSTRAINT resource_requests_assigned_participant_id_fkey FOREIGN KEY (assigned_participant_id) REFERENCES public.incident_participants(id);


--
-- Name: resource_requests resource_requests_assigned_position_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resource_requests
    ADD CONSTRAINT resource_requests_assigned_position_fkey FOREIGN KEY (assigned_position) REFERENCES public.positions(id);


--
-- Name: resource_requests resource_requests_incident_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resource_requests
    ADD CONSTRAINT resource_requests_incident_id_fkey FOREIGN KEY (incident_id) REFERENCES public.incidents(id);


--
-- Name: resource_requests resource_requests_jurisdiction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resource_requests
    ADD CONSTRAINT resource_requests_jurisdiction_id_fkey FOREIGN KEY (jurisdiction_id) REFERENCES public.jurisdictions(id);


--
-- Name: resource_requests resource_requests_receiving_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resource_requests
    ADD CONSTRAINT resource_requests_receiving_organization_id_fkey FOREIGN KEY (receiving_organization_id) REFERENCES public.jurisdictions(id);


--
-- Name: resource_requests resource_requests_requested_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resource_requests
    ADD CONSTRAINT resource_requests_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES public.persons(id);


--
-- Name: resource_requests resource_requests_supplying_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resource_requests
    ADD CONSTRAINT resource_requests_supplying_organization_id_fkey FOREIGN KEY (supplying_organization_id) REFERENCES public.jurisdictions(id);


--
-- Name: rr_costs rr_costs_recorded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rr_costs
    ADD CONSTRAINT rr_costs_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES public.persons(id);


--
-- Name: rr_costs rr_costs_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rr_costs
    ADD CONSTRAINT rr_costs_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.resource_requests(id);


--
-- Name: rr_events rr_events_actor_person_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rr_events
    ADD CONSTRAINT rr_events_actor_person_fkey FOREIGN KEY (actor_person) REFERENCES public.persons(id);


--
-- Name: rr_events rr_events_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rr_events
    ADD CONSTRAINT rr_events_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.resource_requests(id);


--
-- Name: saved_states saved_states_incident_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saved_states
    ADD CONSTRAINT saved_states_incident_id_fkey FOREIGN KEY (incident_id) REFERENCES public.incidents(id) ON DELETE CASCADE;


--
-- Name: saved_states saved_states_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.saved_states
    ADD CONSTRAINT saved_states_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.persons(id) ON DELETE CASCADE;


--
-- Name: sharing_agreements sharing_agreements_board_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sharing_agreements
    ADD CONSTRAINT sharing_agreements_board_id_fkey FOREIGN KEY (board_id) REFERENCES public.boards(id);


--
-- Name: sharing_agreements sharing_agreements_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sharing_agreements
    ADD CONSTRAINT sharing_agreements_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.persons(id);


--
-- Name: sharing_agreements sharing_agreements_peer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sharing_agreements
    ADD CONSTRAINT sharing_agreements_peer_id_fkey FOREIGN KEY (peer_id) REFERENCES public.peers(id);


--
-- Name: shifts shifts_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shifts
    ADD CONSTRAINT shifts_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.persons(id);


--
-- Name: shifts shifts_incident_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shifts
    ADD CONSTRAINT shifts_incident_id_fkey FOREIGN KEY (incident_id) REFERENCES public.incidents(id);


--
-- Name: shifts shifts_jurisdiction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shifts
    ADD CONSTRAINT shifts_jurisdiction_id_fkey FOREIGN KEY (jurisdiction_id) REFERENCES public.jurisdictions(id);


--
-- Name: shifts shifts_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shifts
    ADD CONSTRAINT shifts_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.persons(id);


--
-- Name: shifts shifts_position_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shifts
    ADD CONSTRAINT shifts_position_id_fkey FOREIGN KEY (position_id) REFERENCES public.positions(id);


--
-- Name: sitreps sitreps_composed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sitreps
    ADD CONSTRAINT sitreps_composed_by_fkey FOREIGN KEY (composed_by) REFERENCES public.persons(id);


--
-- Name: sitreps sitreps_composed_by_position_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sitreps
    ADD CONSTRAINT sitreps_composed_by_position_fkey FOREIGN KEY (composed_by_position) REFERENCES public.positions(id);


--
-- Name: sitreps sitreps_incident_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sitreps
    ADD CONSTRAINT sitreps_incident_id_fkey FOREIGN KEY (incident_id) REFERENCES public.incidents(id);


--
-- Name: sitreps sitreps_jurisdiction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sitreps
    ADD CONSTRAINT sitreps_jurisdiction_id_fkey FOREIGN KEY (jurisdiction_id) REFERENCES public.jurisdictions(id);


--
-- Name: staff_checkins staff_checkins_checked_in_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_checkins
    ADD CONSTRAINT staff_checkins_checked_in_by_fkey FOREIGN KEY (checked_in_by) REFERENCES public.persons(id);


--
-- Name: staff_checkins staff_checkins_incident_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_checkins
    ADD CONSTRAINT staff_checkins_incident_id_fkey FOREIGN KEY (incident_id) REFERENCES public.incidents(id);


--
-- Name: staff_checkins staff_checkins_jurisdiction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_checkins
    ADD CONSTRAINT staff_checkins_jurisdiction_id_fkey FOREIGN KEY (jurisdiction_id) REFERENCES public.jurisdictions(id);


--
-- Name: staff_checkins staff_checkins_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_checkins
    ADD CONSTRAINT staff_checkins_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.persons(id);


--
-- Name: staff_checkins staff_checkins_position_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_checkins
    ADD CONSTRAINT staff_checkins_position_id_fkey FOREIGN KEY (position_id) REFERENCES public.positions(id);


--
-- Name: status_queries status_queries_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.status_queries
    ADD CONSTRAINT status_queries_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.persons(id);


--
-- Name: status_queries status_queries_incident_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.status_queries
    ADD CONSTRAINT status_queries_incident_id_fkey FOREIGN KEY (incident_id) REFERENCES public.incidents(id);


--
-- Name: status_queries status_queries_jurisdiction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.status_queries
    ADD CONSTRAINT status_queries_jurisdiction_id_fkey FOREIGN KEY (jurisdiction_id) REFERENCES public.jurisdictions(id);


--
-- Name: status_query_targets status_query_targets_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.status_query_targets
    ADD CONSTRAINT status_query_targets_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.facilities(id);


--
-- Name: status_query_targets status_query_targets_query_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.status_query_targets
    ADD CONSTRAINT status_query_targets_query_id_fkey FOREIGN KEY (query_id) REFERENCES public.status_queries(id);


--
-- Name: status_query_targets status_query_targets_responded_report_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.status_query_targets
    ADD CONSTRAINT status_query_targets_responded_report_fkey FOREIGN KEY (responded_report) REFERENCES public.facility_status_reports(id);


--
-- Name: sync_conflicts sync_conflicts_board_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sync_conflicts
    ADD CONSTRAINT sync_conflicts_board_id_fkey FOREIGN KEY (board_id) REFERENCES public.boards(id);


--
-- Name: sync_conflicts sync_conflicts_incident_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sync_conflicts
    ADD CONSTRAINT sync_conflicts_incident_id_fkey FOREIGN KEY (incident_id) REFERENCES public.incidents(id);


--
-- Name: sync_conflicts sync_conflicts_origin_person_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sync_conflicts
    ADD CONSTRAINT sync_conflicts_origin_person_fkey FOREIGN KEY (origin_person) REFERENCES public.persons(id);


--
-- Name: sync_conflicts sync_conflicts_resolved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sync_conflicts
    ADD CONSTRAINT sync_conflicts_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES public.persons(id);


--
-- Name: sync_updates sync_updates_board_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sync_updates
    ADD CONSTRAINT sync_updates_board_id_fkey FOREIGN KEY (board_id) REFERENCES public.boards(id);


--
-- Name: sync_updates sync_updates_incident_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sync_updates
    ADD CONSTRAINT sync_updates_incident_id_fkey FOREIGN KEY (incident_id) REFERENCES public.incidents(id);


--
-- Name: sync_updates sync_updates_origin_person_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sync_updates
    ADD CONSTRAINT sync_updates_origin_person_fkey FOREIGN KEY (origin_person) REFERENCES public.persons(id);


--
-- Name: sync_updates sync_updates_origin_position_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sync_updates
    ADD CONSTRAINT sync_updates_origin_position_fkey FOREIGN KEY (origin_position) REFERENCES public.positions(id);


--
-- Name: thread_members thread_members_added_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.thread_members
    ADD CONSTRAINT thread_members_added_by_fkey FOREIGN KEY (added_by) REFERENCES public.persons(id);


--
-- Name: thread_members thread_members_person_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.thread_members
    ADD CONSTRAINT thread_members_person_id_fkey FOREIGN KEY (person_id) REFERENCES public.persons(id);


--
-- Name: thread_members thread_members_position_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.thread_members
    ADD CONSTRAINT thread_members_position_id_fkey FOREIGN KEY (position_id) REFERENCES public.positions(id);


--
-- Name: thread_members thread_members_thread_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.thread_members
    ADD CONSTRAINT thread_members_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES public.threads(id);


--
-- Name: threads threads_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.threads
    ADD CONSTRAINT threads_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.persons(id);


--
-- Name: threads threads_incident_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.threads
    ADD CONSTRAINT threads_incident_id_fkey FOREIGN KEY (incident_id) REFERENCES public.incidents(id);


--
-- Name: threads threads_jurisdiction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.threads
    ADD CONSTRAINT threads_jurisdiction_id_fkey FOREIGN KEY (jurisdiction_id) REFERENCES public.jurisdictions(id);


--
-- Name: tracked_objects tracked_objects_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tracked_objects
    ADD CONSTRAINT tracked_objects_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.persons(id);


--
-- Name: tracked_objects tracked_objects_jurisdiction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tracked_objects
    ADD CONSTRAINT tracked_objects_jurisdiction_id_fkey FOREIGN KEY (jurisdiction_id) REFERENCES public.jurisdictions(id);


--
-- Name: tracking_events tracking_events_jurisdiction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tracking_events
    ADD CONSTRAINT tracking_events_jurisdiction_id_fkey FOREIGN KEY (jurisdiction_id) REFERENCES public.jurisdictions(id);


--
-- Name: tracking_events tracking_events_object_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tracking_events
    ADD CONSTRAINT tracking_events_object_id_fkey FOREIGN KEY (object_id) REFERENCES public.tracked_objects(id);


--
-- Name: tracking_events tracking_events_recorded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tracking_events
    ADD CONSTRAINT tracking_events_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES public.persons(id);


--
-- Name: aar_observations aar_obs_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY aar_obs_read ON public.aar_observations FOR SELECT USING (public.is_member_of(jurisdiction_id));


--
-- Name: aar_observations aar_obs_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY aar_obs_write ON public.aar_observations FOR INSERT WITH CHECK (public.is_member_of(jurisdiction_id));


--
-- Name: aar_observations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.aar_observations ENABLE ROW LEVEL SECURITY;

--
-- Name: aars; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.aars ENABLE ROW LEVEL SECURITY;

--
-- Name: aars aars_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY aars_read ON public.aars FOR SELECT USING (public.is_member_of(jurisdiction_id));


--
-- Name: aars aars_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY aars_write ON public.aars FOR INSERT WITH CHECK (public.is_member_of(jurisdiction_id));


--
-- Name: sharing_agreements agreements_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY agreements_read ON public.sharing_agreements FOR SELECT USING (((EXISTS ( SELECT 1
   FROM public.peers p
  WHERE ((p.id = sharing_agreements.peer_id) AND public.is_member_of(p.jurisdiction_id)))) OR (public.current_person() IS NULL)));


--
-- Name: sharing_agreements agreements_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY agreements_write ON public.sharing_agreements FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.peers p
  WHERE ((p.id = sharing_agreements.peer_id) AND public.is_admin_of(p.jurisdiction_id)))));


--
-- Name: press_release_approvals approvals_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY approvals_read ON public.press_release_approvals FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.press_releases r
  WHERE ((r.id = press_release_approvals.release_id) AND public.is_member_of(r.jurisdiction_id)))));


--
-- Name: press_release_approvals approvals_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY approvals_write ON public.press_release_approvals FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.press_releases r
  WHERE ((r.id = press_release_approvals.release_id) AND public.is_member_of(r.jurisdiction_id)))));


--
-- Name: damage_assessments assessments_moderate; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY assessments_moderate ON public.damage_assessments FOR UPDATE USING (public.is_writer_of(jurisdiction_id));


--
-- Name: damage_assessments assessments_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY assessments_read ON public.damage_assessments FOR SELECT USING (public.is_member_of(jurisdiction_id));


--
-- Name: damage_assessments assessments_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY assessments_write ON public.damage_assessments FOR INSERT WITH CHECK (public.is_writer_of(jurisdiction_id));


--
-- Name: position_assignments assignments_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY assignments_read ON public.position_assignments FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.positions p
  WHERE ((p.id = position_assignments.position_id) AND public.is_member_of(p.jurisdiction_id)))));


--
-- Name: position_assignments assignments_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY assignments_update ON public.position_assignments FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM public.positions p
  WHERE ((p.id = position_assignments.position_id) AND public.is_admin_of(p.jurisdiction_id)))));


--
-- Name: position_assignments assignments_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY assignments_write ON public.position_assignments FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.positions p
  WHERE ((p.id = position_assignments.position_id) AND public.is_admin_of(p.jurisdiction_id)))));


--
-- Name: audit_events audit_aar_assignee_append; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY audit_aar_assignee_append ON public.audit_events FOR INSERT WITH CHECK (((person_id = public.current_person()) AND (category = 'aar.corrective_action_updated'::text) AND (subject_table = 'corrective_actions'::text) AND (incident_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM (public.corrective_actions ca
     JOIN public.incident_participants ip ON (((ip.id = ca.owner_participant) AND (ip.incident_id = ca.incident_id))))
  WHERE ((ca.id = audit_events.subject_id) AND (ca.jurisdiction_id = audit_events.jurisdiction_id) AND (ca.incident_id = audit_events.incident_id) AND (ip.person_id = public.current_person()) AND (ip.revoked_at IS NULL) AND (ip.expires_at > now()) AND public.eligible_incident_person(ip.person_id, ip.organization_id) AND ((ca.revision)::text = (audit_events.payload ->> 'toRevision'::text)) AND (ca.status = (audit_events.payload ->> 'status'::text)))))));


--
-- Name: audit_events audit_aar_assignee_receipt; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY audit_aar_assignee_receipt ON public.audit_events FOR SELECT USING (((person_id = public.current_person()) AND (category = 'aar.corrective_action_updated'::text) AND (subject_table = 'corrective_actions'::text) AND (incident_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM (public.corrective_actions ca
     JOIN public.incident_participants ip ON (((ip.id = ca.owner_participant) AND (ip.incident_id = ca.incident_id))))
  WHERE ((ca.id = audit_events.subject_id) AND (ca.jurisdiction_id = audit_events.jurisdiction_id) AND (ca.incident_id = audit_events.incident_id) AND (ip.person_id = public.current_person()) AND public.eligible_incident_person(ip.person_id, ip.organization_id))))));


--
-- Name: audit_events audit_append; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY audit_append ON public.audit_events FOR INSERT WITH CHECK (((person_id = public.current_person()) AND (public.is_member_of(jurisdiction_id) OR ((category = 'incident.area.revised'::text) AND (incident_id IS NOT NULL) AND (subject_table = 'incident_area_revisions'::text) AND (subject_id = incident_id) AND public.can_revise_incident_area(incident_id) AND (EXISTS ( SELECT 1
   FROM (public.incident_area_revisions a
     JOIN public.incidents i ON ((i.id = a.incident_id)))
  WHERE ((a.incident_id = audit_events.incident_id) AND (i.jurisdiction_id = audit_events.jurisdiction_id) AND (a.created_by = public.current_person()) AND ((a.revision)::text = (audit_events.payload ->> 'revision'::text)) AND (a.reason = (audit_events.payload ->> 'reason'::text)) AND ((a.home_organization_id)::text = (audit_events.payload ->> 'homeOrganizationId'::text)) AND (a.incident_position_title = (audit_events.payload ->> 'incidentPositionTitle'::text)) AND ((a.participation_id)::text = (audit_events.payload ->> 'participationId'::text)))))))));


--
-- Name: audit_events audit_checklist_completion_append; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY audit_checklist_completion_append ON public.audit_events FOR INSERT WITH CHECK (((category = 'checklist.completed'::text) AND (person_id = public.current_person()) AND (incident_id IS NOT NULL) AND (subject_table = 'checklist_items'::text) AND public.can_read_incident(incident_id) AND (EXISTS ( SELECT 1
   FROM (public.checklist_completion_operations op
     JOIN public.checklist_items c ON (((c.id = op.task_id) AND (c.incident_id = op.incident_id))))
  WHERE ((op.actor_person_id = public.current_person()) AND (op.incident_id = audit_events.incident_id) AND (op.task_id = audit_events.subject_id) AND ((op.operation_id)::text = (audit_events.payload ->> 'operationId'::text)) AND (op.request_digest IS NOT NULL) AND ((op.receipt ->> 'operationId'::text) = (op.operation_id)::text) AND ((op.receipt ->> 'taskId'::text) = (op.task_id)::text) AND ((op.receipt ->> 'incidentId'::text) = (op.incident_id)::text) AND (((op.receipt -> 'completedBy'::text) ->> 'personId'::text) = (public.current_person())::text) AND (c.status = 'completed'::text) AND (c.completed_by = public.current_person()) AND ((c.revision)::text = (audit_events.payload ->> 'revision'::text)) AND ((op.receipt ->> 'revision'::text) = (audit_events.payload ->> 'revision'::text)))))));


--
-- Name: audit_events audit_checklist_completion_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY audit_checklist_completion_read ON public.audit_events FOR SELECT USING (((category = 'checklist.completed'::text) AND (person_id = public.current_person()) AND (incident_id IS NOT NULL) AND (subject_table = 'checklist_items'::text) AND public.can_read_incident(incident_id) AND (EXISTS ( SELECT 1
   FROM (public.checklist_completion_operations op
     JOIN public.checklist_items c ON (((c.id = op.task_id) AND (c.incident_id = op.incident_id))))
  WHERE ((op.actor_person_id = public.current_person()) AND (op.incident_id = audit_events.incident_id) AND (op.task_id = audit_events.subject_id) AND ((op.operation_id)::text = (audit_events.payload ->> 'operationId'::text)) AND (op.request_digest IS NOT NULL) AND ((op.receipt ->> 'operationId'::text) = (op.operation_id)::text) AND ((op.receipt ->> 'taskId'::text) = (op.task_id)::text) AND ((op.receipt ->> 'incidentId'::text) = (op.incident_id)::text) AND (((op.receipt -> 'completedBy'::text) ->> 'personId'::text) = (public.current_person())::text) AND (c.status = 'completed'::text) AND (c.completed_by = public.current_person()) AND ((c.revision)::text = (audit_events.payload ->> 'revision'::text)) AND ((op.receipt ->> 'revision'::text) = (audit_events.payload ->> 'revision'::text)))))));


--
-- Name: audit_events audit_checklist_status_append; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY audit_checklist_status_append ON public.audit_events FOR INSERT WITH CHECK (((category = 'checklist.task.updated'::text) AND (person_id = public.current_person()) AND (incident_id IS NOT NULL) AND (subject_table = 'checklist_items'::text) AND ((payload -> 'changed'::text) = '["status"]'::jsonb) AND ((((payload - 'revision'::text) - 'changed'::text) - 'status'::text) = '{}'::jsonb) AND public.can_read_incident(incident_id) AND (EXISTS ( SELECT 1
   FROM ((public.checklist_items c
     JOIN public.incidents i ON ((i.id = c.incident_id)))
     JOIN public.incident_participants ip ON (((ip.id = c.assigned_participant_id) AND (ip.incident_id = c.incident_id))))
  WHERE ((c.id = audit_events.subject_id) AND (c.incident_id = audit_events.incident_id) AND (i.jurisdiction_id = audit_events.jurisdiction_id) AND ((c.revision)::text = (audit_events.payload ->> 'revision'::text)) AND (c.status = (audit_events.payload ->> 'status'::text)) AND (ip.person_id = public.current_person()) AND (ip.revoked_at IS NULL) AND (ip.expires_at > now()) AND (ip.role = ANY (ARRAY['contributor'::text, 'coordinator'::text])) AND public.eligible_incident_person(ip.person_id, ip.organization_id))))));


--
-- Name: audit_events audit_checklist_status_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY audit_checklist_status_read ON public.audit_events FOR SELECT USING (((category = 'checklist.task.updated'::text) AND (person_id = public.current_person()) AND (incident_id IS NOT NULL) AND (subject_table = 'checklist_items'::text) AND ((payload -> 'changed'::text) = '["status"]'::jsonb) AND ((((payload - 'revision'::text) - 'changed'::text) - 'status'::text) = '{}'::jsonb) AND public.can_read_incident(incident_id) AND (EXISTS ( SELECT 1
   FROM ((public.checklist_items c
     JOIN public.incidents i ON ((i.id = c.incident_id)))
     JOIN public.incident_participants ip ON (((ip.id = c.assigned_participant_id) AND (ip.incident_id = c.incident_id))))
  WHERE ((c.id = audit_events.subject_id) AND (c.incident_id = audit_events.incident_id) AND (i.jurisdiction_id = audit_events.jurisdiction_id) AND ((c.revision)::text = (audit_events.payload ->> 'revision'::text)) AND (c.status = (audit_events.payload ->> 'status'::text)) AND (ip.person_id = public.current_person()) AND (ip.revoked_at IS NULL) AND (ip.expires_at > now()) AND (ip.role = ANY (ARRAY['contributor'::text, 'coordinator'::text])) AND public.eligible_incident_person(ip.person_id, ip.organization_id))))));


--
-- Name: audit_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_events audit_incident_board_record_append; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY audit_incident_board_record_append ON public.audit_events FOR INSERT WITH CHECK (((person_id = public.current_person()) AND (incident_id IS NOT NULL) AND public.can_read_incident(incident_id) AND (subject_table = 'board_records'::text) AND (category = ANY (ARRAY['board.record.created'::text, 'board.record.updated'::text])) AND (EXISTS ( SELECT 1
   FROM (public.board_records r
     JOIN public.boards b ON ((b.id = r.board_id)))
  WHERE ((r.id = audit_events.subject_id) AND (r.incident_id = audit_events.incident_id) AND (b.jurisdiction_id = audit_events.jurisdiction_id) AND (public.is_writer_of(b.jurisdiction_id) OR public.has_incident_participation(r.incident_id, 'contributor'::text)) AND (((audit_events.category = 'board.record.created'::text) AND (r.created_by = public.current_person())) OR ((audit_events.category = 'board.record.updated'::text) AND (r.updated_by = public.current_person()))))))));


--
-- Name: audit_events audit_legacy_incident_board_record_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY audit_legacy_incident_board_record_read ON public.audit_events FOR SELECT USING (((incident_id IS NOT NULL) AND public.can_read_incident(incident_id) AND (subject_table = 'board_records'::text) AND (category = 'board.record.created'::text) AND (EXISTS ( SELECT 1
   FROM ((public.board_records r
     JOIN public.boards b ON ((b.id = r.board_id)))
     JOIN public.incident_participants ip ON (((ip.incident_id = audit_events.incident_id) AND (ip.person_id = audit_events.person_id) AND (ip.organization_id = audit_events.jurisdiction_id) AND (ip.role = ANY (ARRAY['contributor'::text, 'coordinator'::text])) AND (ip.created_at <= audit_events.created_at) AND (audit_events.created_at <= ip.expires_at) AND ((ip.revoked_at IS NULL) OR (audit_events.created_at <= ip.revoked_at)))))
  WHERE ((r.id = audit_events.subject_id) AND (r.incident_id = audit_events.incident_id) AND (r.created_by = audit_events.person_id) AND (audit_events.jurisdiction_id <> b.jurisdiction_id) AND ((audit_events.payload ->> 'board'::text) = b.template_key))))));


--
-- Name: audit_events audit_operational_relationship_actor_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY audit_operational_relationship_actor_read ON public.audit_events FOR SELECT USING (((person_id = public.current_person()) AND (category = 'operational.relationship.created'::text) AND (subject_table = 'operational_relationships'::text) AND public.can_read_incident(incident_id) AND (EXISTS ( SELECT 1
   FROM (public.operational_relationships r
     JOIN public.incidents i ON ((i.id = r.incident_id)))
  WHERE ((r.id = audit_events.subject_id) AND (r.incident_id = audit_events.incident_id) AND (i.jurisdiction_id = audit_events.jurisdiction_id) AND (r.created_by = public.current_person()))))));


--
-- Name: audit_events audit_operational_relationship_append; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY audit_operational_relationship_append ON public.audit_events FOR INSERT WITH CHECK (((person_id = public.current_person()) AND (category = 'operational.relationship.created'::text) AND (subject_table = 'operational_relationships'::text) AND public.can_read_incident(incident_id) AND (EXISTS ( SELECT 1
   FROM (public.operational_relationships r
     JOIN public.incidents i ON ((i.id = r.incident_id)))
  WHERE ((r.id = audit_events.subject_id) AND (r.incident_id = audit_events.incident_id) AND (i.jurisdiction_id = audit_events.jurisdiction_id) AND (r.created_by = public.current_person()))))));


--
-- Name: audit_events audit_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY audit_read ON public.audit_events FOR SELECT USING ((public.is_member_of(jurisdiction_id) OR ((category = 'incident.area.revised'::text) AND (person_id = public.current_person()) AND (incident_id IS NOT NULL) AND public.can_read_incident(incident_id))));


--
-- Name: audit_events audit_sync_conflict_append; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY audit_sync_conflict_append ON public.audit_events FOR INSERT WITH CHECK (((category = 'sync.conflict'::text) AND (subject_table = 'board_records'::text) AND (person_id = public.current_person()) AND (incident_id IS NOT NULL) AND public.can_read_incident(incident_id) AND (EXISTS ( SELECT 1
   FROM (public.sync_conflicts c
     JOIN public.boards b ON ((b.id = c.board_id)))
  WHERE ((c.record_id = audit_events.subject_id) AND (c.incident_id = audit_events.incident_id) AND (c.origin_person = public.current_person()) AND (b.jurisdiction_id = audit_events.jurisdiction_id))))));


--
-- Name: audit_events audit_sync_conflict_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY audit_sync_conflict_read ON public.audit_events FOR SELECT USING (((category = 'sync.conflict'::text) AND (subject_table = 'board_records'::text) AND (incident_id IS NOT NULL) AND public.can_read_incident(incident_id) AND (EXISTS ( SELECT 1
   FROM (public.sync_conflicts c
     JOIN public.boards b ON ((b.id = c.board_id)))
  WHERE ((c.record_id = audit_events.subject_id) AND (c.incident_id = audit_events.incident_id) AND (b.jurisdiction_id = audit_events.jurisdiction_id))))));


--
-- Name: audit_events audit_sync_record_append; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY audit_sync_record_append ON public.audit_events FOR INSERT WITH CHECK (((person_id = public.current_person()) AND (incident_id IS NOT NULL) AND public.can_read_incident(incident_id) AND (subject_table = 'board_records'::text) AND (category = ANY (ARRAY['board.record.created'::text, 'board.record.updated'::text])) AND ((payload ->> 'via'::text) = 'sync'::text) AND (EXISTS ( SELECT 1
   FROM (public.board_records r
     JOIN public.boards b ON ((b.id = r.board_id)))
  WHERE ((r.id = audit_events.subject_id) AND (r.incident_id = audit_events.incident_id) AND (b.jurisdiction_id = audit_events.jurisdiction_id) AND (((audit_events.category = 'board.record.created'::text) AND (r.created_by = public.current_person())) OR ((audit_events.category = 'board.record.updated'::text) AND (r.updated_by = public.current_person()))))))));


--
-- Name: audit_events audit_sync_record_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY audit_sync_record_read ON public.audit_events FOR SELECT USING (((incident_id IS NOT NULL) AND public.can_read_incident(incident_id) AND (subject_table = 'board_records'::text) AND (category = ANY (ARRAY['board.record.created'::text, 'board.record.updated'::text])) AND (EXISTS ( SELECT 1
   FROM (public.board_records r
     JOIN public.boards b ON ((b.id = r.board_id)))
  WHERE ((r.id = audit_events.subject_id) AND (r.incident_id = audit_events.incident_id) AND (b.jurisdiction_id = audit_events.jurisdiction_id))))));


--
-- Name: auth_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.auth_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: auth_sessions auth_sessions_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_sessions_read ON public.auth_sessions FOR SELECT USING ((person_id = public.current_person()));


--
-- Name: auth_sessions auth_sessions_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_sessions_update ON public.auth_sessions FOR UPDATE USING ((person_id = public.current_person())) WITH CHECK ((person_id = public.current_person()));


--
-- Name: badges; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.badges ENABLE ROW LEVEL SECURITY;

--
-- Name: badges badges_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY badges_read ON public.badges FOR SELECT USING (public.is_member_of(jurisdiction_id));


--
-- Name: badges badges_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY badges_update ON public.badges FOR UPDATE USING (public.is_admin_of(jurisdiction_id));


--
-- Name: badges badges_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY badges_write ON public.badges FOR INSERT WITH CHECK (public.is_admin_of(jurisdiction_id));


--
-- Name: damage_baselines baselines_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY baselines_read ON public.damage_baselines FOR SELECT USING (public.is_member_of(jurisdiction_id));


--
-- Name: damage_baselines baselines_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY baselines_write ON public.damage_baselines FOR INSERT WITH CHECK (public.is_admin_of(jurisdiction_id));


--
-- Name: board_records; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.board_records ENABLE ROW LEVEL SECURITY;

--
-- Name: board_templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.board_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: board_workflow_approvals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.board_workflow_approvals ENABLE ROW LEVEL SECURITY;

--
-- Name: board_workflow_approvals board_workflow_approvals_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY board_workflow_approvals_insert ON public.board_workflow_approvals FOR INSERT WITH CHECK (((actor_person_id = public.current_person()) AND (EXISTS ( SELECT 1
   FROM public.board_workflow_instances w
  WHERE ((w.record_id = board_workflow_approvals.record_id) AND (w.board_id = board_workflow_approvals.board_id) AND (w.jurisdiction_id = board_workflow_approvals.jurisdiction_id) AND (NOT (w.incident_id IS DISTINCT FROM board_workflow_approvals.incident_id)))))));


--
-- Name: board_workflow_approvals board_workflow_approvals_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY board_workflow_approvals_read ON public.board_workflow_approvals FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.board_workflow_instances w
  WHERE (w.record_id = board_workflow_approvals.record_id))));


--
-- Name: board_workflow_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.board_workflow_history ENABLE ROW LEVEL SECURITY;

--
-- Name: board_workflow_history board_workflow_history_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY board_workflow_history_insert ON public.board_workflow_history FOR INSERT WITH CHECK (((actor_person_id = public.current_person()) AND (EXISTS ( SELECT 1
   FROM public.board_workflow_instances w
  WHERE ((w.record_id = board_workflow_history.record_id) AND (w.board_id = board_workflow_history.board_id) AND (w.jurisdiction_id = board_workflow_history.jurisdiction_id) AND (NOT (w.incident_id IS DISTINCT FROM board_workflow_history.incident_id)))))));


--
-- Name: board_workflow_history board_workflow_history_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY board_workflow_history_read ON public.board_workflow_history FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.board_workflow_instances w
  WHERE (w.record_id = board_workflow_history.record_id))));


--
-- Name: board_workflow_idempotency; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.board_workflow_idempotency ENABLE ROW LEVEL SECURITY;

--
-- Name: board_workflow_idempotency board_workflow_idempotency_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY board_workflow_idempotency_insert ON public.board_workflow_idempotency FOR INSERT WITH CHECK (((actor_person_id = public.current_person()) AND (EXISTS ( SELECT 1
   FROM public.board_workflow_instances w
  WHERE ((w.record_id = board_workflow_idempotency.record_id) AND (w.board_id = board_workflow_idempotency.board_id) AND (w.jurisdiction_id = board_workflow_idempotency.jurisdiction_id) AND (NOT (w.incident_id IS DISTINCT FROM board_workflow_idempotency.incident_id)))))));


--
-- Name: board_workflow_idempotency board_workflow_idempotency_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY board_workflow_idempotency_read ON public.board_workflow_idempotency FOR SELECT USING (((actor_person_id = public.current_person()) AND (EXISTS ( SELECT 1
   FROM public.board_workflow_instances w
  WHERE (w.record_id = board_workflow_idempotency.record_id)))));


--
-- Name: board_workflow_instances; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.board_workflow_instances ENABLE ROW LEVEL SECURITY;

--
-- Name: board_workflow_instances board_workflow_instances_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY board_workflow_instances_insert ON public.board_workflow_instances FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM (public.board_records r
     JOIN public.boards b ON ((b.id = r.board_id)))
  WHERE ((r.id = board_workflow_instances.record_id) AND (r.board_id = board_workflow_instances.board_id) AND (b.jurisdiction_id = board_workflow_instances.jurisdiction_id) AND (NOT (r.incident_id IS DISTINCT FROM board_workflow_instances.incident_id)) AND (public.is_writer_of(b.jurisdiction_id) OR ((r.incident_id IS NOT NULL) AND public.has_incident_participation(r.incident_id, 'contributor'::text)))))));


--
-- Name: board_workflow_instances board_workflow_instances_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY board_workflow_instances_read ON public.board_workflow_instances FOR SELECT USING ((EXISTS ( SELECT 1
   FROM (public.board_records r
     JOIN public.boards b ON ((b.id = r.board_id)))
  WHERE ((r.id = board_workflow_instances.record_id) AND (r.board_id = board_workflow_instances.board_id) AND (b.jurisdiction_id = board_workflow_instances.jurisdiction_id) AND (NOT (r.incident_id IS DISTINCT FROM board_workflow_instances.incident_id)) AND (public.is_member_of(b.jurisdiction_id) OR public.has_guest_scope(b.jurisdiction_id, (('board:'::text || (b.id)::text) || ':read'::text)) OR ((r.incident_id IS NOT NULL) AND public.can_read_incident(r.incident_id)))))));


--
-- Name: board_workflow_instances board_workflow_instances_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY board_workflow_instances_update ON public.board_workflow_instances FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM (public.board_records r
     JOIN public.boards b ON ((b.id = r.board_id)))
  WHERE ((r.id = board_workflow_instances.record_id) AND (r.board_id = board_workflow_instances.board_id) AND (b.jurisdiction_id = board_workflow_instances.jurisdiction_id) AND (NOT (r.incident_id IS DISTINCT FROM board_workflow_instances.incident_id)) AND (public.is_writer_of(b.jurisdiction_id) OR ((r.incident_id IS NOT NULL) AND public.has_incident_participation(r.incident_id, 'contributor'::text)))))));


--
-- Name: boards; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.boards ENABLE ROW LEVEL SECURITY;

--
-- Name: boards boards_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY boards_read ON public.boards FOR SELECT USING ((public.is_member_of(jurisdiction_id) OR public.has_guest_scope(jurisdiction_id, (('board:'::text || (id)::text) || ':read'::text)) OR (EXISTS ( SELECT 1
   FROM public.incident_boards ib
  WHERE ((ib.board_id = boards.id) AND public.can_read_incident(ib.incident_id))))));


--
-- Name: boards boards_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY boards_update ON public.boards FOR UPDATE USING (public.is_admin_of(jurisdiction_id));


--
-- Name: boards boards_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY boards_write ON public.boards FOR INSERT WITH CHECK (public.is_admin_of(jurisdiction_id));


--
-- Name: briefings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.briefings ENABLE ROW LEVEL SECURITY;

--
-- Name: briefings briefings_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY briefings_read ON public.briefings FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.incidents i
  WHERE ((i.id = briefings.incident_id) AND public.is_member_of(i.jurisdiction_id)))));


--
-- Name: briefings briefings_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY briefings_update ON public.briefings FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM public.incidents i
  WHERE ((i.id = briefings.incident_id) AND public.is_member_of(i.jurisdiction_id)))));


--
-- Name: briefings briefings_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY briefings_write ON public.briefings FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.incidents i
  WHERE ((i.id = briefings.incident_id) AND public.is_member_of(i.jurisdiction_id)))));


--
-- Name: corrective_actions ca_assignee_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ca_assignee_read ON public.corrective_actions FOR SELECT USING (((owner_participant IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM public.incident_participants ip
  WHERE ((ip.id = corrective_actions.owner_participant) AND (ip.incident_id = corrective_actions.incident_id) AND (ip.person_id = public.current_person()) AND (ip.revoked_at IS NULL) AND (ip.expires_at > now()) AND public.eligible_incident_person(ip.person_id, ip.organization_id))))));


--
-- Name: corrective_actions ca_assignee_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ca_assignee_update ON public.corrective_actions FOR UPDATE USING (((owner_participant IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM public.incident_participants ip
  WHERE ((ip.id = corrective_actions.owner_participant) AND (ip.incident_id = corrective_actions.incident_id) AND (ip.person_id = public.current_person()) AND (ip.revoked_at IS NULL) AND (ip.expires_at > now()) AND public.eligible_incident_person(ip.person_id, ip.organization_id)))))) WITH CHECK (((owner_participant IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM public.incident_participants ip
  WHERE ((ip.id = corrective_actions.owner_participant) AND (ip.incident_id = corrective_actions.incident_id) AND (ip.person_id = public.current_person()) AND (ip.revoked_at IS NULL) AND (ip.expires_at > now()) AND public.eligible_incident_person(ip.person_id, ip.organization_id))))));


--
-- Name: corrective_actions ca_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ca_read ON public.corrective_actions FOR SELECT USING (public.is_member_of(jurisdiction_id));


--
-- Name: corrective_actions ca_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ca_update ON public.corrective_actions FOR UPDATE USING (public.is_member_of(jurisdiction_id));


--
-- Name: corrective_actions ca_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ca_write ON public.corrective_actions FOR INSERT WITH CHECK (public.is_member_of(jurisdiction_id));


--
-- Name: cap_alert_reviews; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cap_alert_reviews ENABLE ROW LEVEL SECURITY;

--
-- Name: cap_alert_reviews cap_alert_reviews_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cap_alert_reviews_insert ON public.cap_alert_reviews FOR INSERT WITH CHECK ((public.is_writer_of(jurisdiction_id) AND (actor_person_id = public.current_person()) AND (EXISTS ( SELECT 1
   FROM public.cap_alerts a
  WHERE ((a.id = cap_alert_reviews.alert_id) AND (a.jurisdiction_id = cap_alert_reviews.jurisdiction_id))))));


--
-- Name: cap_alert_reviews cap_alert_reviews_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cap_alert_reviews_read ON public.cap_alert_reviews FOR SELECT USING (public.is_member_of(jurisdiction_id));


--
-- Name: cap_alerts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cap_alerts ENABLE ROW LEVEL SECURITY;

--
-- Name: cap_alerts cap_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cap_read ON public.cap_alerts FOR SELECT USING (public.is_member_of(jurisdiction_id));


--
-- Name: cap_alerts cap_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cap_write ON public.cap_alerts FOR INSERT WITH CHECK (public.is_writer_of(jurisdiction_id));


--
-- Name: staff_checkins checkins_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY checkins_read ON public.staff_checkins FOR SELECT USING (public.is_member_of(jurisdiction_id));


--
-- Name: staff_checkins checkins_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY checkins_update ON public.staff_checkins FOR UPDATE USING (public.is_writer_of(jurisdiction_id));


--
-- Name: staff_checkins checkins_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY checkins_write ON public.staff_checkins FOR INSERT WITH CHECK (public.is_writer_of(jurisdiction_id));


--
-- Name: checklist_completion_operations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.checklist_completion_operations ENABLE ROW LEVEL SECURITY;

--
-- Name: checklist_completion_operations checklist_completion_operations_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY checklist_completion_operations_insert ON public.checklist_completion_operations FOR INSERT WITH CHECK (((actor_person_id = public.current_person()) AND public.can_read_incident(incident_id) AND ((receipt ->> 'operationId'::text) = (operation_id)::text) AND ((receipt ->> 'taskId'::text) = (task_id)::text) AND ((receipt ->> 'incidentId'::text) = (incident_id)::text) AND ((receipt ->> 'status'::text) = 'completed'::text) AND (((receipt -> 'completedBy'::text) ->> 'personId'::text) = (public.current_person())::text) AND ((receipt -> 'completedBy'::text) ? 'positionId'::text) AND ((receipt -> 'completedBy'::text) ? 'participationId'::text) AND (EXISTS ( SELECT 1
   FROM public.checklist_items c
  WHERE ((c.id = checklist_completion_operations.task_id) AND (c.incident_id = checklist_completion_operations.incident_id) AND (c.status = 'completed'::text) AND (c.completed_by = public.current_person()) AND ((c.revision)::text = (checklist_completion_operations.receipt ->> 'revision'::text)) AND (date_trunc('milliseconds'::text, c.completed_at) = ((checklist_completion_operations.receipt ->> 'completedAt'::text))::timestamp with time zone) AND ((c.completed_by_organization_id)::text = ((checklist_completion_operations.receipt -> 'completedBy'::text) ->> 'organizationId'::text)) AND (NOT ((c.completed_by_position)::text IS DISTINCT FROM ((checklist_completion_operations.receipt -> 'completedBy'::text) ->> 'positionId'::text))) AND (NOT ((c.completed_by_participation_id)::text IS DISTINCT FROM ((checklist_completion_operations.receipt -> 'completedBy'::text) ->> 'participationId'::text))) AND (c.completed_as_title = ((checklist_completion_operations.receipt -> 'completedBy'::text) ->> 'title'::text)))))));


--
-- Name: checklist_completion_operations checklist_completion_operations_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY checklist_completion_operations_read ON public.checklist_completion_operations FOR SELECT USING (((actor_person_id = public.current_person()) AND public.can_read_incident(incident_id)));


--
-- Name: checklist_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.checklist_items ENABLE ROW LEVEL SECURITY;

--
-- Name: checklist_items checklist_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY checklist_read ON public.checklist_items FOR SELECT USING (public.can_read_incident(incident_id));


--
-- Name: checklist_task_dependencies; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.checklist_task_dependencies ENABLE ROW LEVEL SECURITY;

--
-- Name: checklist_task_dependencies checklist_task_dependencies_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY checklist_task_dependencies_delete ON public.checklist_task_dependencies FOR DELETE USING ((EXISTS ( SELECT 1
   FROM (public.checklist_items task
     JOIN public.incidents i ON ((i.id = task.incident_id)))
  WHERE ((task.id = checklist_task_dependencies.task_id) AND public.is_admin_of(i.jurisdiction_id)))));


--
-- Name: checklist_task_dependencies checklist_task_dependencies_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY checklist_task_dependencies_insert ON public.checklist_task_dependencies FOR INSERT WITH CHECK (((EXISTS ( SELECT 1
   FROM (public.checklist_items task
     JOIN public.incidents i ON ((i.id = task.incident_id)))
  WHERE ((task.id = checklist_task_dependencies.task_id) AND public.is_admin_of(i.jurisdiction_id)))) AND (EXISTS ( SELECT 1
   FROM (public.checklist_items task
     JOIN public.checklist_items prerequisite ON ((prerequisite.id = checklist_task_dependencies.prerequisite_task_id)))
  WHERE ((task.id = checklist_task_dependencies.task_id) AND (task.incident_id = prerequisite.incident_id))))));


--
-- Name: checklist_task_dependencies checklist_task_dependencies_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY checklist_task_dependencies_read ON public.checklist_task_dependencies FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.checklist_items task
  WHERE ((task.id = checklist_task_dependencies.task_id) AND public.can_read_incident(task.incident_id)))));


--
-- Name: checklist_items checklist_task_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY checklist_task_update ON public.checklist_items FOR UPDATE USING (public.checklist_actor_can_update(checklist_items.*)) WITH CHECK (public.checklist_actor_can_update(checklist_items.*));


--
-- Name: checklist_items checklist_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY checklist_write ON public.checklist_items FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.incidents i
  WHERE ((i.id = checklist_items.incident_id) AND public.is_admin_of(i.jurisdiction_id)))));


--
-- Name: collab_backends; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.collab_backends ENABLE ROW LEVEL SECURITY;

--
-- Name: collab_backends collab_backends_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY collab_backends_insert ON public.collab_backends FOR INSERT WITH CHECK (public.is_admin_of(jurisdiction_id));


--
-- Name: collab_backends collab_backends_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY collab_backends_read ON public.collab_backends FOR SELECT USING (public.is_member_of(jurisdiction_id));


--
-- Name: collab_backends collab_backends_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY collab_backends_update ON public.collab_backends FOR UPDATE USING (public.is_admin_of(jurisdiction_id));


--
-- Name: collab_channel_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.collab_channel_members ENABLE ROW LEVEL SECURITY;

--
-- Name: collab_channels; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.collab_channels ENABLE ROW LEVEL SECURITY;

--
-- Name: collab_channels collab_channels_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY collab_channels_read ON public.collab_channels FOR SELECT USING ((EXISTS ( SELECT 1
   FROM (public.collab_spaces s
     JOIN public.incidents i ON ((i.id = s.incident_id)))
  WHERE ((s.id = collab_channels.space_id) AND public.is_member_of(i.jurisdiction_id)))));


--
-- Name: collab_channels collab_channels_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY collab_channels_update ON public.collab_channels FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM (public.collab_spaces s
     JOIN public.incidents i ON ((i.id = s.incident_id)))
  WHERE ((s.id = collab_channels.space_id) AND public.is_admin_of(i.jurisdiction_id)))));


--
-- Name: collab_channels collab_channels_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY collab_channels_write ON public.collab_channels FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM (public.collab_spaces s
     JOIN public.incidents i ON ((i.id = s.incident_id)))
  WHERE ((s.id = collab_channels.space_id) AND public.is_admin_of(i.jurisdiction_id)))));


--
-- Name: collab_channel_members collab_members_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY collab_members_delete ON public.collab_channel_members FOR DELETE USING ((EXISTS ( SELECT 1
   FROM ((public.collab_channels c
     JOIN public.collab_spaces s ON ((s.id = c.space_id)))
     JOIN public.incidents i ON ((i.id = s.incident_id)))
  WHERE ((c.id = collab_channel_members.channel_id) AND public.is_admin_of(i.jurisdiction_id)))));


--
-- Name: collab_channel_members collab_members_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY collab_members_read ON public.collab_channel_members FOR SELECT USING ((EXISTS ( SELECT 1
   FROM ((public.collab_channels c
     JOIN public.collab_spaces s ON ((s.id = c.space_id)))
     JOIN public.incidents i ON ((i.id = s.incident_id)))
  WHERE ((c.id = collab_channel_members.channel_id) AND public.is_member_of(i.jurisdiction_id)))));


--
-- Name: collab_channel_members collab_members_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY collab_members_write ON public.collab_channel_members FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM ((public.collab_channels c
     JOIN public.collab_spaces s ON ((s.id = c.space_id)))
     JOIN public.incidents i ON ((i.id = s.incident_id)))
  WHERE ((c.id = collab_channel_members.channel_id) AND public.is_admin_of(i.jurisdiction_id)))));


--
-- Name: collab_spaces; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.collab_spaces ENABLE ROW LEVEL SECURITY;

--
-- Name: collab_spaces collab_spaces_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY collab_spaces_read ON public.collab_spaces FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.incidents i
  WHERE ((i.id = collab_spaces.incident_id) AND public.is_member_of(i.jurisdiction_id)))));


--
-- Name: collab_spaces collab_spaces_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY collab_spaces_update ON public.collab_spaces FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM public.incidents i
  WHERE ((i.id = collab_spaces.incident_id) AND public.is_admin_of(i.jurisdiction_id)))));


--
-- Name: collab_spaces collab_spaces_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY collab_spaces_write ON public.collab_spaces FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.incidents i
  WHERE ((i.id = collab_spaces.incident_id) AND public.is_admin_of(i.jurisdiction_id)))));


--
-- Name: corrective_actions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.corrective_actions ENABLE ROW LEVEL SECURITY;

--
-- Name: damage_assessments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.damage_assessments ENABLE ROW LEVEL SECURITY;

--
-- Name: damage_baselines; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.damage_baselines ENABLE ROW LEVEL SECURITY;

--
-- Name: damage_intake; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.damage_intake ENABLE ROW LEVEL SECURITY;

--
-- Name: dashboard_templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.dashboard_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: dashboard_templates dashboard_templates_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY dashboard_templates_read ON public.dashboard_templates FOR SELECT USING ((public.current_person() IS NOT NULL));


--
-- Name: dashboard_templates dashboard_templates_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY dashboard_templates_write ON public.dashboard_templates FOR INSERT WITH CHECK (public.is_instance_admin());


--
-- Name: dashboards; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.dashboards ENABLE ROW LEVEL SECURITY;

--
-- Name: dashboards dashboards_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY dashboards_read ON public.dashboards FOR SELECT USING ((public.is_member_of(jurisdiction_id) OR (EXISTS ( SELECT 1
   FROM public.incidents i
  WHERE (((i.id)::text = current_setting('app.incident_id'::text, true)) AND (i.jurisdiction_id = dashboards.jurisdiction_id) AND public.can_read_incident(i.id))))));


--
-- Name: dashboards dashboards_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY dashboards_update ON public.dashboards FOR UPDATE USING (public.is_admin_of(jurisdiction_id));


--
-- Name: dashboards dashboards_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY dashboards_write ON public.dashboards FOR INSERT WITH CHECK (public.is_admin_of(jurisdiction_id));


--
-- Name: data_pack_datasets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.data_pack_datasets ENABLE ROW LEVEL SECURITY;

--
-- Name: data_pack_datasets data_pack_datasets_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY data_pack_datasets_insert ON public.data_pack_datasets FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM (public.data_packs p
     JOIN public.incidents i ON ((i.id = p.incident_id)))
  WHERE ((p.id = data_pack_datasets.pack_id) AND (i.closed_at IS NULL) AND (public.is_admin_of(i.jurisdiction_id) OR (EXISTS ( SELECT 1
           FROM public.incident_participants ip
          WHERE ((ip.incident_id = p.incident_id) AND (ip.person_id = public.current_person()) AND (ip.organization_id = p.organization_id) AND (ip.role = 'coordinator'::text) AND (ip.revoked_at IS NULL) AND (ip.expires_at > now())))))))));


--
-- Name: data_pack_datasets data_pack_datasets_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY data_pack_datasets_read ON public.data_pack_datasets FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.data_packs p
  WHERE ((p.id = data_pack_datasets.pack_id) AND public.can_read_incident(p.incident_id)))));


--
-- Name: data_pack_datasets data_pack_datasets_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY data_pack_datasets_update ON public.data_pack_datasets FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM (public.data_packs p
     JOIN public.incidents i ON ((i.id = p.incident_id)))
  WHERE ((p.id = data_pack_datasets.pack_id) AND (public.is_writer_of(i.jurisdiction_id) OR public.has_incident_participation(p.incident_id, 'contributor'::text)))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM (public.data_packs p
     JOIN public.incidents i ON ((i.id = p.incident_id)))
  WHERE ((p.id = data_pack_datasets.pack_id) AND (public.is_writer_of(i.jurisdiction_id) OR public.has_incident_participation(p.incident_id, 'contributor'::text))))));


--
-- Name: data_pack_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.data_pack_items ENABLE ROW LEVEL SECURITY;

--
-- Name: data_packs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.data_packs ENABLE ROW LEVEL SECURITY;

--
-- Name: data_packs data_packs_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY data_packs_insert ON public.data_packs FOR INSERT WITH CHECK (((created_by = public.current_person()) AND (EXISTS ( SELECT 1
   FROM public.incidents i
  WHERE ((i.id = data_packs.incident_id) AND (i.closed_at IS NULL) AND (public.is_admin_of(i.jurisdiction_id) OR (EXISTS ( SELECT 1
           FROM public.incident_participants ip
          WHERE ((ip.incident_id = data_packs.incident_id) AND (ip.person_id = public.current_person()) AND (ip.organization_id = data_packs.organization_id) AND (ip.role = 'coordinator'::text) AND (ip.revoked_at IS NULL) AND (ip.expires_at > now()) AND public.eligible_incident_person(ip.person_id, ip.organization_id))))))))));


--
-- Name: data_packs data_packs_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY data_packs_read ON public.data_packs FOR SELECT USING (public.can_read_incident(incident_id));


--
-- Name: data_pack_items dpi_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY dpi_delete ON public.data_pack_items FOR DELETE USING ((EXISTS ( SELECT 1
   FROM public.incidents i
  WHERE ((i.id = data_pack_items.incident_id) AND (public.is_writer_of(i.jurisdiction_id) OR public.has_incident_participation(data_pack_items.incident_id, 'contributor'::text))))));


--
-- Name: data_pack_items dpi_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY dpi_insert ON public.data_pack_items FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.incidents i
  WHERE ((i.id = data_pack_items.incident_id) AND (public.is_writer_of(i.jurisdiction_id) OR public.has_incident_participation(data_pack_items.incident_id, 'contributor'::text))))));


--
-- Name: data_pack_items dpi_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY dpi_read ON public.data_pack_items FOR SELECT USING (public.can_read_incident(incident_id));


--
-- Name: data_pack_items dpi_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY dpi_update ON public.data_pack_items FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM public.incidents i
  WHERE ((i.id = data_pack_items.incident_id) AND (public.is_writer_of(i.jurisdiction_id) OR public.has_incident_participation(data_pack_items.incident_id, 'contributor'::text)))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.incidents i
  WHERE ((i.id = data_pack_items.incident_id) AND (public.is_writer_of(i.jurisdiction_id) OR public.has_incident_participation(data_pack_items.incident_id, 'contributor'::text))))));


--
-- Name: facilities; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.facilities ENABLE ROW LEVEL SECURITY;

--
-- Name: facilities facilities_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY facilities_read ON public.facilities FOR SELECT USING (public.is_member_of(jurisdiction_id));


--
-- Name: facilities facilities_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY facilities_write ON public.facilities FOR INSERT WITH CHECK (public.is_writer_of(jurisdiction_id));


--
-- Name: facility_status_reports; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.facility_status_reports ENABLE ROW LEVEL SECURITY;

--
-- Name: federation_outbox; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.federation_outbox ENABLE ROW LEVEL SECURITY;

--
-- Name: feed_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.feed_items ENABLE ROW LEVEL SECURITY;

--
-- Name: feed_items feed_items_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY feed_items_delete ON public.feed_items FOR DELETE USING ((EXISTS ( SELECT 1
   FROM public.feeds f
  WHERE ((f.id = feed_items.feed_id) AND public.is_admin_of(f.jurisdiction_id)))));


--
-- Name: feed_items feed_items_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY feed_items_read ON public.feed_items FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.feeds f
  WHERE ((f.id = feed_items.feed_id) AND public.is_member_of(f.jurisdiction_id)))));


--
-- Name: feed_items feed_items_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY feed_items_update ON public.feed_items FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM public.feeds f
  WHERE ((f.id = feed_items.feed_id) AND public.is_admin_of(f.jurisdiction_id)))));


--
-- Name: feed_items feed_items_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY feed_items_write ON public.feed_items FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.feeds f
  WHERE ((f.id = feed_items.feed_id) AND public.is_admin_of(f.jurisdiction_id)))));


--
-- Name: feeds; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.feeds ENABLE ROW LEVEL SECURITY;

--
-- Name: feeds feeds_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY feeds_read ON public.feeds FOR SELECT USING ((public.is_member_of(jurisdiction_id) OR (public.current_person() IS NULL)));


--
-- Name: feeds feeds_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY feeds_update ON public.feeds FOR UPDATE USING (public.is_admin_of(jurisdiction_id));


--
-- Name: feeds feeds_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY feeds_write ON public.feeds FOR INSERT WITH CHECK (public.is_admin_of(jurisdiction_id));


--
-- Name: files; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.files ENABLE ROW LEVEL SECURITY;

--
-- Name: files files_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY files_read ON public.files FOR SELECT USING (public.is_member_of(jurisdiction_id));


--
-- Name: files files_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY files_write ON public.files FOR INSERT WITH CHECK (((uploaded_by = public.current_person()) AND public.is_writer_of(jurisdiction_id)));


--
-- Name: form_definitions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.form_definitions ENABLE ROW LEVEL SECURITY;

--
-- Name: form_definitions forms_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY forms_read ON public.form_definitions FOR SELECT USING (public.is_member_of(jurisdiction_id));


--
-- Name: form_definitions forms_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY forms_write ON public.form_definitions FOR INSERT WITH CHECK (public.is_admin_of(jurisdiction_id));


--
-- Name: facility_status_reports fsr_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY fsr_read ON public.facility_status_reports FOR SELECT USING (public.is_member_of(jurisdiction_id));


--
-- Name: facility_status_reports fsr_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY fsr_write ON public.facility_status_reports FOR INSERT WITH CHECK (public.is_writer_of(jurisdiction_id));


--
-- Name: guest_grants; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.guest_grants ENABLE ROW LEVEL SECURITY;

--
-- Name: guest_grants guests_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY guests_read ON public.guest_grants FOR SELECT USING (((person_id = public.current_person()) OR public.is_admin_of(jurisdiction_id)));


--
-- Name: guest_grants guests_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY guests_update ON public.guest_grants FOR UPDATE USING (public.is_admin_of(jurisdiction_id));


--
-- Name: guest_grants guests_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY guests_write ON public.guest_grants FOR INSERT WITH CHECK (public.is_admin_of(jurisdiction_id));


--
-- Name: iaps; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.iaps ENABLE ROW LEVEL SECURITY;

--
-- Name: iaps iaps_attributed_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY iaps_attributed_insert ON public.iaps FOR INSERT WITH CHECK (((prepared_by = public.current_person()) AND (((prepared_participation_id IS NULL) AND (EXISTS ( SELECT 1
   FROM public.incidents i
  WHERE ((i.id = iaps.incident_id) AND (iaps.prepared_organization_id = i.jurisdiction_id) AND public.is_writer_of(i.jurisdiction_id))))) OR (EXISTS ( SELECT 1
   FROM public.incident_participants ip
  WHERE ((ip.id = iaps.prepared_participation_id) AND (ip.incident_id = ip.incident_id) AND (ip.person_id = public.current_person()) AND (ip.organization_id = iaps.prepared_organization_id) AND (ip.role = ANY (ARRAY['contributor'::text, 'coordinator'::text])) AND (ip.revoked_at IS NULL) AND (ip.expires_at > now()) AND public.eligible_incident_person(ip.person_id, ip.organization_id)))))));


--
-- Name: iaps iaps_authorized_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY iaps_authorized_read ON public.iaps FOR SELECT USING (((EXISTS ( SELECT 1
   FROM public.incidents i
  WHERE ((i.id = iaps.incident_id) AND public.is_member_of(i.jurisdiction_id)))) OR ((prepared_by = public.current_person()) AND (EXISTS ( SELECT 1
   FROM public.incident_participants ip
  WHERE ((ip.id = iaps.prepared_participation_id) AND (ip.incident_id = ip.incident_id) AND (ip.person_id = public.current_person()) AND (ip.role = ANY (ARRAY['contributor'::text, 'coordinator'::text])) AND (ip.revoked_at IS NULL) AND (ip.expires_at > now()) AND public.eligible_incident_person(ip.person_id, ip.organization_id)))))));


--
-- Name: iaps iaps_bounded_transition_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY iaps_bounded_transition_update ON public.iaps FOR UPDATE USING (((EXISTS ( SELECT 1
   FROM public.incidents i
  WHERE ((i.id = iaps.incident_id) AND public.is_writer_of(i.jurisdiction_id)))) OR ((prepared_by = public.current_person()) AND (EXISTS ( SELECT 1
   FROM public.incident_participants ip
  WHERE ((ip.id = iaps.prepared_participation_id) AND (ip.incident_id = ip.incident_id) AND (ip.person_id = public.current_person()) AND (ip.role = ANY (ARRAY['contributor'::text, 'coordinator'::text])) AND (ip.revoked_at IS NULL) AND (ip.expires_at > now()) AND public.eligible_incident_person(ip.person_id, ip.organization_id))))))) WITH CHECK (((EXISTS ( SELECT 1
   FROM public.incidents i
  WHERE ((i.id = iaps.incident_id) AND public.is_writer_of(i.jurisdiction_id)))) OR ((prepared_by = public.current_person()) AND (EXISTS ( SELECT 1
   FROM public.incident_participants ip
  WHERE ((ip.id = iaps.prepared_participation_id) AND (ip.incident_id = ip.incident_id) AND (ip.person_id = public.current_person()) AND (ip.role = ANY (ARRAY['contributor'::text, 'coordinator'::text])) AND (ip.revoked_at IS NULL) AND (ip.expires_at > now()) AND public.eligible_incident_person(ip.person_id, ip.organization_id)))))));


--
-- Name: incident_area_revisions incident_area_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY incident_area_insert ON public.incident_area_revisions FOR INSERT WITH CHECK (((created_by = public.current_person()) AND public.can_revise_incident_area(incident_id) AND (((participation_id IS NULL) AND (EXISTS ( SELECT 1
   FROM public.incidents i
  WHERE ((i.id = incident_area_revisions.incident_id) AND public.is_admin_of(i.jurisdiction_id) AND (incident_area_revisions.home_organization_id = i.jurisdiction_id) AND (((incident_area_revisions.position_id IS NULL) AND (incident_area_revisions.incident_position_title IS NULL)) OR (EXISTS ( SELECT 1
           FROM (public.auth_sessions s
             JOIN public.positions p ON ((p.id = s.active_position_id)))
          WHERE ((s.person_id = public.current_person()) AND (s.ended_at IS NULL) AND (s.active_position_id = incident_area_revisions.position_id) AND (p.jurisdiction_id = i.jurisdiction_id) AND (p.title = incident_area_revisions.incident_position_title))))))))) OR ((position_id IS NULL) AND (EXISTS ( SELECT 1
   FROM public.incident_participants ip
  WHERE ((ip.id = incident_area_revisions.participation_id) AND (ip.incident_id = incident_area_revisions.incident_id) AND (ip.person_id = public.current_person()) AND (ip.organization_id = incident_area_revisions.home_organization_id) AND (ip.incident_position_title = incident_area_revisions.incident_position_title) AND (ip.role = 'coordinator'::text) AND (ip.revoked_at IS NULL) AND (ip.expires_at > now()) AND public.eligible_incident_person(ip.person_id, ip.organization_id))))))));


--
-- Name: incident_area_revisions incident_area_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY incident_area_read ON public.incident_area_revisions FOR SELECT USING (public.can_read_incident(incident_id));


--
-- Name: incident_area_revisions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.incident_area_revisions ENABLE ROW LEVEL SECURITY;

--
-- Name: incident_boards; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.incident_boards ENABLE ROW LEVEL SECURITY;

--
-- Name: incident_boards incident_boards_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY incident_boards_read ON public.incident_boards FOR SELECT USING (public.can_read_incident(incident_id));


--
-- Name: incident_boards incident_boards_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY incident_boards_write ON public.incident_boards FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.incidents i
  WHERE ((i.id = incident_boards.incident_id) AND public.is_admin_of(i.jurisdiction_id)))));


--
-- Name: incident_libraries; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.incident_libraries ENABLE ROW LEVEL SECURITY;

--
-- Name: incident_libraries incident_libraries_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY incident_libraries_read ON public.incident_libraries FOR SELECT USING (public.can_read_incident(incident_id));


--
-- Name: incident_libraries incident_libraries_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY incident_libraries_write ON public.incident_libraries FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.incidents i
  WHERE ((i.id = incident_libraries.incident_id) AND public.is_admin_of(i.jurisdiction_id)))));


--
-- Name: incident_participants; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.incident_participants ENABLE ROW LEVEL SECURITY;

--
-- Name: incident_positions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.incident_positions ENABLE ROW LEVEL SECURITY;

--
-- Name: incident_positions incident_positions_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY incident_positions_read ON public.incident_positions FOR SELECT USING (public.can_read_incident(incident_id));


--
-- Name: incident_positions incident_positions_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY incident_positions_write ON public.incident_positions FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.incidents i
  WHERE ((i.id = incident_positions.incident_id) AND public.is_admin_of(i.jurisdiction_id)))));


--
-- Name: incident_templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.incident_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: incident_templates incident_templates_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY incident_templates_read ON public.incident_templates FOR SELECT USING ((public.current_person() IS NOT NULL));


--
-- Name: incident_templates incident_templates_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY incident_templates_write ON public.incident_templates FOR INSERT WITH CHECK (public.is_instance_admin());


--
-- Name: incidents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.incidents ENABLE ROW LEVEL SECURITY;

--
-- Name: incidents incidents_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY incidents_read ON public.incidents FOR SELECT USING ((public.is_member_of(jurisdiction_id) OR public.has_incident_participation(id)));


--
-- Name: incidents incidents_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY incidents_update ON public.incidents FOR UPDATE USING (public.is_admin_of(jurisdiction_id));


--
-- Name: incidents incidents_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY incidents_write ON public.incidents FOR INSERT WITH CHECK (public.is_admin_of(jurisdiction_id));


--
-- Name: damage_intake intake_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY intake_read ON public.damage_intake FOR SELECT USING ((public.is_member_of(jurisdiction_id) OR (public.current_person() IS NULL)));


--
-- Name: damage_intake intake_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY intake_update ON public.damage_intake FOR UPDATE USING (public.is_admin_of(jurisdiction_id));


--
-- Name: damage_intake intake_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY intake_write ON public.damage_intake FOR INSERT WITH CHECK (public.is_admin_of(jurisdiction_id));


--
-- Name: ipaws_config; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ipaws_config ENABLE ROW LEVEL SECURITY;

--
-- Name: ipaws_config ipaws_config_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ipaws_config_insert ON public.ipaws_config FOR INSERT WITH CHECK (public.is_admin_of(jurisdiction_id));


--
-- Name: ipaws_config ipaws_config_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ipaws_config_read ON public.ipaws_config FOR SELECT USING (public.is_member_of(jurisdiction_id));


--
-- Name: ipaws_config ipaws_config_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ipaws_config_update ON public.ipaws_config FOR UPDATE USING (public.is_admin_of(jurisdiction_id));


--
-- Name: ipaws_submissions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ipaws_submissions ENABLE ROW LEVEL SECURITY;

--
-- Name: ipaws_submissions ipaws_submissions_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ipaws_submissions_insert ON public.ipaws_submissions FOR INSERT WITH CHECK (public.is_admin_of(jurisdiction_id));


--
-- Name: ipaws_submissions ipaws_submissions_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ipaws_submissions_read ON public.ipaws_submissions FOR SELECT USING (public.is_member_of(jurisdiction_id));


--
-- Name: jurisdiction_memberships; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.jurisdiction_memberships ENABLE ROW LEVEL SECURITY;

--
-- Name: jurisdiction_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.jurisdiction_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: jurisdictions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.jurisdictions ENABLE ROW LEVEL SECURITY;

--
-- Name: jurisdictions jurisdictions_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY jurisdictions_insert ON public.jurisdictions FOR INSERT WITH CHECK (public.is_instance_admin());


--
-- Name: jurisdictions jurisdictions_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY jurisdictions_read ON public.jurisdictions FOR SELECT USING ((public.current_person() IS NOT NULL));


--
-- Name: jurisdictions jurisdictions_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY jurisdictions_update ON public.jurisdictions FOR UPDATE USING (public.is_admin_of(id)) WITH CHECK (public.is_admin_of(id));


--
-- Name: libraries; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.libraries ENABLE ROW LEVEL SECURITY;

--
-- Name: libraries libraries_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY libraries_read ON public.libraries FOR SELECT USING (public.is_member_of(jurisdiction_id));


--
-- Name: libraries libraries_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY libraries_write ON public.libraries FOR INSERT WITH CHECK (public.is_admin_of(jurisdiction_id));


--
-- Name: media_inquiries; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.media_inquiries ENABLE ROW LEVEL SECURITY;

--
-- Name: media_inquiries media_inquiries_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY media_inquiries_read ON public.media_inquiries FOR SELECT USING (public.is_member_of(jurisdiction_id));


--
-- Name: media_inquiries media_inquiries_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY media_inquiries_update ON public.media_inquiries FOR UPDATE USING (public.is_member_of(jurisdiction_id));


--
-- Name: media_inquiries media_inquiries_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY media_inquiries_write ON public.media_inquiries FOR INSERT WITH CHECK (public.is_member_of(jurisdiction_id));


--
-- Name: meeting_config; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.meeting_config ENABLE ROW LEVEL SECURITY;

--
-- Name: meeting_config meeting_config_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY meeting_config_insert ON public.meeting_config FOR INSERT WITH CHECK (public.is_admin_of(jurisdiction_id));


--
-- Name: meeting_config meeting_config_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY meeting_config_read ON public.meeting_config FOR SELECT USING (public.is_member_of(jurisdiction_id));


--
-- Name: meeting_config meeting_config_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY meeting_config_update ON public.meeting_config FOR UPDATE USING (public.is_admin_of(jurisdiction_id));


--
-- Name: meetings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.meetings ENABLE ROW LEVEL SECURITY;

--
-- Name: meetings meetings_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY meetings_read ON public.meetings FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.incidents i
  WHERE ((i.id = meetings.incident_id) AND public.is_member_of(i.jurisdiction_id)))));


--
-- Name: meetings meetings_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY meetings_update ON public.meetings FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM public.incidents i
  WHERE ((i.id = meetings.incident_id) AND public.is_member_of(i.jurisdiction_id)))));


--
-- Name: meetings meetings_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY meetings_write ON public.meetings FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.incidents i
  WHERE ((i.id = meetings.incident_id) AND public.is_member_of(i.jurisdiction_id)))));


--
-- Name: thread_members members_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY members_read ON public.thread_members FOR SELECT USING ((public.is_thread_participant(thread_id) OR (EXISTS ( SELECT 1
   FROM public.threads t
  WHERE ((t.id = thread_members.thread_id) AND public.is_admin_of(t.jurisdiction_id))))));


--
-- Name: thread_members members_remove; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY members_remove ON public.thread_members FOR UPDATE USING ((public.is_thread_participant(thread_id) OR (EXISTS ( SELECT 1
   FROM public.threads t
  WHERE ((t.id = thread_members.thread_id) AND public.is_admin_of(t.jurisdiction_id))))));


--
-- Name: thread_members members_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY members_write ON public.thread_members FOR INSERT WITH CHECK (((EXISTS ( SELECT 1
   FROM public.threads t
  WHERE ((t.id = thread_members.thread_id) AND public.is_member_of(t.jurisdiction_id)))) AND (public.is_thread_participant(thread_id) OR (added_by = public.current_person()))));


--
-- Name: jurisdiction_memberships memberships_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY memberships_read ON public.jurisdiction_memberships FOR SELECT USING (((person_id = public.current_person()) OR public.is_member_of(jurisdiction_id)));


--
-- Name: jurisdiction_memberships memberships_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY memberships_write ON public.jurisdiction_memberships FOR INSERT WITH CHECK ((public.is_admin_of(jurisdiction_id) OR public.is_instance_admin()));


--
-- Name: messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

--
-- Name: messages messages_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY messages_read ON public.messages FOR SELECT USING (public.is_thread_participant(thread_id));


--
-- Name: messages messages_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY messages_write ON public.messages FOR INSERT WITH CHECK (((sender_person = public.current_person()) AND public.is_thread_participant(thread_id)));


--
-- Name: notification_rules; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notification_rules ENABLE ROW LEVEL SECURITY;

--
-- Name: notifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

--
-- Name: notifications notifications_mark_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notifications_mark_read ON public.notifications FOR UPDATE USING (((person_id = public.current_person()) OR ((position_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM public.position_assignments a
  WHERE ((a.position_id = notifications.position_id) AND (a.person_id = public.current_person()) AND (a.revoked_at IS NULL)))))));


--
-- Name: notifications notifications_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notifications_read ON public.notifications FOR SELECT USING (((person_id = public.current_person()) OR ((position_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM public.position_assignments a
  WHERE ((a.position_id = notifications.position_id) AND (a.person_id = public.current_person()) AND (a.revoked_at IS NULL))))) OR public.is_admin_of(jurisdiction_id)));


--
-- Name: notifications notifications_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notifications_write ON public.notifications FOR INSERT WITH CHECK (public.is_member_of(jurisdiction_id));


--
-- Name: operational_assessment_decisions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.operational_assessment_decisions ENABLE ROW LEVEL SECURITY;

--
-- Name: operational_assessment_decisions operational_assessment_decisions_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY operational_assessment_decisions_insert ON public.operational_assessment_decisions FOR INSERT WITH CHECK (((created_by = public.current_person()) AND (EXISTS ( SELECT 1
   FROM public.incidents i
  WHERE ((i.id = operational_assessment_decisions.incident_id) AND (i.jurisdiction_id = operational_assessment_decisions.jurisdiction_id) AND (i.closed_at IS NULL) AND ((public.is_admin_of(i.jurisdiction_id) AND (operational_assessment_decisions.home_organization_id = i.jurisdiction_id) AND (operational_assessment_decisions.participation_id IS NULL) AND (((operational_assessment_decisions.position_id IS NULL) AND (operational_assessment_decisions.position_title IS NULL)) OR (EXISTS ( SELECT 1
           FROM (public.auth_sessions s
             JOIN public.positions p ON ((p.id = s.active_position_id)))
          WHERE ((s.person_id = public.current_person()) AND (s.ended_at IS NULL) AND (s.active_position_id = operational_assessment_decisions.position_id) AND (p.jurisdiction_id = i.jurisdiction_id) AND (p.title = operational_assessment_decisions.position_title)))))) OR ((operational_assessment_decisions.position_id IS NULL) AND (EXISTS ( SELECT 1
           FROM public.incident_participants ip
          WHERE ((ip.id = operational_assessment_decisions.participation_id) AND (ip.incident_id = i.id) AND (ip.person_id = public.current_person()) AND (ip.organization_id = operational_assessment_decisions.home_organization_id) AND (ip.incident_position_title = operational_assessment_decisions.position_title) AND (ip.role = 'coordinator'::text) AND (ip.revoked_at IS NULL) AND (ip.expires_at > now()) AND public.eligible_incident_person(ip.person_id, ip.organization_id))))))))) AND (EXISTS ( SELECT 1
   FROM public.operational_assessments a
  WHERE ((a.id = operational_assessment_decisions.selected_assessment_id) AND (a.incident_id = operational_assessment_decisions.incident_id) AND (a.domain = operational_assessment_decisions.domain) AND (a.framework = operational_assessment_decisions.framework) AND (a.definition_key = operational_assessment_decisions.definition_key))))));


--
-- Name: operational_assessment_decisions operational_assessment_decisions_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY operational_assessment_decisions_read ON public.operational_assessment_decisions FOR SELECT USING (public.can_read_incident(incident_id));


--
-- Name: operational_assessments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.operational_assessments ENABLE ROW LEVEL SECURITY;

--
-- Name: operational_assessments operational_assessments_native_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY operational_assessments_native_insert ON public.operational_assessments FOR INSERT WITH CHECK (((source_kind = 'native'::text) AND (legacy_board_id IS NULL) AND (legacy_record_id IS NULL) AND (created_by = public.current_person()) AND (incident_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM public.incidents i
  WHERE ((i.id = operational_assessments.incident_id) AND (i.jurisdiction_id = operational_assessments.jurisdiction_id) AND (i.closed_at IS NULL) AND ((public.is_writer_of(i.jurisdiction_id) AND (operational_assessments.home_organization_id = i.jurisdiction_id) AND (operational_assessments.participation_id IS NULL) AND (((operational_assessments.position_id IS NULL) AND (operational_assessments.position_title IS NULL)) OR (EXISTS ( SELECT 1
           FROM (public.auth_sessions s
             JOIN public.positions p ON ((p.id = s.active_position_id)))
          WHERE ((s.person_id = public.current_person()) AND (s.ended_at IS NULL) AND (s.active_position_id = operational_assessments.position_id) AND (p.jurisdiction_id = i.jurisdiction_id) AND (p.title = operational_assessments.position_title)))))) OR ((operational_assessments.position_id IS NULL) AND (EXISTS ( SELECT 1
           FROM public.incident_participants ip
          WHERE ((ip.id = operational_assessments.participation_id) AND (ip.incident_id = i.id) AND (ip.person_id = public.current_person()) AND (ip.organization_id = operational_assessments.home_organization_id) AND (ip.incident_position_title = operational_assessments.position_title) AND (ip.role = ANY (ARRAY['contributor'::text, 'coordinator'::text])) AND (ip.revoked_at IS NULL) AND (ip.expires_at > now()) AND public.eligible_incident_person(ip.person_id, ip.organization_id))))))))) AND ((supersedes_id IS NULL) OR public.operational_supersedes_matches(supersedes_id, incident_id, domain, framework, definition_key))));


--
-- Name: operational_assessments operational_assessments_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY operational_assessments_read ON public.operational_assessments FOR SELECT USING ((((incident_id IS NOT NULL) AND public.can_read_incident(incident_id)) OR ((incident_id IS NULL) AND public.is_member_of(jurisdiction_id))));


--
-- Name: operational_relationships; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.operational_relationships ENABLE ROW LEVEL SECURITY;

--
-- Name: operational_relationships operational_relationships_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY operational_relationships_insert ON public.operational_relationships FOR INSERT WITH CHECK ((public.can_read_incident(incident_id) AND (EXISTS ( SELECT 1
   FROM public.incidents
  WHERE ((incidents.id = operational_relationships.incident_id) AND (incidents.closed_at IS NULL)))) AND (public.is_writer_of(organization_id) OR public.has_incident_participation(incident_id, 'contributor'::text)) AND (created_by = public.current_person())));


--
-- Name: operational_relationships operational_relationships_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY operational_relationships_read ON public.operational_relationships FOR SELECT USING (public.can_read_incident(incident_id));


--
-- Name: federation_outbox outbox_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY outbox_read ON public.federation_outbox FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.peers p
  WHERE ((p.id = federation_outbox.peer_id) AND public.is_member_of(p.jurisdiction_id)))));


--
-- Name: federation_outbox outbox_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY outbox_update ON public.federation_outbox FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM public.peers p
  WHERE ((p.id = federation_outbox.peer_id) AND public.is_writer_of(p.jurisdiction_id)))));


--
-- Name: federation_outbox outbox_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY outbox_write ON public.federation_outbox FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.peers p
  WHERE ((p.id = federation_outbox.peer_id) AND public.is_writer_of(p.jurisdiction_id)))));


--
-- Name: incident_participants participant_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY participant_insert ON public.incident_participants FOR INSERT WITH CHECK (((created_by = public.current_person()) AND (expires_at > now()) AND public.eligible_incident_person(person_id, organization_id) AND (EXISTS ( SELECT 1
   FROM public.incidents i
  WHERE ((i.id = incident_participants.incident_id) AND (i.closed_at IS NULL) AND public.is_admin_of(i.jurisdiction_id))))));


--
-- Name: incident_participants participant_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY participant_read ON public.incident_participants FOR SELECT USING (public.can_read_incident(incident_id));


--
-- Name: incident_participants participant_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY participant_update ON public.incident_participants FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM public.incidents i
  WHERE ((i.id = incident_participants.incident_id) AND public.is_admin_of(i.jurisdiction_id))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.incidents i
  WHERE ((i.id = incident_participants.incident_id) AND public.is_admin_of(i.jurisdiction_id)))));


--
-- Name: peers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.peers ENABLE ROW LEVEL SECURITY;

--
-- Name: peers peers_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY peers_read ON public.peers FOR SELECT USING ((public.is_member_of(jurisdiction_id) OR (public.current_person() IS NULL)));


--
-- Name: peers peers_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY peers_write ON public.peers FOR INSERT WITH CHECK (public.is_admin_of(jurisdiction_id));


--
-- Name: person_identities; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.person_identities ENABLE ROW LEVEL SECURITY;

--
-- Name: person_identities person_identities_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY person_identities_read ON public.person_identities FOR SELECT USING ((person_id = public.current_person()));


--
-- Name: persons; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.persons ENABLE ROW LEVEL SECURITY;

--
-- Name: persons persons_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY persons_insert ON public.persons FOR INSERT WITH CHECK ((public.current_person() IS NOT NULL));


--
-- Name: persons persons_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY persons_read ON public.persons FOR SELECT USING ((public.current_person() IS NOT NULL));


--
-- Name: position_assignments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.position_assignments ENABLE ROW LEVEL SECURITY;

--
-- Name: position_signins; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.position_signins ENABLE ROW LEVEL SECURITY;

--
-- Name: positions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.positions ENABLE ROW LEVEL SECURITY;

--
-- Name: positions positions_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY positions_read ON public.positions FOR SELECT USING ((public.is_member_of(jurisdiction_id) OR public.has_guest_scope(jurisdiction_id, 'positions:read'::text)));


--
-- Name: positions positions_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY positions_update ON public.positions FOR UPDATE USING (public.is_admin_of(jurisdiction_id));


--
-- Name: positions positions_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY positions_write ON public.positions FOR INSERT WITH CHECK ((public.is_admin_of(jurisdiction_id) OR public.is_instance_admin()));


--
-- Name: press_release_approvals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.press_release_approvals ENABLE ROW LEVEL SECURITY;

--
-- Name: press_release_publications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.press_release_publications ENABLE ROW LEVEL SECURITY;

--
-- Name: press_releases; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.press_releases ENABLE ROW LEVEL SECURITY;

--
-- Name: press_releases press_releases_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY press_releases_read ON public.press_releases FOR SELECT USING (public.is_member_of(jurisdiction_id));


--
-- Name: press_releases press_releases_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY press_releases_update ON public.press_releases FOR UPDATE USING (public.is_member_of(jurisdiction_id));


--
-- Name: press_releases press_releases_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY press_releases_write ON public.press_releases FOR INSERT WITH CHECK (public.is_member_of(jurisdiction_id));


--
-- Name: public_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.public_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: public_messages public_messages_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY public_messages_read ON public.public_messages FOR SELECT USING (public.is_member_of(jurisdiction_id));


--
-- Name: public_messages public_messages_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY public_messages_write ON public.public_messages FOR INSERT WITH CHECK (public.is_member_of(jurisdiction_id));


--
-- Name: press_release_publications publications_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY publications_read ON public.press_release_publications FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.press_releases r
  WHERE ((r.id = press_release_publications.release_id) AND public.is_member_of(r.jurisdiction_id)))));


--
-- Name: press_release_publications publications_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY publications_write ON public.press_release_publications FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.press_releases r
  WHERE ((r.id = press_release_publications.release_id) AND public.is_member_of(r.jurisdiction_id)))));


--
-- Name: board_records records_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY records_read ON public.board_records FOR SELECT USING (((EXISTS ( SELECT 1
   FROM public.boards b
  WHERE ((b.id = board_records.board_id) AND (public.is_member_of(b.jurisdiction_id) OR public.has_guest_scope(b.jurisdiction_id, (('board:'::text || (b.id)::text) || ':read'::text)))))) OR ((incident_id IS NOT NULL) AND public.can_read_incident(incident_id) AND (EXISTS ( SELECT 1
   FROM public.incident_boards ib
  WHERE ((ib.incident_id = board_records.incident_id) AND (ib.board_id = board_records.board_id)))))));


--
-- Name: board_records records_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY records_update ON public.board_records FOR UPDATE USING (((EXISTS ( SELECT 1
   FROM public.boards b
  WHERE ((b.id = board_records.board_id) AND public.is_writer_of(b.jurisdiction_id)))) OR ((incident_id IS NOT NULL) AND public.has_incident_participation(incident_id, 'contributor'::text))));


--
-- Name: board_records records_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY records_write ON public.board_records FOR INSERT WITH CHECK ((((incident_id IS NULL) OR (EXISTS ( SELECT 1
   FROM public.incident_boards ib
  WHERE ((ib.incident_id = board_records.incident_id) AND (ib.board_id = board_records.board_id))))) AND ((EXISTS ( SELECT 1
   FROM public.boards b
  WHERE ((b.id = board_records.board_id) AND public.is_writer_of(b.jurisdiction_id)))) OR ((incident_id IS NOT NULL) AND public.has_incident_participation(incident_id, 'contributor'::text)))));


--
-- Name: resource_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.resource_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: rr_costs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.rr_costs ENABLE ROW LEVEL SECURITY;

--
-- Name: rr_costs rr_costs_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY rr_costs_read ON public.rr_costs FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.resource_requests r
  WHERE ((r.id = rr_costs.request_id) AND public.is_member_of(r.jurisdiction_id)))));


--
-- Name: rr_costs rr_costs_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY rr_costs_write ON public.rr_costs FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.resource_requests r
  WHERE ((r.id = rr_costs.request_id) AND public.is_member_of(r.jurisdiction_id)))));


--
-- Name: rr_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.rr_events ENABLE ROW LEVEL SECURITY;

--
-- Name: rr_events rr_events_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY rr_events_read ON public.rr_events FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.resource_requests r
  WHERE ((r.id = rr_events.request_id) AND public.is_member_of(r.jurisdiction_id)))));


--
-- Name: rr_events rr_events_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY rr_events_write ON public.rr_events FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.resource_requests r
  WHERE ((r.id = rr_events.request_id) AND public.is_member_of(r.jurisdiction_id)))));


--
-- Name: resource_requests rr_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY rr_read ON public.resource_requests FOR SELECT USING (public.is_member_of(jurisdiction_id));


--
-- Name: resource_requests rr_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY rr_update ON public.resource_requests FOR UPDATE USING (public.is_member_of(jurisdiction_id));


--
-- Name: resource_requests rr_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY rr_write ON public.resource_requests FOR INSERT WITH CHECK (public.is_member_of(jurisdiction_id));


--
-- Name: notification_rules rules_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY rules_read ON public.notification_rules FOR SELECT USING (public.is_member_of(jurisdiction_id));


--
-- Name: notification_rules rules_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY rules_update ON public.notification_rules FOR UPDATE USING ((public.is_admin_of(jurisdiction_id) OR public.is_member_of(jurisdiction_id)));


--
-- Name: notification_rules rules_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY rules_write ON public.notification_rules FOR INSERT WITH CHECK (public.is_admin_of(jurisdiction_id));


--
-- Name: saved_states; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.saved_states ENABLE ROW LEVEL SECURITY;

--
-- Name: saved_states saved_states_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY saved_states_delete ON public.saved_states FOR DELETE USING (((person_id = public.current_person()) AND public.can_read_incident(incident_id)));


--
-- Name: saved_states saved_states_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY saved_states_insert ON public.saved_states FOR INSERT WITH CHECK (((person_id = public.current_person()) AND public.can_read_incident(incident_id)));


--
-- Name: saved_states saved_states_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY saved_states_read ON public.saved_states FOR SELECT USING (((person_id = public.current_person()) AND public.can_read_incident(incident_id)));


--
-- Name: saved_states saved_states_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY saved_states_update ON public.saved_states FOR UPDATE USING (((person_id = public.current_person()) AND public.can_read_incident(incident_id))) WITH CHECK (((person_id = public.current_person()) AND public.can_read_incident(incident_id)));


--
-- Name: jurisdiction_settings settings_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY settings_read ON public.jurisdiction_settings FOR SELECT USING (public.is_member_of(jurisdiction_id));


--
-- Name: jurisdiction_settings settings_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY settings_update ON public.jurisdiction_settings FOR UPDATE USING (public.is_admin_of(jurisdiction_id));


--
-- Name: jurisdiction_settings settings_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY settings_write ON public.jurisdiction_settings FOR INSERT WITH CHECK (public.is_admin_of(jurisdiction_id));


--
-- Name: sharing_agreements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sharing_agreements ENABLE ROW LEVEL SECURITY;

--
-- Name: shifts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.shifts ENABLE ROW LEVEL SECURITY;

--
-- Name: shifts shifts_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY shifts_read ON public.shifts FOR SELECT USING (public.is_member_of(jurisdiction_id));


--
-- Name: shifts shifts_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY shifts_update ON public.shifts FOR UPDATE USING (public.is_writer_of(jurisdiction_id));


--
-- Name: shifts shifts_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY shifts_write ON public.shifts FOR INSERT WITH CHECK (public.is_writer_of(jurisdiction_id));


--
-- Name: position_signins signins_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY signins_read ON public.position_signins FOR SELECT USING (((person_id = public.current_person()) OR (EXISTS ( SELECT 1
   FROM public.positions p
  WHERE ((p.id = position_signins.position_id) AND public.is_member_of(p.jurisdiction_id))))));


--
-- Name: position_signins signins_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY signins_update ON public.position_signins FOR UPDATE USING ((person_id = public.current_person()));


--
-- Name: position_signins signins_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY signins_write ON public.position_signins FOR INSERT WITH CHECK ((person_id = public.current_person()));


--
-- Name: sitreps; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sitreps ENABLE ROW LEVEL SECURITY;

--
-- Name: sitreps sitreps_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sitreps_read ON public.sitreps FOR SELECT USING (public.is_member_of(jurisdiction_id));


--
-- Name: sitreps sitreps_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sitreps_write ON public.sitreps FOR INSERT WITH CHECK (public.is_writer_of(jurisdiction_id));


--
-- Name: status_queries sq_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sq_read ON public.status_queries FOR SELECT USING (public.is_member_of(jurisdiction_id));


--
-- Name: status_queries sq_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sq_write ON public.status_queries FOR INSERT WITH CHECK (public.is_writer_of(jurisdiction_id));


--
-- Name: status_query_targets sqt_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sqt_read ON public.status_query_targets FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.status_queries q
  WHERE ((q.id = status_query_targets.query_id) AND public.is_member_of(q.jurisdiction_id)))));


--
-- Name: status_query_targets sqt_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sqt_update ON public.status_query_targets FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM public.status_queries q
  WHERE ((q.id = status_query_targets.query_id) AND public.is_writer_of(q.jurisdiction_id)))));


--
-- Name: status_query_targets sqt_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sqt_write ON public.status_query_targets FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.status_queries q
  WHERE ((q.id = status_query_targets.query_id) AND public.is_writer_of(q.jurisdiction_id)))));


--
-- Name: staff_checkins; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.staff_checkins ENABLE ROW LEVEL SECURITY;

--
-- Name: status_queries; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.status_queries ENABLE ROW LEVEL SECURITY;

--
-- Name: status_query_targets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.status_query_targets ENABLE ROW LEVEL SECURITY;

--
-- Name: sync_conflicts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sync_conflicts ENABLE ROW LEVEL SECURITY;

--
-- Name: sync_conflicts sync_conflicts_append; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sync_conflicts_append ON public.sync_conflicts FOR INSERT WITH CHECK (((origin_person = public.current_person()) AND (((incident_id IS NULL) AND (EXISTS ( SELECT 1
   FROM public.boards b
  WHERE ((b.id = sync_conflicts.board_id) AND public.is_member_of(b.jurisdiction_id))))) OR ((incident_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM (public.incident_boards ib
     JOIN public.incidents i ON ((i.id = ib.incident_id)))
  WHERE ((ib.board_id = sync_conflicts.board_id) AND (ib.incident_id = sync_conflicts.incident_id) AND (i.closed_at IS NULL) AND (public.is_writer_of(i.jurisdiction_id) OR public.has_incident_participation(i.id, 'contributor'::text)))))))));


--
-- Name: sync_conflicts sync_conflicts_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sync_conflicts_read ON public.sync_conflicts FOR SELECT USING ((((incident_id IS NULL) AND (EXISTS ( SELECT 1
   FROM public.boards b
  WHERE ((b.id = sync_conflicts.board_id) AND public.is_member_of(b.jurisdiction_id))))) OR ((incident_id IS NOT NULL) AND public.can_read_incident(incident_id) AND (EXISTS ( SELECT 1
   FROM public.incident_boards ib
  WHERE ((ib.board_id = sync_conflicts.board_id) AND (ib.incident_id = sync_conflicts.incident_id)))))));


--
-- Name: sync_conflicts sync_conflicts_resolve; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sync_conflicts_resolve ON public.sync_conflicts FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM public.boards b
  WHERE ((b.id = sync_conflicts.board_id) AND public.is_admin_of(b.jurisdiction_id)))));


--
-- Name: sync_updates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sync_updates ENABLE ROW LEVEL SECURITY;

--
-- Name: sync_updates sync_updates_append; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sync_updates_append ON public.sync_updates FOR INSERT WITH CHECK (((origin_person = public.current_person()) AND (((incident_id IS NULL) AND (operation_id IS NULL) AND (request_digest IS NULL) AND (conflicts IS NULL) AND (EXISTS ( SELECT 1
   FROM public.boards b
  WHERE ((b.id = sync_updates.board_id) AND public.is_writer_of(b.jurisdiction_id))))) OR ((incident_id IS NOT NULL) AND (operation_id IS NOT NULL) AND (request_digest IS NOT NULL) AND (conflicts IS NOT NULL) AND public.can_read_incident(incident_id) AND (EXISTS ( SELECT 1
   FROM (public.incident_boards ib
     JOIN public.incidents i ON ((i.id = ib.incident_id)))
  WHERE ((ib.board_id = sync_updates.board_id) AND (ib.incident_id = sync_updates.incident_id) AND (i.closed_at IS NULL) AND (public.is_writer_of(i.jurisdiction_id) OR public.has_incident_participation(i.id, 'contributor'::text)))))))));


--
-- Name: sync_updates sync_updates_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sync_updates_read ON public.sync_updates FOR SELECT USING ((((incident_id IS NULL) AND (EXISTS ( SELECT 1
   FROM public.boards b
  WHERE ((b.id = sync_updates.board_id) AND public.is_member_of(b.jurisdiction_id))))) OR ((incident_id IS NOT NULL) AND public.can_read_incident(incident_id) AND (EXISTS ( SELECT 1
   FROM public.incident_boards ib
  WHERE ((ib.board_id = sync_updates.board_id) AND (ib.incident_id = sync_updates.incident_id)))))));


--
-- Name: board_templates templates_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY templates_read ON public.board_templates FOR SELECT USING ((public.current_person() IS NOT NULL));


--
-- Name: board_templates templates_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY templates_write ON public.board_templates FOR INSERT WITH CHECK (public.is_instance_admin());


--
-- Name: thread_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.thread_members ENABLE ROW LEVEL SECURITY;

--
-- Name: threads; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.threads ENABLE ROW LEVEL SECURITY;

--
-- Name: threads threads_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY threads_read ON public.threads FOR SELECT USING ((public.is_thread_participant(id) OR (created_by = public.current_person()) OR public.is_admin_of(jurisdiction_id)));


--
-- Name: threads threads_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY threads_write ON public.threads FOR INSERT WITH CHECK ((public.is_member_of(jurisdiction_id) AND (created_by = public.current_person())));


--
-- Name: tracked_objects; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tracked_objects ENABLE ROW LEVEL SECURITY;

--
-- Name: tracked_objects tracked_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tracked_read ON public.tracked_objects FOR SELECT USING (public.is_member_of(jurisdiction_id));


--
-- Name: tracked_objects tracked_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tracked_write ON public.tracked_objects FOR INSERT WITH CHECK (public.is_writer_of(jurisdiction_id));


--
-- Name: tracking_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tracking_events ENABLE ROW LEVEL SECURITY;

--
-- Name: tracking_events tracking_events_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tracking_events_read ON public.tracking_events FOR SELECT USING (public.is_member_of(jurisdiction_id));


--
-- Name: tracking_events tracking_events_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tracking_events_write ON public.tracking_events FOR INSERT WITH CHECK (public.is_writer_of(jurisdiction_id));


--
-- Name: notifications workflow_notifications_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY workflow_notifications_insert ON public.notifications FOR INSERT WITH CHECK (((channel = 'workflow'::text) AND (rule_id IS NULL) AND (status = 'delivered'::text) AND (EXISTS ( SELECT 1
   FROM ((public.board_workflow_instances w
     JOIN public.board_records r ON (((r.id = w.record_id) AND (r.board_id = w.board_id) AND (NOT (r.incident_id IS DISTINCT FROM w.incident_id)))))
     JOIN public.board_workflow_history h ON (((h.record_id = w.record_id) AND (h.state_revision = w.state_revision) AND (h.event_kind = 'transition_completed'::text) AND (h.actor_person_id = public.current_person()) AND (h.transaction_id = txid_current()) AND ((h.id)::text = (notifications.detail ->> 'historyId'::text)))))
  WHERE (((w.record_id)::text = (notifications.detail ->> 'recordId'::text)) AND ((w.board_id)::text = (notifications.detail ->> 'boardId'::text)) AND (w.jurisdiction_id = notifications.jurisdiction_id) AND ((w.jurisdiction_id)::text = (notifications.detail ->> 'sourceJurisdictionId'::text)) AND (COALESCE((w.incident_id)::text, ''::text) = COALESCE((notifications.detail ->> 'incidentId'::text), ''::text)) AND (public.is_writer_of(w.jurisdiction_id) OR ((w.incident_id IS NOT NULL) AND public.has_incident_participation(w.incident_id, 'contributor'::text))) AND (((w.assignment_kind = 'position'::text) AND (notifications.person_id IS NULL) AND (notifications.position_id = w.assignment_position_id)) OR ((w.assignment_kind = 'incident_participant'::text) AND (notifications.position_id IS NULL) AND ((notifications.person_id)::text = (w.assignment_snapshot ->> 'personId'::text)))))))));


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA public TO app_runtime;


--
-- Name: FUNCTION append_iap_participant_audit(iid uuid, sid uuid, event_category text, event_payload jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.append_iap_participant_audit(iid uuid, sid uuid, event_category text, event_payload jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.append_iap_participant_audit(iid uuid, sid uuid, event_category text, event_payload jsonb) TO app_runtime;


--
-- Name: FUNCTION can_read_incident(iid uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.can_read_incident(iid uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.can_read_incident(iid uuid) TO app_runtime;


--
-- Name: FUNCTION can_revise_incident_area(iid uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.can_revise_incident_area(iid uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.can_revise_incident_area(iid uuid) TO app_runtime;


--
-- Name: FUNCTION capture_legacy_operational_assessment(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.capture_legacy_operational_assessment() FROM PUBLIC;


--
-- Name: TABLE checklist_items; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.checklist_items TO app_runtime;


--
-- Name: FUNCTION checklist_actor_can_update(task public.checklist_items); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.checklist_actor_can_update(task public.checklist_items) FROM PUBLIC;
GRANT ALL ON FUNCTION public.checklist_actor_can_update(task public.checklist_items) TO app_runtime;


--
-- Name: FUNCTION create_auth_session(pid uuid, access_hash text, resume_hash text, access_expires_at timestamp with time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.create_auth_session(pid uuid, access_hash text, resume_hash text, access_expires_at timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_auth_session(pid uuid, access_hash text, resume_hash text, access_expires_at timestamp with time zone) TO app_runtime;


--
-- Name: FUNCTION eligible_incident_person(pid uuid, oid uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.eligible_incident_person(pid uuid, oid uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.eligible_incident_person(pid uuid, oid uuid) TO app_runtime;


--
-- Name: FUNCTION enforce_corrective_action_revision(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.enforce_corrective_action_revision() FROM PUBLIC;


--
-- Name: FUNCTION find_person_by_email(addr text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.find_person_by_email(addr text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.find_person_by_email(addr text) TO app_runtime;


--
-- Name: FUNCTION guard_checklist_task_prerequisites(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.guard_checklist_task_prerequisites() FROM PUBLIC;
GRANT ALL ON FUNCTION public.guard_checklist_task_prerequisites() TO app_runtime;


--
-- Name: FUNCTION has_incident_participation(iid uuid, minimum_role text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.has_incident_participation(iid uuid, minimum_role text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.has_incident_participation(iid uuid, minimum_role text) TO app_runtime;


--
-- Name: FUNCTION link_identity(pid uuid, iss text, sub text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.link_identity(pid uuid, iss text, sub text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.link_identity(pid uuid, iss text, sub text) TO app_runtime;


--
-- Name: FUNCTION lock_incident_area(iid uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.lock_incident_area(iid uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.lock_incident_area(iid uuid) TO app_runtime;


--
-- Name: FUNCTION lock_operational_assessment_incident(iid uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.lock_operational_assessment_incident(iid uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.lock_operational_assessment_incident(iid uuid) TO app_runtime;


--
-- Name: FUNCTION operational_supersedes_matches(prior_id uuid, iid uuid, assessment_domain text, assessment_framework text, assessment_key text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.operational_supersedes_matches(prior_id uuid, iid uuid, assessment_domain text, assessment_framework text, assessment_key text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.operational_supersedes_matches(prior_id uuid, iid uuid, assessment_domain text, assessment_framework text, assessment_key text) TO app_runtime;


--
-- Name: FUNCTION resolve_auth_session(access_hash_in text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.resolve_auth_session(access_hash_in text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.resolve_auth_session(access_hash_in text) TO app_runtime;


--
-- Name: FUNCTION resolve_identity(iss text, sub text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.resolve_identity(iss text, sub text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.resolve_identity(iss text, sub text) TO app_runtime;


--
-- Name: FUNCTION resume_auth_session(resume_hash_in text, new_access_hash text, access_expires_at_in timestamp with time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.resume_auth_session(resume_hash_in text, new_access_hash text, access_expires_at_in timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.resume_auth_session(resume_hash_in text, new_access_hash text, access_expires_at_in timestamp with time zone) TO app_runtime;


--
-- Name: FUNCTION validate_checklist_task_dependency(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.validate_checklist_task_dependency() FROM PUBLIC;
GRANT ALL ON FUNCTION public.validate_checklist_task_dependency() TO app_runtime;


--
-- Name: FUNCTION validate_checklist_task_update(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.validate_checklist_task_update() FROM PUBLIC;
GRANT ALL ON FUNCTION public.validate_checklist_task_update() TO app_runtime;


--
-- Name: FUNCTION workflow_pending_requester_authorized(rid uuid, required_role text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.workflow_pending_requester_authorized(rid uuid, required_role text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.workflow_pending_requester_authorized(rid uuid, required_role text) TO app_runtime;


--
-- Name: TABLE aar_observations; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.aar_observations TO app_runtime;


--
-- Name: TABLE aars; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.aars TO app_runtime;


--
-- Name: TABLE audit_events; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT ON TABLE public.audit_events TO app_runtime;


--
-- Name: TABLE auth_sessions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.auth_sessions TO app_runtime;


--
-- Name: TABLE badges; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.badges TO app_runtime;


--
-- Name: TABLE board_records; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.board_records TO app_runtime;


--
-- Name: TABLE board_templates; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.board_templates TO app_runtime;


--
-- Name: TABLE board_workflow_approvals; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT ON TABLE public.board_workflow_approvals TO app_runtime;


--
-- Name: TABLE board_workflow_history; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT ON TABLE public.board_workflow_history TO app_runtime;


--
-- Name: SEQUENCE board_workflow_history_sequence_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.board_workflow_history_sequence_seq TO app_runtime;


--
-- Name: TABLE board_workflow_idempotency; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT ON TABLE public.board_workflow_idempotency TO app_runtime;


--
-- Name: TABLE board_workflow_instances; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.board_workflow_instances TO app_runtime;


--
-- Name: TABLE boards; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.boards TO app_runtime;


--
-- Name: TABLE briefings; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.briefings TO app_runtime;


--
-- Name: TABLE cap_alert_reviews; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.cap_alert_reviews TO app_runtime;


--
-- Name: TABLE cap_alerts; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.cap_alerts TO app_runtime;


--
-- Name: TABLE checklist_completion_operations; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT ON TABLE public.checklist_completion_operations TO app_runtime;


--
-- Name: TABLE checklist_task_dependencies; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.checklist_task_dependencies TO app_runtime;


--
-- Name: TABLE collab_backends; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.collab_backends TO app_runtime;


--
-- Name: TABLE collab_channel_members; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.collab_channel_members TO app_runtime;


--
-- Name: TABLE collab_channels; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.collab_channels TO app_runtime;


--
-- Name: TABLE collab_spaces; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.collab_spaces TO app_runtime;


--
-- Name: TABLE corrective_actions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.corrective_actions TO app_runtime;


--
-- Name: TABLE damage_assessments; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.damage_assessments TO app_runtime;


--
-- Name: TABLE damage_baselines; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.damage_baselines TO app_runtime;


--
-- Name: TABLE damage_intake; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.damage_intake TO app_runtime;


--
-- Name: TABLE dashboard_templates; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.dashboard_templates TO app_runtime;


--
-- Name: TABLE dashboards; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.dashboards TO app_runtime;


--
-- Name: TABLE data_pack_datasets; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.data_pack_datasets TO app_runtime;


--
-- Name: TABLE data_pack_items; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.data_pack_items TO app_runtime;


--
-- Name: TABLE data_packs; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.data_packs TO app_runtime;


--
-- Name: TABLE facilities; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.facilities TO app_runtime;


--
-- Name: TABLE facility_status_reports; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.facility_status_reports TO app_runtime;


--
-- Name: TABLE federation_outbox; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.federation_outbox TO app_runtime;


--
-- Name: TABLE feed_items; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.feed_items TO app_runtime;


--
-- Name: TABLE feeds; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.feeds TO app_runtime;


--
-- Name: TABLE files; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT ON TABLE public.files TO app_runtime;


--
-- Name: TABLE form_definitions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.form_definitions TO app_runtime;


--
-- Name: TABLE guest_grants; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.guest_grants TO app_runtime;


--
-- Name: TABLE iaps; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.iaps TO app_runtime;


--
-- Name: TABLE incident_area_revisions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT ON TABLE public.incident_area_revisions TO app_runtime;


--
-- Name: TABLE incident_boards; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.incident_boards TO app_runtime;


--
-- Name: TABLE incident_libraries; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.incident_libraries TO app_runtime;


--
-- Name: TABLE incident_participants; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.incident_participants TO app_runtime;


--
-- Name: TABLE incident_positions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.incident_positions TO app_runtime;


--
-- Name: TABLE incident_templates; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.incident_templates TO app_runtime;


--
-- Name: TABLE incidents; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.incidents TO app_runtime;


--
-- Name: TABLE ipaws_config; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.ipaws_config TO app_runtime;


--
-- Name: TABLE ipaws_submissions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.ipaws_submissions TO app_runtime;


--
-- Name: TABLE jurisdiction_memberships; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.jurisdiction_memberships TO app_runtime;


--
-- Name: TABLE jurisdiction_settings; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.jurisdiction_settings TO app_runtime;


--
-- Name: TABLE jurisdictions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.jurisdictions TO app_runtime;


--
-- Name: TABLE libraries; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.libraries TO app_runtime;


--
-- Name: TABLE media_inquiries; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.media_inquiries TO app_runtime;


--
-- Name: TABLE meeting_config; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.meeting_config TO app_runtime;


--
-- Name: TABLE meetings; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.meetings TO app_runtime;


--
-- Name: TABLE messages; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT ON TABLE public.messages TO app_runtime;


--
-- Name: TABLE notification_rules; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.notification_rules TO app_runtime;


--
-- Name: TABLE notifications; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.notifications TO app_runtime;


--
-- Name: TABLE operational_assessment_decisions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT ON TABLE public.operational_assessment_decisions TO app_runtime;


--
-- Name: TABLE operational_assessments; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT ON TABLE public.operational_assessments TO app_runtime;


--
-- Name: TABLE operational_relationships; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.operational_relationships TO app_runtime;


--
-- Name: TABLE peers; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.peers TO app_runtime;


--
-- Name: TABLE person_identities; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.person_identities TO app_runtime;


--
-- Name: TABLE persons; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.persons TO app_runtime;


--
-- Name: TABLE position_assignments; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.position_assignments TO app_runtime;


--
-- Name: TABLE position_signins; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.position_signins TO app_runtime;


--
-- Name: TABLE positions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.positions TO app_runtime;


--
-- Name: TABLE press_release_approvals; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.press_release_approvals TO app_runtime;


--
-- Name: TABLE press_release_publications; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.press_release_publications TO app_runtime;


--
-- Name: TABLE press_releases; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.press_releases TO app_runtime;


--
-- Name: TABLE public_messages; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.public_messages TO app_runtime;


--
-- Name: TABLE resource_requests; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.resource_requests TO app_runtime;


--
-- Name: TABLE rr_costs; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.rr_costs TO app_runtime;


--
-- Name: TABLE rr_events; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.rr_events TO app_runtime;


--
-- Name: TABLE saved_states; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.saved_states TO app_runtime;


--
-- Name: TABLE sharing_agreements; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.sharing_agreements TO app_runtime;


--
-- Name: TABLE shifts; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.shifts TO app_runtime;


--
-- Name: TABLE sitreps; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.sitreps TO app_runtime;


--
-- Name: TABLE staff_checkins; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.staff_checkins TO app_runtime;


--
-- Name: TABLE status_queries; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.status_queries TO app_runtime;


--
-- Name: TABLE status_query_targets; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.status_query_targets TO app_runtime;


--
-- Name: TABLE sync_conflicts; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.sync_conflicts TO app_runtime;


--
-- Name: TABLE sync_updates; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT ON TABLE public.sync_updates TO app_runtime;


--
-- Name: TABLE thread_members; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.thread_members TO app_runtime;


--
-- Name: TABLE threads; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.threads TO app_runtime;


--
-- Name: TABLE tracked_objects; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.tracked_objects TO app_runtime;


--
-- Name: TABLE tracking_events; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.tracking_events TO app_runtime;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT,INSERT,UPDATE ON TABLES TO app_runtime;


--
-- PostgreSQL database dump complete
--

