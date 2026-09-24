-- An assessment's follow-up: the stabilization objective it works toward and
-- when the next assessment is due.
--
-- The outlook says how and when a lifeline is expected to stabilize; the
-- objective names what stabilized means for this incident ("restore power to
-- critical facilities"). The next update is the time the reporting liaison
-- commits to report again, so a missed update can be seen for what it is.

alter table public.operational_assessments
  add column stabilization_objective text
    check (stabilization_objective is null or char_length(stabilization_objective) between 1 and 4000),
  add column next_update_at timestamptz,
  add constraint operational_assessments_next_update_after_assessment
    check (next_update_at is null or next_update_at > assessed_at);
