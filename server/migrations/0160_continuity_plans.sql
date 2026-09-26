-- Continuity plans (VC-19). A plan may be a continuity plan: its definition
-- carries the government's essential functions, recovery locations, orders
-- of succession and delegations of authority, and activating it opens a task
-- per essential function. The kind read from the definition may now be
-- 'continuity'.
alter table public.plans drop constraint plans_kind_check;
alter table public.plans add constraint plans_kind_check
  check (kind in ('incident_response', 'recurring_event', 'continuity'));
