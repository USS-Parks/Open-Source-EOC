-- Incident lockdown (Basho, 2026-09-20). While an incident is open, the
-- jurisdiction's dashboard "locks down": guest and public read is suspended so
-- an active incident is not exposed to time-boxed mutual-aid guests or any
-- anonymous view. Members are unaffected. Lockdown engages automatically when
-- an incident is activated and clears when the last open incident closes; a
-- jurisdiction admin can override it (lift or re-apply) while an incident runs.

alter table jurisdictions add column locked boolean not null default false;

-- Every guest read flows through has_guest_scope. Suspending guests during
-- lockdown here covers all guest-readable surfaces at the RLS wall at once:
-- a locked jurisdiction yields no guest scope, whatever the grant says.
create or replace function has_guest_scope(jid uuid, wanted text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from guest_grants g
    join jurisdictions j on j.id = g.jurisdiction_id
    where g.person_id = current_person() and g.jurisdiction_id = jid
      and g.revoked_at is null and g.expires_at > now()
      and wanted = any (g.scopes)
      and j.locked = false)
$$;
