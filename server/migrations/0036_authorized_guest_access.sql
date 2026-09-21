-- For Official Use Only (Basho, 2026-09-20). There is no public facet, and an
-- authorized mutual-aid guest keeps unrestricted access while an incident is
-- open. This removes the incident lockdown added in 0028, whose only effect was
-- to suspend guest read during an incident (has_guest_scope returned false when
-- the jurisdiction was locked). Access is binary: an unexpired, unrevoked grant
-- carries the scope, incident or not. has_guest_scope returns to its 0002 form
-- and the now-unused lockdown column is dropped.

create or replace function has_guest_scope(jid uuid, wanted text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from guest_grants
    where person_id = current_person() and jurisdiction_id = jid
      and revoked_at is null and expires_at > now()
      and wanted = any (scopes))
$$;

alter table jurisdictions drop column locked;
