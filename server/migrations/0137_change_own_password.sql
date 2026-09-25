-- A person changes their own password. The application verifies the current
-- password first (scrypt runs there, as at sign-in); this sets the new hash
-- and ends the person's other sessions and their position sign-ins, so a
-- session opened with the old password does not outlive the change. It
-- returns how many other sessions ended, or null when there is no person.

create function public.change_own_password(new_hash text, keep_session uuid)
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $$
declare
  me uuid := public.current_person();
  ended integer;
begin
  if me is null or new_hash is null or new_hash not like 'scrypt:%' then
    return null;
  end if;
  update public.persons set password_hash = new_hash where id = me and not disabled;
  if not found then
    return null;
  end if;
  with closed as (
    update public.auth_sessions set ended_at = now()
     where person_id = me and id <> keep_session and ended_at is null
    returning id
  ), signed_out as (
    update public.position_signins set signed_out_at = now()
     where session_id in (select id from closed) and signed_out_at is null
  )
  select count(*) into ended from closed;
  return ended;
end;
$$;

revoke all on function public.change_own_password(text, uuid) from public;
grant execute on function public.change_own_password(text, uuid) to app_runtime;
