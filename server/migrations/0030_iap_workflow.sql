-- IAP approval workflow states (VEOC-71). The IAP working-list needs more than
-- draft/approved: an operator submits a plan for approval, command approves it,
-- and the plan is marked complete once its operational period ends. Widen the
-- status vocabulary; existing 'draft' and 'approved' rows stay valid. The
-- display states "not started" and "in progress" are derived from a draft's
-- form count and are not stored.

alter table iaps drop constraint if exists iaps_status_check;

alter table iaps
  add constraint iaps_status_check
  check (status in ('draft', 'in_approval', 'approved', 'complete'));
