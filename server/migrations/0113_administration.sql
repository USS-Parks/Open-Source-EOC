-- Administration from the operator screen: change or remove a membership,
-- disable an account, read and reset a person's second factor.
--
-- A jurisdiction admin changes and removes memberships in that jurisdiction.
-- Disabling an account and resetting its second factor act on the person
-- everywhere, so an admin may do them only for a person whose every
-- membership is in a jurisdiction that admin administers; an instance admin
-- may do them for anyone. Nobody may do them to their own account.

create policy memberships_update on public.jurisdiction_memberships
  for update using (public.is_admin_of(jurisdiction_id))
  with check (public.is_admin_of(jurisdiction_id));
create policy memberships_delete on public.jurisdiction_memberships
  for delete using (public.is_admin_of(jurisdiction_id));

grant delete on table public.jurisdiction_memberships to app_runtime;

create function public.may_administer_person(pid uuid)
  returns boolean
  language sql stable security definer
  set search_path to 'pg_catalog', 'public', 'pg_temp'
  as $$
  select coalesce(pid <> public.current_person() and (
    public.is_instance_admin() or (
      not coalesce((select p.is_instance_admin from public.persons p where p.id = pid), true)
      and exists (select 1 from public.jurisdiction_memberships m where m.person_id = pid)
      and not exists (
        select 1 from public.jurisdiction_memberships m
        where m.person_id = pid and not public.is_admin_of(m.jurisdiction_id)))), false)
$$;

-- persons carries no update policy; this is the only way to its disabled flag.
create function public.set_person_disabled(pid uuid, value boolean)
  returns void
  language plpgsql security definer
  set search_path to 'pg_catalog', 'public', 'pg_temp'
  as $$
begin
  if not public.may_administer_person(pid) then
    raise exception 'not permitted to administer this person' using errcode = '42501';
  end if;
  update public.persons set disabled = value where id = pid;
end
$$;

-- Factor rows are visible only to their owner (0105). Returns whether a
-- factor existed; the person enrolls again at the next sign-in.
create function public.reset_person_mfa(pid uuid)
  returns boolean
  language plpgsql security definer
  set search_path to 'pg_catalog', 'public', 'pg_temp'
  as $$
declare
  existed boolean;
begin
  if not public.may_administer_person(pid) then
    raise exception 'not permitted to administer this person' using errcode = '42501';
  end if;
  delete from public.mfa_recovery_codes where person_id = pid;
  delete from public.mfa_challenges where person_id = pid;
  delete from public.person_mfa where person_id = pid;
  existed := found;
  return existed;
end
$$;

-- Members of jid with an activated second factor, for that jurisdiction's
-- admins; empty for anyone else.
create function public.members_with_mfa(jid uuid)
  returns setof uuid
  language sql stable security definer
  set search_path to 'pg_catalog', 'public', 'pg_temp'
  as $$
  select f.person_id from public.person_mfa f
  join public.jurisdiction_memberships m on m.person_id = f.person_id and m.jurisdiction_id = jid
  where f.activated_at is not null and public.is_admin_of(jid)
$$;

revoke all on function public.may_administer_person(uuid) from public;
revoke all on function public.set_person_disabled(uuid, boolean) from public;
revoke all on function public.reset_person_mfa(uuid) from public;
revoke all on function public.members_with_mfa(uuid) from public;
grant execute on function public.may_administer_person(uuid) to app_runtime;
grant execute on function public.set_person_disabled(uuid, boolean) to app_runtime;
grant execute on function public.reset_person_mfa(uuid) to app_runtime;
grant execute on function public.members_with_mfa(uuid) to app_runtime;

-- Revoking or reassigning a position ends any sign-in the former holder has
-- into it, so they stop acting in the position at once rather than at their
-- next sign-out. Sessions are readable only by their owner, so this goes
-- through a function that checks the caller administers the position.
create function public.end_position_signins(pos uuid, pid uuid)
  returns integer
  language plpgsql security definer
  set search_path to 'pg_catalog', 'public', 'pg_temp'
  as $$
declare
  ended integer;
begin
  if not exists (
    select 1 from public.positions p
    where p.id = pos and public.is_admin_of(p.jurisdiction_id)
  ) then
    raise exception 'not permitted to administer this position' using errcode = '42501';
  end if;
  update public.position_signins set signed_out_at = now()
  where person_id = pid and position_id = pos and signed_out_at is null;
  update public.auth_sessions set active_position_id = null
  where person_id = pid and active_position_id = pos and ended_at is null;
  get diagnostics ended = row_count;
  return ended;
end
$$;

revoke all on function public.end_position_signins(uuid, uuid) from public;
grant execute on function public.end_position_signins(uuid, uuid) to app_runtime;
